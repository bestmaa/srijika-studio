#![forbid(unsafe_code)]

//! Authenticated, process-local bridge between Sutra Studio's webview and Codex tools.
//!
//! The HTTP surface is deliberately small. The server binds an ephemeral IPv4 loopback
//! port, authenticates every route, and relays generic RPC envelopes to a frontend event
//! sink. Document semantics remain in the Studio frontend/document engine.

use std::{
    collections::HashMap,
    fs,
    io::Write,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Request, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use subtle::ConstantTimeEq;
use tempfile::NamedTempFile;
use tokio::{
    net::TcpListener,
    sync::{Semaphore, oneshot},
    task::JoinHandle,
    time::timeout,
};

pub const PROTOCOL_VERSION: &str = "1.0";
pub const BRIDGE_RPC_EVENT: &str = "sutra://bridge-rpc-request";
pub const DEFAULT_DESCRIPTOR_FILE_NAME: &str = "codex-bridge-v1.json";

const DEFAULT_BODY_LIMIT_BYTES: usize = 256 * 1024;
const DEFAULT_HEADER_LIMIT_BYTES: usize = 8 * 1024;
const DEFAULT_HEADER_COUNT_LIMIT: usize = 32;
const DEFAULT_MAX_IN_FLIGHT: usize = 16;
const DEFAULT_RESPONSE_TIMEOUT: Duration = Duration::from_secs(15);
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(16);

#[derive(Debug, Clone)]
pub struct BridgeServerConfig {
    pub descriptor_path: PathBuf,
    pub app_name: String,
    pub app_version: String,
    pub body_limit_bytes: usize,
    pub header_limit_bytes: usize,
    pub header_count_limit: usize,
    pub max_in_flight: usize,
    pub response_timeout: Duration,
    pub request_timeout: Duration,
}

impl BridgeServerConfig {
    pub fn new(
        descriptor_path: impl Into<PathBuf>,
        app_name: impl Into<String>,
        app_version: impl Into<String>,
    ) -> Self {
        Self {
            descriptor_path: descriptor_path.into(),
            app_name: app_name.into(),
            app_version: app_version.into(),
            body_limit_bytes: DEFAULT_BODY_LIMIT_BYTES,
            header_limit_bytes: DEFAULT_HEADER_LIMIT_BYTES,
            header_count_limit: DEFAULT_HEADER_COUNT_LIMIT,
            max_in_flight: DEFAULT_MAX_IN_FLIGHT,
            response_timeout: DEFAULT_RESPONSE_TIMEOUT,
            request_timeout: DEFAULT_REQUEST_TIMEOUT,
        }
    }

    fn validate(&self) -> Result<(), BridgeStartError> {
        if !self.descriptor_path.is_absolute() {
            return Err(BridgeStartError::InvalidConfig(
                "descriptor path must be absolute",
            ));
        }
        if self.body_limit_bytes == 0 || self.body_limit_bytes > 8 * 1024 * 1024 {
            return Err(BridgeStartError::InvalidConfig(
                "body limit must be between 1 byte and 8 MiB",
            ));
        }
        if self.header_limit_bytes == 0 || self.header_limit_bytes > 64 * 1024 {
            return Err(BridgeStartError::InvalidConfig(
                "header limit must be between 1 byte and 64 KiB",
            ));
        }
        if self.header_count_limit == 0 || self.header_count_limit > 128 {
            return Err(BridgeStartError::InvalidConfig(
                "header count limit must be between 1 and 128",
            ));
        }
        if self.max_in_flight == 0 || self.max_in_flight > 64 {
            return Err(BridgeStartError::InvalidConfig(
                "concurrency limit must be between 1 and 64",
            ));
        }
        if self.response_timeout.is_zero()
            || self.request_timeout.is_zero()
            || self.request_timeout <= self.response_timeout
        {
            return Err(BridgeStartError::InvalidConfig(
                "request timeout must be greater than the non-zero frontend response timeout",
            ));
        }
        if self.request_timeout > Duration::from_secs(60) {
            return Err(BridgeStartError::InvalidConfig(
                "request timeout must not exceed 60 seconds",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BridgeDescriptor {
    pub schema_version: u32,
    pub protocol_version: String,
    pub endpoint: String,
    pub token: String,
    pub instance_id: String,
    pub pid: u32,
    pub app_name: String,
    pub app_version: String,
    pub started_at_unix_ms: u64,
    pub health_path: String,
}

impl BridgeDescriptor {
    /// Clients detect stale descriptors by calling the authenticated `health_path`, then
    /// comparing the returned instance id and pid with this descriptor. A connection failure,
    /// or a different instance id, means this file is stale and must be rediscovered.
    pub fn health_url(&self) -> String {
        format!("{}{}", self.endpoint, self.health_path)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRpcEvent {
    pub protocol_version: &'static str,
    pub request_id: String,
    pub method: String,
    pub params: Value,
}

pub trait FrontendEventSink: Send + Sync + 'static {
    fn emit_rpc(&self, event: &BridgeRpcEvent) -> Result<(), String>;
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BridgeRpcRequest {
    pub protocol_version: String,
    pub method: String,
    #[serde(default = "default_params")]
    pub params: Value,
}

fn default_params() -> Value {
    Value::Object(Default::default())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BridgeErrorBody {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl BridgeErrorBody {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrontendRpcResponse {
    pub request_id: String,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<BridgeErrorBody>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRpcResponse {
    pub ok: bool,
    pub protocol_version: &'static str,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<BridgeErrorBody>,
}

impl BridgeRpcResponse {
    fn success(request_id: String, result: Value) -> Self {
        Self {
            ok: true,
            protocol_version: PROTOCOL_VERSION,
            request_id,
            result: Some(result),
            error: None,
        }
    }

    fn failure(request_id: String, error: BridgeErrorBody) -> Self {
        Self {
            ok: false,
            protocol_version: PROTOCOL_VERSION,
            request_id,
            result: None,
            error: Some(error),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiErrorResponse {
    ok: bool,
    protocol_version: &'static str,
    error: BridgeErrorBody,
}

impl ApiErrorResponse {
    fn response(status: StatusCode, code: &'static str, message: &'static str) -> Response {
        let mut response = (
            status,
            Json(Self {
                ok: false,
                protocol_version: PROTOCOL_VERSION,
                error: BridgeErrorBody::new(code, message),
            }),
        )
            .into_response();
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-store"),
        );
        response.headers_mut().insert(
            header::X_CONTENT_TYPE_OPTIONS,
            header::HeaderValue::from_static("nosniff"),
        );
        response
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    ok: bool,
    protocol_version: &'static str,
    instance_id: String,
    pid: u32,
    app_name: String,
    app_version: String,
    frontend_ready: bool,
    pending_requests: usize,
}

struct RelayInner {
    sink: Arc<dyn FrontendEventSink>,
    instance_id: String,
    next_request_id: AtomicU64,
    frontend_ready: AtomicBool,
    pending: Mutex<HashMap<String, oneshot::Sender<FrontendRpcResponse>>>,
    permits: Arc<Semaphore>,
    response_timeout: Duration,
}

#[derive(Clone)]
pub struct BridgeRelay {
    inner: Arc<RelayInner>,
}

impl std::fmt::Debug for BridgeRelay {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BridgeRelay")
            .field("instance_id", &self.inner.instance_id)
            .field("frontend_ready", &self.frontend_ready())
            .field("pending_count", &self.pending_count())
            .finish_non_exhaustive()
    }
}

impl BridgeRelay {
    fn new(
        sink: Arc<dyn FrontendEventSink>,
        instance_id: String,
        max_in_flight: usize,
        response_timeout: Duration,
    ) -> Self {
        Self {
            inner: Arc::new(RelayInner {
                sink,
                instance_id,
                next_request_id: AtomicU64::new(1),
                frontend_ready: AtomicBool::new(false),
                pending: Mutex::new(HashMap::new()),
                permits: Arc::new(Semaphore::new(max_in_flight)),
                response_timeout,
            }),
        }
    }

    pub fn set_frontend_ready(&self, ready: bool) {
        self.inner.frontend_ready.store(ready, Ordering::Release);
    }

    pub fn frontend_ready(&self) -> bool {
        self.inner.frontend_ready.load(Ordering::Acquire)
    }

    pub fn pending_count(&self) -> usize {
        self.inner
            .pending
            .lock()
            .expect("bridge pending-request mutex poisoned")
            .len()
    }

    pub fn resolve(&self, response: FrontendRpcResponse) -> Result<(), ResolveError> {
        let valid_shape = matches!(
            (&response.result, &response.error),
            (Some(_), None) | (None, Some(_))
        );
        if !valid_shape {
            return Err(ResolveError::InvalidResponseShape);
        }

        let sender = self
            .inner
            .pending
            .lock()
            .expect("bridge pending-request mutex poisoned")
            .remove(&response.request_id)
            .ok_or(ResolveError::UnknownRequest)?;

        sender
            .send(response)
            .map_err(|_| ResolveError::RequestExpired)
    }

    async fn dispatch(&self, request: BridgeRpcRequest) -> (StatusCode, BridgeRpcResponse) {
        if request.protocol_version != PROTOCOL_VERSION {
            return (
                StatusCode::BAD_REQUEST,
                BridgeRpcResponse::failure(
                    String::new(),
                    BridgeErrorBody::new(
                        "unsupported_protocol_version",
                        "The requested bridge protocol version is not supported.",
                    ),
                ),
            );
        }
        if !valid_method(&request.method) {
            return (
                StatusCode::BAD_REQUEST,
                BridgeRpcResponse::failure(
                    String::new(),
                    BridgeErrorBody::new(
                        "invalid_method",
                        "RPC method must contain 1-128 safe ASCII method characters.",
                    ),
                ),
            );
        }
        if !self.frontend_ready() {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                BridgeRpcResponse::failure(
                    String::new(),
                    BridgeErrorBody::new(
                        "frontend_not_ready",
                        "Sutra Studio has not registered its bridge handler yet.",
                    ),
                ),
            );
        }

        let Ok(_permit) = self.inner.permits.clone().try_acquire_owned() else {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                BridgeRpcResponse::failure(
                    String::new(),
                    BridgeErrorBody::new(
                        "bridge_busy",
                        "Sutra Studio is already processing the maximum number of bridge requests.",
                    ),
                ),
            );
        };

        let sequence = self.inner.next_request_id.fetch_add(1, Ordering::Relaxed);
        let request_id = format!("{}-{sequence}", self.inner.instance_id);
        let event = BridgeRpcEvent {
            protocol_version: PROTOCOL_VERSION,
            request_id: request_id.clone(),
            method: request.method,
            params: request.params,
        };
        let (sender, receiver) = oneshot::channel();
        self.inner
            .pending
            .lock()
            .expect("bridge pending-request mutex poisoned")
            .insert(request_id.clone(), sender);
        let mut pending_guard = PendingRequestGuard::new(self.clone(), request_id.clone());

        if self.inner.sink.emit_rpc(&event).is_err() {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                BridgeRpcResponse::failure(
                    request_id,
                    BridgeErrorBody::new(
                        "frontend_emit_failed",
                        "The bridge could not deliver the request to Sutra Studio.",
                    ),
                ),
            );
        }

        match timeout(self.inner.response_timeout, receiver).await {
            Ok(Ok(response)) => {
                pending_guard.disarm();
                match (response.result, response.error) {
                    (Some(result), None) => (
                        StatusCode::OK,
                        BridgeRpcResponse::success(request_id, result),
                    ),
                    (None, Some(error)) => (
                        StatusCode::UNPROCESSABLE_ENTITY,
                        BridgeRpcResponse::failure(request_id, error),
                    ),
                    _ => (
                        StatusCode::BAD_GATEWAY,
                        BridgeRpcResponse::failure(
                            request_id,
                            BridgeErrorBody::new(
                                "invalid_frontend_response",
                                "Sutra Studio returned an invalid bridge response.",
                            ),
                        ),
                    ),
                }
            }
            Ok(Err(_)) => (
                StatusCode::BAD_GATEWAY,
                BridgeRpcResponse::failure(
                    request_id,
                    BridgeErrorBody::new(
                        "frontend_response_dropped",
                        "Sutra Studio dropped the bridge response channel.",
                    ),
                ),
            ),
            Err(_) => (
                StatusCode::GATEWAY_TIMEOUT,
                BridgeRpcResponse::failure(
                    request_id,
                    BridgeErrorBody::new(
                        "frontend_timeout",
                        "Sutra Studio did not answer the bridge request before the deadline.",
                    ),
                ),
            ),
        }
    }
}

struct PendingRequestGuard {
    relay: BridgeRelay,
    request_id: String,
    armed: bool,
}

impl PendingRequestGuard {
    fn new(relay: BridgeRelay, request_id: String) -> Self {
        Self {
            relay,
            request_id,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PendingRequestGuard {
    fn drop(&mut self) {
        if self.armed {
            self.relay
                .inner
                .pending
                .lock()
                .expect("bridge pending-request mutex poisoned")
                .remove(&self.request_id);
        }
    }
}

fn valid_method(method: &str) -> bool {
    !method.is_empty()
        && method.len() <= 128
        && method.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'/' | b':')
        })
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ResolveError {
    #[error("bridge response must contain exactly one of result or error")]
    InvalidResponseShape,
    #[error("bridge request id is unknown")]
    UnknownRequest,
    #[error("bridge request already expired")]
    RequestExpired,
}

#[derive(Debug, thiserror::Error)]
pub enum BridgeStartError {
    #[error("invalid bridge configuration: {0}")]
    InvalidConfig(&'static str),
    #[error("failed to generate bridge credentials: {0}")]
    CredentialGeneration(getrandom::Error),
    #[error("failed to bind the loopback bridge: {0}")]
    Bind(std::io::Error),
    #[error("failed to write the bridge descriptor: {0}")]
    Descriptor(std::io::Error),
}

#[derive(Clone)]
struct HttpState {
    token: Arc<str>,
    relay: BridgeRelay,
    config: Arc<BridgeServerConfig>,
    descriptor: BridgeDescriptor,
    request_permits: Arc<Semaphore>,
}

pub struct BridgeServer {
    descriptor: BridgeDescriptor,
    descriptor_path: PathBuf,
    relay: BridgeRelay,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
    server_task: Mutex<Option<JoinHandle<()>>>,
}

impl std::fmt::Debug for BridgeServer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BridgeServer")
            .field("descriptor_path", &self.descriptor_path)
            .field("endpoint", &self.descriptor.endpoint)
            .field("instance_id", &self.descriptor.instance_id)
            .field("frontend_ready", &self.relay.frontend_ready())
            .finish_non_exhaustive()
    }
}

impl BridgeServer {
    pub async fn start(
        config: BridgeServerConfig,
        sink: Arc<dyn FrontendEventSink>,
    ) -> Result<Self, BridgeStartError> {
        config.validate()?;
        let token = random_hex_256().map_err(BridgeStartError::CredentialGeneration)?;
        let instance_id = random_hex_128().map_err(BridgeStartError::CredentialGeneration)?;
        let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
            .await
            .map_err(BridgeStartError::Bind)?;
        let address = listener.local_addr().map_err(BridgeStartError::Bind)?;
        if address.ip() != IpAddr::V4(Ipv4Addr::LOCALHOST) {
            return Err(BridgeStartError::InvalidConfig(
                "bridge listener must resolve to IPv4 loopback",
            ));
        }

        let descriptor = BridgeDescriptor {
            schema_version: 1,
            protocol_version: PROTOCOL_VERSION.to_owned(),
            endpoint: format!("http://127.0.0.1:{}", address.port()),
            token: token.clone(),
            instance_id: instance_id.clone(),
            pid: std::process::id(),
            app_name: config.app_name.clone(),
            app_version: config.app_version.clone(),
            started_at_unix_ms: unix_time_ms(),
            health_path: "/v1/health".to_owned(),
        };
        write_descriptor_atomically(&config.descriptor_path, &descriptor)
            .map_err(BridgeStartError::Descriptor)?;

        let relay = BridgeRelay::new(
            sink,
            instance_id,
            config.max_in_flight,
            config.response_timeout,
        );
        let state = HttpState {
            token: Arc::from(token),
            relay: relay.clone(),
            config: Arc::new(config.clone()),
            descriptor: descriptor.clone(),
            request_permits: Arc::new(Semaphore::new(config.max_in_flight)),
        };
        let router = build_router(state);
        let (shutdown_sender, shutdown_receiver) = oneshot::channel();
        let descriptor_path = config.descriptor_path.clone();
        let instance_for_cleanup = descriptor.instance_id.clone();
        let server_task = tokio::spawn(async move {
            let result = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_receiver.await;
                })
                .await;
            if let Err(error) = result {
                eprintln!("Sutra Studio bridge server stopped unexpectedly: {error}");
            }
            cleanup_descriptor_if_owned(&descriptor_path, &instance_for_cleanup);
        });

        Ok(Self {
            descriptor,
            descriptor_path: config.descriptor_path,
            relay,
            shutdown: Mutex::new(Some(shutdown_sender)),
            server_task: Mutex::new(Some(server_task)),
        })
    }

    pub fn descriptor(&self) -> &BridgeDescriptor {
        &self.descriptor
    }

    pub fn descriptor_path(&self) -> &Path {
        &self.descriptor_path
    }

    pub fn relay(&self) -> &BridgeRelay {
        &self.relay
    }

    pub fn shutdown(&self) {
        if let Some(sender) = self
            .shutdown
            .lock()
            .expect("bridge shutdown mutex poisoned")
            .take()
        {
            let _ = sender.send(());
        }
        cleanup_descriptor_if_owned(&self.descriptor_path, &self.descriptor.instance_id);
    }
}

impl Drop for BridgeServer {
    fn drop(&mut self) {
        self.shutdown();
        if let Some(task) = self
            .server_task
            .lock()
            .expect("bridge server-task mutex poisoned")
            .take()
        {
            task.abort();
        }
    }
}

fn build_router(state: HttpState) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/rpc", post(rpc))
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .layer(DefaultBodyLimit::max(state.config.body_limit_bytes))
        .layer(middleware::from_fn_with_state(state.clone(), request_guard))
        .with_state(state)
}

async fn request_guard(
    State(state): State<HttpState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    if request.headers().len() > state.config.header_count_limit
        || header_size(request.headers()) > state.config.header_limit_bytes
    {
        return ApiErrorResponse::response(
            StatusCode::REQUEST_HEADER_FIELDS_TOO_LARGE,
            "headers_too_large",
            "Request headers exceed the bridge limit.",
        );
    }
    if !authorized(request.headers(), &state.token) {
        return ApiErrorResponse::response(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "A valid Sutra Studio bridge bearer token is required.",
        );
    }
    if request.method() == axum::http::Method::POST && !is_json(request.headers()) {
        return ApiErrorResponse::response(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
            "POST requests must use application/json.",
        );
    }

    let Ok(_request_permit) = state.request_permits.clone().try_acquire_owned() else {
        return ApiErrorResponse::response(
            StatusCode::TOO_MANY_REQUESTS,
            "too_many_requests",
            "The authenticated bridge concurrency limit has been reached.",
        );
    };

    match timeout(state.config.request_timeout, next.run(request)).await {
        Ok(mut response) => {
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                header::HeaderValue::from_static("no-store"),
            );
            response.headers_mut().insert(
                header::X_CONTENT_TYPE_OPTIONS,
                header::HeaderValue::from_static("nosniff"),
            );
            response
        }
        Err(_) => ApiErrorResponse::response(
            StatusCode::GATEWAY_TIMEOUT,
            "request_timeout",
            "The bridge request exceeded its total deadline.",
        ),
    }
}

fn header_size(headers: &HeaderMap) -> usize {
    headers
        .iter()
        .map(|(name, value)| name.as_str().len().saturating_add(value.as_bytes().len()))
        .sum()
}

fn authorized(headers: &HeaderMap, expected_token: &str) -> bool {
    let Some(value) = headers.get(header::AUTHORIZATION) else {
        return false;
    };
    let Ok(value) = value.to_str() else {
        return false;
    };
    let Some(token) = value.strip_prefix("Bearer ") else {
        return false;
    };
    token.len() == expected_token.len()
        && bool::from(token.as_bytes().ct_eq(expected_token.as_bytes()))
}

fn is_json(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"))
}

async fn health(State(state): State<HttpState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        protocol_version: PROTOCOL_VERSION,
        instance_id: state.descriptor.instance_id,
        pid: state.descriptor.pid,
        app_name: state.descriptor.app_name,
        app_version: state.descriptor.app_version,
        frontend_ready: state.relay.frontend_ready(),
        pending_requests: state.relay.pending_count(),
    })
}

async fn rpc(
    State(state): State<HttpState>,
    payload: Result<Json<BridgeRpcRequest>, JsonRejection>,
) -> Response {
    let request = match payload {
        Ok(Json(request)) => request,
        Err(rejection) => {
            let status = rejection.status();
            let (code, message) = if status == StatusCode::PAYLOAD_TOO_LARGE {
                ("body_too_large", "Request body exceeds the bridge limit.")
            } else {
                ("invalid_json", "Request body is not valid bridge JSON.")
            };
            return ApiErrorResponse::response(status, code, message);
        }
    };
    let (status, response) = state.relay.dispatch(request).await;
    (status, Json(response)).into_response()
}

async fn not_found() -> Response {
    ApiErrorResponse::response(
        StatusCode::NOT_FOUND,
        "route_not_found",
        "The requested bridge route does not exist.",
    )
}

async fn method_not_allowed() -> Response {
    ApiErrorResponse::response(
        StatusCode::METHOD_NOT_ALLOWED,
        "method_not_allowed",
        "The HTTP method is not allowed for this bridge route.",
    )
}

fn random_hex_256() -> Result<String, getrandom::Error> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)?;
    Ok(hex_encode(&bytes))
}

fn random_hex_128() -> Result<String, getrandom::Error> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes)?;
    Ok(hex_encode(&bytes))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn write_descriptor_atomically(
    path: &Path,
    descriptor: &BridgeDescriptor,
) -> Result<(), std::io::Error> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "descriptor path has no parent directory",
        )
    })?;
    fs::create_dir_all(parent)?;
    let mut temporary = NamedTempFile::new_in(parent)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    // On Windows this file inherits the ACL of Tauri's per-user LocalAppData directory.
    // The default path deliberately stays inside that user profile. Enterprise deployments
    // overriding the path must provide an equivalently private parent ACL.

    serde_json::to_writer_pretty(&mut temporary, descriptor)?;
    temporary.write_all(b"\n")?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

fn cleanup_descriptor_if_owned(path: &Path, instance_id: &str) {
    let owned = fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<BridgeDescriptor>(&bytes).ok())
        .is_some_and(|descriptor| descriptor.instance_id == instance_id);
    if owned {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode, header},
    };
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tower::ServiceExt;

    use super::*;

    #[derive(Default)]
    struct RecordingSink {
        events: Mutex<Vec<BridgeRpcEvent>>,
    }

    impl FrontendEventSink for RecordingSink {
        fn emit_rpc(&self, event: &BridgeRpcEvent) -> Result<(), String> {
            self.events
                .lock()
                .expect("recording sink mutex poisoned")
                .push(event.clone());
            Ok(())
        }
    }

    fn test_state(response_timeout: Duration) -> (HttpState, Arc<RecordingSink>) {
        let sink = Arc::new(RecordingSink::default());
        let mut config = BridgeServerConfig::new(
            std::env::temp_dir().join("sutra-bridge-test.json"),
            "Sutra Studio",
            "0.1.0",
        );
        config.response_timeout = response_timeout;
        config.request_timeout = response_timeout + Duration::from_secs(1);
        let descriptor = BridgeDescriptor {
            schema_version: 1,
            protocol_version: PROTOCOL_VERSION.to_owned(),
            endpoint: "http://127.0.0.1:12345".to_owned(),
            token: "a".repeat(64),
            instance_id: "instance".to_owned(),
            pid: 42,
            app_name: "Sutra Studio".to_owned(),
            app_version: "0.1.0".to_owned(),
            started_at_unix_ms: 1,
            health_path: "/v1/health".to_owned(),
        };
        let relay = BridgeRelay::new(sink.clone(), "instance".to_owned(), 2, response_timeout);
        (
            HttpState {
                token: Arc::from("a".repeat(64)),
                relay,
                config: Arc::new(config),
                descriptor,
                request_permits: Arc::new(Semaphore::new(2)),
            },
            sink,
        )
    }

    async fn body_json(response: Response) -> Value {
        let bytes = to_bytes(response.into_body(), 1024 * 1024)
            .await
            .expect("response body should be readable");
        serde_json::from_slice(&bytes).expect("response should contain JSON")
    }

    #[tokio::test]
    async fn health_rejects_missing_and_wrong_authorization() {
        let (state, _) = test_state(Duration::from_millis(50));
        let router = build_router(state);

        let missing = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(body_json(missing).await["error"]["code"], "unauthorized");

        let wrong = router
            .oneshot(
                Request::builder()
                    .uri("/v1/health")
                    .header(header::AUTHORIZATION, "Bearer definitely-wrong")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn authenticated_health_is_safe_and_reports_frontend_status() {
        let (state, _) = test_state(Duration::from_millis(50));
        state.relay.set_frontend_ready(true);
        let response = build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/v1/health")
                    .header(header::AUTHORIZATION, format!("Bearer {}", "a".repeat(64)))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_json(response).await;
        assert_eq!(body["frontendReady"], true);
        assert!(
            body.get("token").is_none(),
            "health must never expose token"
        );
    }

    #[tokio::test]
    async fn rpc_times_out_and_cleans_pending_request() {
        let (state, sink) = test_state(Duration::from_millis(10));
        state.relay.set_frontend_ready(true);
        let relay = state.relay.clone();
        let response = build_router(state)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/rpc")
                    .header(header::AUTHORIZATION, format!("Bearer {}", "a".repeat(64)))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "protocolVersion": PROTOCOL_VERSION,
                            "method": "sutra.getProjectSummary",
                            "params": {}
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        assert_eq!(
            body_json(response).await["error"]["code"],
            "frontend_timeout"
        );
        assert_eq!(sink.events.lock().unwrap().len(), 1);
        assert_eq!(relay.pending_count(), 0);
    }

    #[tokio::test]
    async fn relay_resolves_a_frontend_result() {
        let (state, sink) = test_state(Duration::from_secs(1));
        state.relay.set_frontend_ready(true);
        let relay = state.relay.clone();
        let router = build_router(state);
        let request_task = tokio::spawn(async move {
            router
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/v1/rpc")
                        .header(header::AUTHORIZATION, format!("Bearer {}", "a".repeat(64)))
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(
                            serde_json::to_vec(&json!({
                                "protocolVersion": PROTOCOL_VERSION,
                                "method": "sutra.validateDocument",
                                "params": {"revision": 7}
                            }))
                            .unwrap(),
                        ))
                        .unwrap(),
                )
                .await
                .unwrap()
        });

        let request_id = timeout(Duration::from_secs(1), async {
            loop {
                if let Some(event) = sink.events.lock().unwrap().first().cloned() {
                    break event.request_id;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("event should be emitted");
        relay
            .resolve(FrontendRpcResponse {
                request_id,
                result: Some(json!({"valid": true})),
                error: None,
            })
            .unwrap();

        let response = request_task.await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body_json(response).await["result"]["valid"], true);
    }

    #[tokio::test]
    async fn malformed_or_oversized_json_has_a_structured_error() {
        let (mut state, _) = test_state(Duration::from_millis(50));
        Arc::get_mut(&mut state.config).unwrap().body_limit_bytes = 32;
        let router = build_router(state);
        let authorization = format!("Bearer {}", "a".repeat(64));

        let malformed = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/rpc")
                    .header(header::AUTHORIZATION, &authorization)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);
        assert_eq!(body_json(malformed).await["error"]["code"], "invalid_json");

        let oversized = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/rpc")
                    .header(header::AUTHORIZATION, authorization)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from("x".repeat(64)))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(oversized.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(
            body_json(oversized).await["error"]["code"],
            "body_too_large"
        );
    }

    #[tokio::test]
    async fn real_server_binds_only_loopback_and_serves_authenticated_health() {
        let directory = tempfile::tempdir().unwrap();
        let descriptor_path = directory.path().join(DEFAULT_DESCRIPTOR_FILE_NAME);
        let config = BridgeServerConfig::new(&descriptor_path, "Sutra Studio", "0.1.0");
        let server = BridgeServer::start(config, Arc::new(RecordingSink::default()))
            .await
            .unwrap();
        let descriptor: BridgeDescriptor =
            serde_json::from_slice(&fs::read(&descriptor_path).unwrap()).unwrap();
        assert_eq!(descriptor.endpoint, server.descriptor().endpoint);
        assert!(descriptor.endpoint.starts_with("http://127.0.0.1:"));

        let address = descriptor
            .endpoint
            .strip_prefix("http://")
            .expect("endpoint uses plain loopback HTTP");
        let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
        let request = format!(
            "GET /v1/health HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {}\r\nConnection: close\r\n\r\n",
            descriptor.token
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        let response = String::from_utf8(response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains(&format!("\"instanceId\":\"{}\"", descriptor.instance_id)));
        assert!(!response.contains(&descriptor.token));

        server.shutdown();
        assert!(!descriptor_path.exists());
    }

    #[test]
    fn descriptor_is_written_privately_and_cleanup_is_instance_safe() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(DEFAULT_DESCRIPTOR_FILE_NAME);
        let descriptor = BridgeDescriptor {
            schema_version: 1,
            protocol_version: PROTOCOL_VERSION.to_owned(),
            endpoint: "http://127.0.0.1:12345".to_owned(),
            token: "secret".to_owned(),
            instance_id: "current".to_owned(),
            pid: 1,
            app_name: "Sutra Studio".to_owned(),
            app_version: "0.1.0".to_owned(),
            started_at_unix_ms: 1,
            health_path: "/v1/health".to_owned(),
        };
        write_descriptor_atomically(&path, &descriptor).unwrap();
        let decoded: BridgeDescriptor = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(decoded, descriptor);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

        cleanup_descriptor_if_owned(&path, "older");
        assert!(path.exists());
        cleanup_descriptor_if_owned(&path, "current");
        assert!(!path.exists());
    }

    #[test]
    fn generated_credentials_have_expected_entropy_width_and_are_unique() {
        let first = random_hex_256().unwrap();
        let second = random_hex_256().unwrap();
        assert_eq!(first.len(), 64);
        assert_eq!(second.len(), 64);
        assert_ne!(first, second);
        assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }
}
