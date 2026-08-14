use std::{path::PathBuf, sync::Arc};

use serde::Serialize;
use studio_bridge::{
    BRIDGE_RPC_EVENT, BridgeRpcEvent, BridgeServer, BridgeServerConfig, FrontendEventSink,
    FrontendRpcResponse, ResolveError,
};
use tauri::{AppHandle, Emitter, Manager, State};

pub const DESCRIPTOR_OVERRIDE_ENV: &str = "SRIJIKA_STUDIO_BRIDGE_DESCRIPTOR";

struct TauriFrontendSink {
    app: AppHandle,
}

impl FrontendEventSink for TauriFrontendSink {
    fn emit_rpc(&self, event: &BridgeRpcEvent) -> Result<(), String> {
        self.app
            .emit_to("main", BRIDGE_RPC_EVENT, event)
            .map_err(|error| error.to_string())
    }
}

#[derive(Debug)]
pub struct StudioBridge {
    server: BridgeServer,
}

impl StudioBridge {
    pub async fn start(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let package = app.package_info();
        let descriptor_path = resolve_descriptor_path(app)?;
        let config = BridgeServerConfig::new(
            descriptor_path,
            package.name.clone(),
            package.version.to_string(),
        );
        let sink = Arc::new(TauriFrontendSink { app: app.clone() });
        let server = BridgeServer::start(config, sink).await?;
        Ok(Self { server })
    }

    pub fn shutdown(&self) {
        self.server.shutdown();
    }
}

fn resolve_descriptor_path(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Some(path) = std::env::var_os(DESCRIPTOR_OVERRIDE_ENV) {
        let path = PathBuf::from(path);
        if !path.is_absolute() {
            return Err(format!("{DESCRIPTOR_OVERRIDE_ENV} must be an absolute path").into());
        }
        return Ok(path);
    }

    Ok(app
        .path()
        .app_local_data_dir()?
        .join(studio_bridge::DEFAULT_DESCRIPTOR_FILE_NAME))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    protocol_version: String,
    endpoint: String,
    instance_id: String,
    pid: u32,
    frontend_ready: bool,
    descriptor_path: String,
}

#[tauri::command]
pub fn get_bridge_status(bridge: State<'_, StudioBridge>) -> BridgeStatus {
    let descriptor = bridge.server.descriptor();
    BridgeStatus {
        protocol_version: descriptor.protocol_version.clone(),
        endpoint: descriptor.endpoint.clone(),
        instance_id: descriptor.instance_id.clone(),
        pid: descriptor.pid,
        frontend_ready: bridge.server.relay().frontend_ready(),
        descriptor_path: bridge
            .server
            .descriptor_path()
            .to_string_lossy()
            .into_owned(),
    }
}

#[tauri::command]
pub fn set_bridge_frontend_ready(bridge: State<'_, StudioBridge>, ready: bool) {
    bridge.server.relay().set_frontend_ready(ready);
}

#[tauri::command]
pub fn resolve_bridge_rpc(
    bridge: State<'_, StudioBridge>,
    response: FrontendRpcResponse,
) -> Result<(), BridgeCommandFailure> {
    bridge
        .server
        .relay()
        .resolve(response)
        .map_err(BridgeCommandFailure::from)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeCommandFailure {
    code: &'static str,
    message: String,
}

impl From<ResolveError> for BridgeCommandFailure {
    fn from(error: ResolveError) -> Self {
        let code = match error {
            ResolveError::InvalidResponseShape => "invalid_bridge_response",
            ResolveError::UnknownRequest => "unknown_bridge_request",
            ResolveError::RequestExpired => "expired_bridge_request",
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_command_errors_expose_stable_codes() {
        let error = BridgeCommandFailure::from(ResolveError::UnknownRequest);
        assert_eq!(error.code, "unknown_bridge_request");
        assert_eq!(error.message, "bridge request id is unknown");
    }
}
