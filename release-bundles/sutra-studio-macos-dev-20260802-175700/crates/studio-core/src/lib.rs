#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};

use project_store::{JsonProjectStore, StoreError};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

pub const UI_DOCUMENT_FORMAT_VERSION: u64 = 1;
const JSON_EXTENSION: &str = "json";
const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;
const DOCUMENT_FIELDS: [&str; 9] = [
    "formatVersion",
    "id",
    "kind",
    "name",
    "rootNodeId",
    "revision",
    "nodes",
    "symbols",
    "publicProps",
];

/// Narrow application service used by the Tauri boundary.
///
/// TypeScript owns the full versioned UI schema. Rust deliberately validates
/// the persistence envelope and graph identity invariants without attempting
/// to maintain a second copy of every JSX-AST node field.
#[derive(Debug, Clone, Default)]
pub struct StudioCore {
    store: JsonProjectStore,
}

impl StudioCore {
    pub fn new(store: JsonProjectStore) -> Self {
        Self { store }
    }

    pub fn load_ui_document(
        &self,
        request: LoadUiDocumentRequest,
    ) -> Result<LoadedUiDocument, StudioCoreError> {
        let path = checked_json_path(&request.path)?;
        let loaded = self.store.load::<Value>(&path)?;
        let metadata = validate_ui_document_envelope(&loaded.value)?;

        Ok(LoadedUiDocument {
            path: request.path,
            bytes: loaded.bytes,
            metadata,
            document: loaded.value,
        })
    }

    pub fn save_ui_document(
        &self,
        request: SaveUiDocumentRequest,
    ) -> Result<SavedUiDocument, StudioCoreError> {
        let path = checked_json_path(&request.path)?;
        let metadata = validate_ui_document_envelope(&request.document)?;
        let receipt = self.store.save(path, &request.document)?;

        Ok(SavedUiDocument {
            path: request.path,
            bytes: receipt.bytes,
            replaced: receipt.replaced,
            metadata,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadUiDocumentRequest {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveUiDocumentRequest {
    pub path: String,
    pub document: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedUiDocument {
    pub path: String,
    pub bytes: u64,
    pub metadata: DocumentMetadata,
    pub document: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedUiDocument {
    pub path: String,
    pub bytes: u64,
    pub replaced: bool,
    pub metadata: DocumentMetadata,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMetadata {
    pub format_version: u64,
    pub id: String,
    pub kind: DocumentKind,
    pub name: String,
    pub root_node_id: String,
    pub revision: u64,
    pub node_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentKind {
    Page,
    Component,
}

pub fn validate_ui_document_envelope(
    value: &Value,
) -> Result<DocumentMetadata, DocumentValidationError> {
    let document = value
        .as_object()
        .ok_or(DocumentValidationError::ExpectedObject)?;

    for field in document.keys() {
        if !DOCUMENT_FIELDS.contains(&field.as_str()) {
            return Err(DocumentValidationError::UnexpectedField(field.clone()));
        }
    }
    for field in DOCUMENT_FIELDS {
        if !document.contains_key(field) {
            return Err(DocumentValidationError::MissingField(field));
        }
    }

    let format_version = required_u64(document, "formatVersion")?;
    if format_version != UI_DOCUMENT_FORMAT_VERSION {
        return Err(DocumentValidationError::UnsupportedFormatVersion {
            expected: UI_DOCUMENT_FORMAT_VERSION,
            actual: format_version,
        });
    }

    let id = required_string(document, "id")?;
    if !is_identifier(id) {
        return Err(DocumentValidationError::InvalidField {
            field: "id",
            reason: "must start with an ASCII letter and contain only letters, digits, '_' or '-'",
        });
    }

    let name = required_string(document, "name")?;
    if name.is_empty() {
        return Err(DocumentValidationError::InvalidField {
            field: "name",
            reason: "must not be empty",
        });
    }

    let root_node_id = required_string(document, "rootNodeId")?;
    if root_node_id.is_empty() || root_node_id.chars().count() > 128 {
        return Err(DocumentValidationError::InvalidField {
            field: "rootNodeId",
            reason: "must contain between 1 and 128 characters",
        });
    }

    let revision = required_u64(document, "revision")?;
    if revision > MAX_SAFE_JSON_INTEGER {
        return Err(DocumentValidationError::InvalidField {
            field: "revision",
            reason: "must be a JavaScript-safe non-negative integer",
        });
    }

    let kind = match required_string(document, "kind")? {
        "page" => DocumentKind::Page,
        "component" => DocumentKind::Component,
        _ => {
            return Err(DocumentValidationError::InvalidField {
                field: "kind",
                reason: "must be 'page' or 'component'",
            });
        }
    };

    let nodes = required_object(document, "nodes")?;
    validate_node_identity(nodes)?;
    if !nodes.contains_key(root_node_id) {
        return Err(DocumentValidationError::MissingRootNode(
            root_node_id.to_owned(),
        ));
    }

    required_object(document, "symbols")?;
    required_object(document, "publicProps")?;

    Ok(DocumentMetadata {
        format_version,
        id: id.to_owned(),
        kind,
        name: name.to_owned(),
        root_node_id: root_node_id.to_owned(),
        revision,
        node_count: nodes.len(),
    })
}

fn validate_node_identity(nodes: &Map<String, Value>) -> Result<(), DocumentValidationError> {
    const NODE_KINDS: [&str; 7] = [
        "element",
        "text",
        "expression",
        "fragment",
        "if",
        "repeat",
        "slot",
    ];

    for (node_id, value) in nodes {
        if node_id.is_empty() || node_id.chars().count() > 128 {
            return Err(DocumentValidationError::InvalidNode {
                node_id: node_id.clone(),
                reason: "node key must contain between 1 and 128 characters",
            });
        }

        let node = value
            .as_object()
            .ok_or_else(|| DocumentValidationError::InvalidNode {
                node_id: node_id.clone(),
                reason: "node must be a JSON object",
            })?;
        let embedded_id = node.get("id").and_then(Value::as_str).ok_or_else(|| {
            DocumentValidationError::InvalidNode {
                node_id: node_id.clone(),
                reason: "node must contain a string id",
            }
        })?;
        if embedded_id != node_id {
            return Err(DocumentValidationError::NodeIdMismatch {
                key: node_id.clone(),
                embedded: embedded_id.to_owned(),
            });
        }

        let node_kind = node.get("kind").and_then(Value::as_str).ok_or_else(|| {
            DocumentValidationError::InvalidNode {
                node_id: node_id.clone(),
                reason: "node must contain a string kind",
            }
        })?;
        if !NODE_KINDS.contains(&node_kind) {
            return Err(DocumentValidationError::InvalidNode {
                node_id: node_id.clone(),
                reason: "node kind is unsupported",
            });
        }
    }

    Ok(())
}

fn checked_json_path(raw_path: &str) -> Result<PathBuf, StudioCoreError> {
    if raw_path.is_empty() {
        return Err(StudioCoreError::InvalidPath("path must not be empty"));
    }
    if raw_path.contains('\0') {
        return Err(StudioCoreError::InvalidPath(
            "path must not contain NUL bytes",
        ));
    }

    let path = Path::new(raw_path);
    if !path.is_absolute() {
        return Err(StudioCoreError::InvalidPath("path must be absolute"));
    }
    if path.file_name().is_none() {
        return Err(StudioCoreError::InvalidPath("path must identify a file"));
    }
    let is_json = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(JSON_EXTENSION));
    if !is_json {
        return Err(StudioCoreError::InvalidPath(
            "UI documents must use the .json extension",
        ));
    }

    Ok(path.to_path_buf())
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    field: &'static str,
) -> Result<&'a str, DocumentValidationError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .ok_or(DocumentValidationError::InvalidField {
            field,
            reason: "must be a string",
        })
}

fn required_u64(
    object: &Map<String, Value>,
    field: &'static str,
) -> Result<u64, DocumentValidationError> {
    object
        .get(field)
        .and_then(Value::as_u64)
        .ok_or(DocumentValidationError::InvalidField {
            field,
            reason: "must be a non-negative integer",
        })
}

fn required_object<'a>(
    object: &'a Map<String, Value>,
    field: &'static str,
) -> Result<&'a Map<String, Value>, DocumentValidationError> {
    object
        .get(field)
        .and_then(Value::as_object)
        .ok_or(DocumentValidationError::InvalidField {
            field,
            reason: "must be an object",
        })
}

fn is_identifier(value: &str) -> bool {
    if value.len() > 128 {
        return false;
    }
    let mut chars = value.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && chars.all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

#[derive(Debug, Error)]
pub enum StudioCoreError {
    #[error("invalid document path: {0}")]
    InvalidPath(&'static str),
    #[error(transparent)]
    InvalidDocument(#[from] DocumentValidationError),
    #[error(transparent)]
    Store(#[from] StoreError),
}

impl StudioCoreError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidPath(_) => "invalid_path",
            Self::InvalidDocument(_) => "invalid_document",
            Self::Store(StoreError::Deserialize { .. }) => "invalid_json",
            Self::Store(StoreError::TooLarge { .. }) => "document_too_large",
            Self::Store(StoreError::Io { source, .. })
                if source.kind() == std::io::ErrorKind::NotFound =>
            {
                "not_found"
            }
            Self::Store(_) => "persistence_error",
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DocumentValidationError {
    #[error("UI document must be a JSON object")]
    ExpectedObject,
    #[error("UI document is missing required field '{0}'")]
    MissingField(&'static str),
    #[error("UI document contains unsupported field '{0}'")]
    UnexpectedField(String),
    #[error("field '{field}' {reason}")]
    InvalidField {
        field: &'static str,
        reason: &'static str,
    },
    #[error("unsupported UI document format version {actual}; expected {expected}")]
    UnsupportedFormatVersion { expected: u64, actual: u64 },
    #[error("root node '{0}' does not exist in the nodes map")]
    MissingRootNode(String),
    #[error("node '{node_id}' is invalid: {reason}")]
    InvalidNode {
        node_id: String,
        reason: &'static str,
    },
    #[error("node map key '{key}' does not match embedded node id '{embedded}'")]
    NodeIdMismatch { key: String, embedded: String },
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use tempfile::tempdir;

    use super::{
        DocumentValidationError, LoadUiDocumentRequest, SaveUiDocumentRequest, StudioCore,
        StudioCoreError, validate_ui_document_envelope,
    };

    fn valid_document() -> Value {
        json!({
            "formatVersion": 1,
            "id": "page_home",
            "kind": "page",
            "name": "Home",
            "rootNodeId": "root",
            "revision": 7,
            "nodes": {
                "root": {
                    "kind": "element",
                    "id": "root"
                }
            },
            "symbols": {},
            "publicProps": {}
        })
    }

    #[test]
    fn validates_the_versioned_document_envelope() {
        let metadata = validate_ui_document_envelope(&valid_document()).expect("valid document");
        assert_eq!(metadata.id, "page_home");
        assert_eq!(metadata.root_node_id, "root");
        assert_eq!(metadata.revision, 7);
        assert_eq!(metadata.node_count, 1);
    }

    #[test]
    fn rejects_unknown_fields_and_node_identity_mismatches() {
        let mut unknown = valid_document();
        unknown["businessLogic"] = json!({});
        assert!(matches!(
            validate_ui_document_envelope(&unknown),
            Err(DocumentValidationError::UnexpectedField(field)) if field == "businessLogic"
        ));

        let mut mismatch = valid_document();
        mismatch["nodes"]["root"]["id"] = json!("different");
        assert!(matches!(
            validate_ui_document_envelope(&mismatch),
            Err(DocumentValidationError::NodeIdMismatch { .. })
        ));
    }

    #[test]
    fn service_round_trips_an_atomic_ui_document() {
        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("home.sutra.json");
        let path_text = path.to_string_lossy().into_owned();
        let core = StudioCore::default();

        let saved = core
            .save_ui_document(SaveUiDocumentRequest {
                path: path_text.clone(),
                document: valid_document(),
            })
            .expect("save");
        assert!(!saved.replaced);
        assert_eq!(saved.metadata.revision, 7);

        let loaded = core
            .load_ui_document(LoadUiDocumentRequest { path: path_text })
            .expect("load");
        assert_eq!(loaded.document, valid_document());
        assert_eq!(loaded.metadata.node_count, 1);
        assert_eq!(loaded.bytes, saved.bytes);
    }

    #[test]
    fn validates_before_creating_or_replacing_a_file() {
        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("invalid.sutra.json");
        let mut document = valid_document();
        document["formatVersion"] = json!(99);

        let error = StudioCore::default()
            .save_ui_document(SaveUiDocumentRequest {
                path: path.to_string_lossy().into_owned(),
                document,
            })
            .expect_err("invalid format must fail");
        assert!(matches!(error, StudioCoreError::InvalidDocument(_)));
        assert!(!path.exists());
    }

    #[test]
    fn rejects_relative_and_non_json_paths() {
        let core = StudioCore::default();

        let relative = core
            .load_ui_document(LoadUiDocumentRequest {
                path: "page.json".to_owned(),
            })
            .expect_err("relative path must fail");
        assert_eq!(relative.code(), "invalid_path");

        let directory = tempdir().expect("temporary directory");
        let non_json = core
            .save_ui_document(SaveUiDocumentRequest {
                path: directory
                    .path()
                    .join("page.txt")
                    .to_string_lossy()
                    .into_owned(),
                document: valid_document(),
            })
            .expect_err("non-json path must fail");
        assert_eq!(non_json.code(), "invalid_path");
    }
}
