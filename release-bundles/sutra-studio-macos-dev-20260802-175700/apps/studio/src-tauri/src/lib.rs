#![forbid(unsafe_code)]

mod bridge;

use serde::Serialize;
use studio_core::{
    LoadUiDocumentRequest, LoadedUiDocument, SaveUiDocumentRequest, SavedUiDocument, StudioCore,
    StudioCoreError,
};
use tauri::State;
use tauri::{Manager, RunEvent};

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

/// Opens or focuses the clean, live preview in a dedicated native webview window.
#[tauri::command]
fn open_preview_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("sutra-preview") {
        window
            .show()
            .map_err(|error| format!("could not show preview window: {error}"))?;
        window
            .set_focus()
            .map_err(|error| format!("could not focus preview window: {error}"))?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "sutra-preview",
        tauri::WebviewUrl::App("preview".into()),
    )
    .title("Sutra Browser Preview")
    .inner_size(1440.0, 900.0)
    .min_inner_size(720.0, 480.0)
    .resizable(true)
    .build()
    .map_err(|error| format!("could not create preview window: {error}"))?;

    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StudioCore::default())
        .setup(|app| {
            let bridge = tauri::async_runtime::block_on(bridge::StudioBridge::start(app.handle()))?;
            app.manage(bridge);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_ui_document,
            save_ui_document,
            open_preview_window,
            bridge::get_bridge_status,
            bridge::set_bridge_frontend_ready,
            bridge::resolve_bridge_rpc,
        ])
        .build(tauri::generate_context!())
        .expect("Sutra Studio failed to start");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit)
            && let Some(bridge) = app_handle.try_state::<bridge::StudioBridge>()
        {
            bridge.shutdown();
        }
    });
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
