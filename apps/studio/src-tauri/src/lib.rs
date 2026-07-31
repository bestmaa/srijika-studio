#![forbid(unsafe_code)]

use serde::Serialize;
use studio_core::{
    LoadUiDocumentRequest, LoadedUiDocument, SaveUiDocumentRequest, SavedUiDocument, StudioCore,
    StudioCoreError,
};
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandFailure {
    code: &'static str,
    message: String,
}

impl From<StudioCoreError> for CommandFailure {
    fn from(error: StudioCoreError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}

/// Reads one versioned Sutra UI document from an explicit absolute JSON path.
#[tauri::command]
fn load_ui_document(
    core: State<'_, StudioCore>,
    request: LoadUiDocumentRequest,
) -> Result<LoadedUiDocument, CommandFailure> {
    core.load_ui_document(request).map_err(CommandFailure::from)
}

/// Validates and atomically writes one versioned Sutra UI document.
#[tauri::command]
fn save_ui_document(
    core: State<'_, StudioCore>,
    request: SaveUiDocumentRequest,
) -> Result<SavedUiDocument, CommandFailure> {
    core.save_ui_document(request).map_err(CommandFailure::from)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StudioCore::default())
        .invoke_handler(tauri::generate_handler![load_ui_document, save_ui_document])
        .run(tauri::generate_context!())
        .expect("Sutra Studio failed to start");
}

#[cfg(test)]
mod tests {
    use studio_core::StudioCoreError;

    use super::CommandFailure;

    #[test]
    fn command_errors_expose_a_stable_code_and_safe_message() {
        let failure = CommandFailure::from(StudioCoreError::InvalidPath("path must be absolute"));

        assert_eq!(failure.code, "invalid_path");
        assert_eq!(
            failure.message,
            "invalid document path: path must be absolute"
        );
    }
}
