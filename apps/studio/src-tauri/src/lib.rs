#![forbid(unsafe_code)]

mod bridge;

use std::process::{Command, Stdio};

#[cfg(any(windows, target_os = "linux"))]
use std::{env, fs, path::PathBuf};

use serde::{Deserialize, Serialize};
#[cfg(not(windows))]
use studio_core::VSCODE_EXECUTABLE;
use studio_core::{
    CreateCodeProjectRequest, CreateCodeProjectUiSourceRequest, CreatedCodeProject,
    CreatedCodeProjectUiSource, LoadCodeProjectArchitectureSourcesRequest,
    LoadCodeProjectPreviewStylesRequest, LoadTsxSourceRequest, LoadUiDocumentRequest,
    LoadedCodeProjectArchitectureSources, LoadedCodeProjectPreviewStyles, LoadedTsxSource,
    LoadedUiDocument, OpenCodeProjectAppRequest, OpenCodeProjectRequest, OpenInVsCodeRequest,
    OpenedCodeProject, ProjectAppTarget, ProjectRuntimeStatus, ProjectRuntimeStatusRequest,
    ProjectTaskRequest, ProjectTaskResult, ResolvedEditorTarget, SaveTsxSourceRequest,
    SaveUiDocumentRequest, SavedTsxSource, SavedUiDocument, ScaffoldCodeProjectStructureRequest,
    ScaffoldedCodeProjectStructure, ScanCodeProjectRequest, ScannedCodeProject,
    StartCodeProjectRequest, StudioCore, StudioCoreError,
};
use tauri::State;
use tauri::{Manager, RunEvent};

#[derive(Default)]
struct LaunchOptions {
    project: Option<String>,
}

fn launch_project_from_arguments(arguments: impl IntoIterator<Item = String>) -> Option<String> {
    let mut arguments = arguments.into_iter();
    let _executable = arguments.next();
    while let Some(argument) = arguments.next() {
        if argument == "--project" {
            return arguments.next().filter(|value| !value.trim().is_empty());
        }
        if let Some(value) = argument.strip_prefix("--project=")
            && !value.trim().is_empty()
        {
            return Some(value.to_owned());
        }
    }
    None
}

#[tauri::command]
fn get_launch_project(options: State<'_, LaunchOptions>) -> Option<String> {
    options.project.clone()
}

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

impl CommandFailure {
    fn background_task(error: impl std::fmt::Display) -> Self {
        Self {
            code: "background_task_failed",
            message: format!("native background task failed: {error}"),
        }
    }

    fn editor_launch(error: std::io::Error) -> Self {
        Self {
            code: if error.kind() == std::io::ErrorKind::NotFound {
                "vscode_unavailable"
            } else {
                "vscode_launch_failed"
            },
            message: if error.kind() == std::io::ErrorKind::NotFound {
                "VS Code's `code` command is unavailable. Install VS Code and add it to PATH."
                    .to_owned()
            } else {
                format!("could not launch VS Code: {error}")
            },
        }
    }

    fn app_launch(error: impl std::fmt::Display) -> Self {
        Self {
            code: "app_open_failed",
            message: format!(
                "could not open the running application in the system browser: {error}"
            ),
        }
    }

    fn preview_launch(error: impl std::fmt::Display) -> Self {
        Self {
            code: "preview_open_failed",
            message: format!("could not open the running application preview: {error}"),
        }
    }

    fn migration(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum ReactMigrationOperation {
    Start,
    Status,
    Verify,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReactMigrationRequest {
    operation: ReactMigrationOperation,
    source_path: Option<String>,
    target_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReactMigrationResponse {
    operation: ReactMigrationOperation,
    target_path: String,
    stdout: String,
    stderr: String,
    result: Option<serde_json::Value>,
}

const MAX_MIGRATION_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

fn react_migration_cli_arguments(
    operation: ReactMigrationOperation,
    source_path: Option<&str>,
    target_path: &str,
) -> Result<Vec<String>, CommandFailure> {
    let target = std::path::Path::new(target_path);
    if target_path.trim().is_empty() || !target.is_absolute() {
        return Err(CommandFailure::migration(
            "invalid_migration_request",
            "migration target must be an absolute folder path",
        ));
    }
    match operation {
        ReactMigrationOperation::Start => {
            let source_path = source_path.ok_or_else(|| {
                CommandFailure::migration(
                    "invalid_migration_request",
                    "React source is required for a new or resumed migration",
                )
            })?;
            let source = std::path::Path::new(source_path);
            if source_path.trim().is_empty() || !source.is_absolute() {
                return Err(CommandFailure::migration(
                    "invalid_migration_request",
                    "React source must be an absolute folder path",
                ));
            }
            if source == target || source.starts_with(target) || target.starts_with(source) {
                return Err(CommandFailure::migration(
                    "invalid_migration_request",
                    "React source and Srijika target must be separate, non-overlapping folders; the source is never modified",
                ));
            }
            Ok(vec![
                "migrate".to_owned(),
                "react".to_owned(),
                "--source".to_owned(),
                source_path.to_owned(),
                "--target".to_owned(),
                target_path.to_owned(),
                "--json".to_owned(),
            ])
        }
        ReactMigrationOperation::Status | ReactMigrationOperation::Verify => Ok(vec![
            "migrate".to_owned(),
            if operation == ReactMigrationOperation::Status {
                "status".to_owned()
            } else {
                "verify".to_owned()
            },
            "--target".to_owned(),
            target_path.to_owned(),
            "--json".to_owned(),
        ]),
    }
}

fn parse_migration_json(stdout: &str) -> Option<serde_json::Value> {
    serde_json::from_str(stdout.trim()).ok().or_else(|| {
        stdout
            .lines()
            .rev()
            .find_map(|line| serde_json::from_str(line.trim()).ok())
    })
}

/// Runs only the canonical Srijika migration CLI. Studio selects paths and
/// renders status; all scanning, planning, writes, resume state, and
/// verification remain owned by the shared migration engine behind the CLI.
#[tauri::command]
async fn run_react_migration(
    request: ReactMigrationRequest,
) -> Result<ReactMigrationResponse, CommandFailure> {
    let operation = request.operation;
    let arguments = react_migration_cli_arguments(
        operation,
        request.source_path.as_deref(),
        &request.target_path,
    )?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("srijika")
            .args(arguments)
            .stdin(Stdio::null())
            .output()
            .map_err(|error| {
                CommandFailure::migration(
                    if error.kind() == std::io::ErrorKind::NotFound {
                        "srijika_cli_unavailable"
                    } else {
                        "migration_launch_failed"
                    },
                    if error.kind() == std::io::ErrorKind::NotFound {
                        "the `srijika` CLI is unavailable on PATH; install @srijika/cli first"
                            .to_owned()
                    } else {
                        format!("could not start the Srijika migration CLI: {error}")
                    },
                )
            })?;
        if output.stdout.len() > MAX_MIGRATION_OUTPUT_BYTES
            || output.stderr.len() > MAX_MIGRATION_OUTPUT_BYTES
        {
            return Err(CommandFailure::migration(
                "migration_output_too_large",
                "Srijika migration output exceeded the safe Studio display limit",
            ));
        }
        let stdout = String::from_utf8(output.stdout).map_err(|_| {
            CommandFailure::migration(
                "invalid_migration_output",
                "Srijika migration output was not valid UTF-8",
            )
        })?;
        let stderr = String::from_utf8(output.stderr).map_err(|_| {
            CommandFailure::migration(
                "invalid_migration_output",
                "Srijika migration error output was not valid UTF-8",
            )
        })?;
        if !output.status.success() {
            let reason = stderr.trim();
            return Err(CommandFailure::migration(
                "migration_failed",
                if reason.is_empty() {
                    format!("Srijika migration exited with {}", output.status)
                } else {
                    format!("Srijika migration failed: {reason}")
                },
            ));
        }
        Ok(ReactMigrationResponse {
            operation,
            target_path: request.target_path,
            result: parse_migration_json(&stdout),
            stdout,
            stderr,
        })
    })
    .await
    .map_err(CommandFailure::background_task)?
}

/// Reads one versioned Srijika UI document from an explicit absolute JSON path.
#[tauri::command]
async fn load_ui_document(
    core: State<'_, StudioCore>,
    request: LoadUiDocumentRequest,
) -> Result<LoadedUiDocument, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.load_ui_document(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Validates and atomically writes one versioned Srijika UI document.
#[tauri::command]
async fn save_ui_document(
    core: State<'_, StudioCore>,
    request: SaveUiDocumentRequest,
) -> Result<SavedUiDocument, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.save_ui_document(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Creates a complete TSX-first Srijika project without overwriting an existing path.
#[tauri::command]
async fn create_code_project(
    core: State<'_, StudioCore>,
    request: CreateCodeProjectRequest,
) -> Result<CreatedCodeProject, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.create_code_project(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Creates a deterministic route-page UI/connector pair below `src/pages`.
#[tauri::command]
async fn create_code_project_ui_source(
    core: State<'_, StudioCore>,
    request: CreateCodeProjectUiSourceRequest,
) -> Result<CreatedCodeProjectUiSource, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.create_code_project_ui_source(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Adds one validated, no-overwrite capability to a canonical feature scope.
#[tauri::command]
async fn scaffold_code_project_structure(
    core: State<'_, StudioCore>,
    request: ScaffoldCodeProjectStructureRequest,
) -> Result<ScaffoldedCodeProjectStructure, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.scaffold_code_project_structure(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Opens an existing TSX-first project through its srijika.config.json entry.
#[tauri::command]
async fn open_code_project(
    core: State<'_, StudioCore>,
    request: OpenCodeProjectRequest,
) -> Result<OpenedCodeProject, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.open_code_project(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Reads the persisted `.ui.tsx` source of truth.
#[tauri::command]
async fn load_tsx_source(
    core: State<'_, StudioCore>,
    request: LoadTsxSourceRequest,
) -> Result<LoadedTsxSource, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.load_tsx_source(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Atomically writes the persisted `.ui.tsx` source of truth.
#[tauri::command]
async fn save_tsx_source(
    core: State<'_, StudioCore>,
    request: SaveTsxSourceRequest,
) -> Result<SavedTsxSource, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.save_tsx_source(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Reads the bounded, deterministic project tree without traversing generated
/// dependency/output folders or symbolic links.
#[tauri::command]
async fn scan_code_project(
    core: State<'_, StudioCore>,
    request: ScanCodeProjectRequest,
) -> Result<ScannedCodeProject, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.scan_code_project(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Loads all bounded TypeScript sources needed by the project architecture
/// validator without exposing an arbitrary filesystem reader.
#[tauri::command]
async fn load_code_project_architecture_sources(
    core: State<'_, StudioCore>,
    request: LoadCodeProjectArchitectureSourcesRequest,
) -> Result<LoadedCodeProjectArchitectureSources, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.load_code_project_architecture_sources(request)
    })
    .await
    .map_err(CommandFailure::background_task)?
    .map_err(CommandFailure::from)
}

/// Loads the project's explicitly configured preview CSS through the same
/// containment, symlink, UTF-8, and size checks as the project source model.
#[tauri::command]
async fn load_code_project_preview_styles(
    core: State<'_, StudioCore>,
    request: LoadCodeProjectPreviewStylesRequest,
) -> Result<LoadedCodeProjectPreviewStyles, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.load_code_project_preview_styles(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Opens a validated project folder/file/source location in VS Code. The
/// executable and every argument are fixed or separately validated; no shell
/// command string is constructed.
#[tauri::command]
async fn open_in_vscode(
    core: State<'_, StudioCore>,
    request: OpenInVsCodeRequest,
) -> Result<ResolvedEditorTarget, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let target = core
            .resolve_project_editor_target(request)
            .map_err(CommandFailure::from)?;
        launch_vscode(&target)?;
        Ok(target)
    })
    .await
    .map_err(CommandFailure::background_task)?
}

fn launch_vscode(target: &ResolvedEditorTarget) -> Result<(), CommandFailure> {
    let remote_authority = vscode_remote_authority();
    let arguments = vscode_arguments(target, remote_authority.as_deref());
    vscode_command()?
        .args(&arguments)
        .current_dir(&target.project_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(CommandFailure::editor_launch)?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn vscode_remote_authority() -> Option<String> {
    let distribution = env::var("WSL_DISTRO_NAME").ok()?;
    if distribution.is_empty()
        || distribution.len() > 64
        || !distribution.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return None;
    }
    Some(format!("wsl+{distribution}"))
}

#[cfg(not(target_os = "linux"))]
fn vscode_remote_authority() -> Option<String> {
    None
}

#[cfg(not(windows))]
fn vscode_command() -> Result<Command, CommandFailure> {
    #[cfg(target_os = "linux")]
    if vscode_remote_authority().is_some()
        && let Some(executable) = wsl_windows_vscode_executable()
    {
        return Ok(Command::new(executable));
    }
    Ok(Command::new(VSCODE_EXECUTABLE))
}

/// VS Code's WSL `code` shell launcher can block while locating Remote WSL.
/// Prefer the adjacent Windows GUI executable and pass the already validated
/// `--remote wsl+<distribution>` arguments directly.
#[cfg(target_os = "linux")]
fn wsl_windows_vscode_executable() -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    wsl_windows_vscode_candidates(&path)
        .into_iter()
        .find_map(|candidate| {
            let metadata = fs::symlink_metadata(&candidate).ok()?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return None;
            }
            fs::canonicalize(candidate).ok()
        })
}

#[cfg(target_os = "linux")]
fn wsl_windows_vscode_candidates(path: &std::ffi::OsStr) -> Vec<PathBuf> {
    env::split_paths(path)
        .filter(|directory| directory.is_absolute())
        .flat_map(|directory| {
            let mut candidates = vec![directory.join("Code.exe")];
            if let Some(parent) = directory.parent() {
                candidates.push(parent.join("Code.exe"));
            }
            candidates
        })
        .collect()
}

/// The PATH launcher on Windows is normally `code.cmd`. Batch files use
/// `cmd.exe` parsing, which is not safe for project-controlled path arguments.
/// Resolve the adjacent real GUI executable and invoke it directly instead.
#[cfg(windows)]
fn vscode_command() -> Result<Command, CommandFailure> {
    let executable = windows_vscode_executable().ok_or_else(|| {
        CommandFailure::editor_launch(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Code.exe was not found",
        ))
    })?;
    Ok(Command::new(executable))
}

#[cfg(windows)]
fn windows_vscode_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("Microsoft VS Code")
                .join("Code.exe"),
        );
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(program_files) = env::var_os(variable) {
            candidates.push(
                PathBuf::from(program_files)
                    .join("Microsoft VS Code")
                    .join("Code.exe"),
            );
        }
    }
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path).filter(|directory| directory.is_absolute()) {
            candidates.push(directory.join("Code.exe"));
            if let Some(parent) = directory.parent() {
                candidates.push(parent.join("Code.exe"));
            }
        }
    }

    candidates.into_iter().find_map(|candidate| {
        let metadata = fs::symlink_metadata(&candidate).ok()?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return None;
        }
        fs::canonicalize(candidate).ok()
    })
}

fn vscode_arguments(target: &ResolvedEditorTarget, remote_authority: Option<&str>) -> Vec<String> {
    // Never replace the user's currently focused VS Code workspace. Srijika
    // projects belong in their own window, even when another project is open.
    let mut arguments = vec!["--new-window".to_owned()];
    if let Some(authority) = remote_authority {
        arguments.push("--remote".to_owned());
        arguments.push(authority.to_owned());
    }
    if let Some(line) = target.line {
        // `current_dir` only controls the child process working directory; it
        // does not make the project a VS Code workspace. Pass the validated
        // root separately so source navigation keeps the full project open.
        arguments.push(target.project_path.clone());
        arguments.push("--goto".to_owned());
        arguments.push(format!(
            "{}:{line}:{}",
            target.target_path,
            target.column.unwrap_or(1)
        ));
    } else {
        arguments.push(target.target_path.clone());
    }
    arguments
}

/// Reports dependency/tool lifecycle state for one validated project.
#[tauri::command]
async fn get_project_runtime_status(
    core: State<'_, StudioCore>,
    request: ProjectRuntimeStatusRequest,
) -> Result<ProjectRuntimeStatus, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.get_project_runtime_status(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Installs exactly the lockfile-resolved dependency graph.
#[tauri::command]
async fn install_project_dependencies(
    core: State<'_, StudioCore>,
    request: ProjectTaskRequest,
) -> Result<ProjectTaskResult, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.install_project_dependencies(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Builds the generated application without blocking the Tauri UI thread.
#[tauri::command]
async fn build_code_project(
    core: State<'_, StudioCore>,
    request: ProjectTaskRequest,
) -> Result<ProjectTaskResult, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.build_code_project(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Starts the managed, loopback-only application dev server.
#[tauri::command]
async fn start_code_project(
    core: State<'_, StudioCore>,
    request: StartCodeProjectRequest,
) -> Result<ProjectRuntimeStatus, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.start_code_project(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Opens the managed full application in the system browser. The request has
/// no URL field: native runtime state supplies a ready loopback-only target.
#[tauri::command]
async fn open_code_project_app(
    core: State<'_, StudioCore>,
    request: OpenCodeProjectAppRequest,
) -> Result<ProjectAppTarget, CommandFailure> {
    let core = core.inner().clone();
    let target =
        tauri::async_runtime::spawn_blocking(move || core.resolve_project_app_target(request))
            .await
            .map_err(CommandFailure::background_task)?
            .map_err(CommandFailure::from)?;
    tauri_plugin_opener::open_url(&target.url, None::<&str>).map_err(CommandFailure::app_launch)?;
    Ok(target)
}

/// Opens the managed full application inside Srijika's dedicated preview
/// webview. The frontend supplies only the project root; native runtime state
/// resolves the URL from a tracked, ready loopback process.
#[tauri::command]
async fn open_code_project_preview(
    app: tauri::AppHandle,
    core: State<'_, StudioCore>,
    request: OpenCodeProjectAppRequest,
) -> Result<ProjectAppTarget, CommandFailure> {
    let core = core.inner().clone();
    let target =
        tauri::async_runtime::spawn_blocking(move || core.resolve_project_app_target(request))
            .await
            .map_err(CommandFailure::background_task)?
            .map_err(CommandFailure::from)?;
    let url = target
        .url
        .parse::<tauri::Url>()
        .map_err(CommandFailure::preview_launch)?;

    if let Some(window) = app.get_webview_window("srijika-preview") {
        window
            .navigate(url)
            .map_err(CommandFailure::preview_launch)?;
        window.show().map_err(CommandFailure::preview_launch)?;
        window.set_focus().map_err(CommandFailure::preview_launch)?;
    } else {
        tauri::WebviewWindowBuilder::new(&app, "srijika-preview", tauri::WebviewUrl::External(url))
            .title("Srijika Live Project Preview")
            .inner_size(1440.0, 900.0)
            .min_inner_size(720.0, 480.0)
            .resizable(true)
            .build()
            .map_err(CommandFailure::preview_launch)?;
    }

    Ok(target)
}

/// Stops the managed dev process tree and returns its final bounded output.
#[tauri::command]
async fn stop_code_project(
    core: State<'_, StudioCore>,
    request: ProjectTaskRequest,
) -> Result<ProjectRuntimeStatus, CommandFailure> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.stop_code_project(request))
        .await
        .map_err(CommandFailure::background_task)?
        .map_err(CommandFailure::from)
}

/// Opens or focuses the clean, live preview in a dedicated native webview window.
#[tauri::command]
fn open_preview_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("srijika-preview") {
        // This label may currently host a managed project's external URL.
        // Recreate it so browser/standalone mode cannot accidentally retain a
        // previous desktop project's runtime.
        window
            .destroy()
            .map_err(|error| format!("could not reset preview window: {error}"))?;
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "srijika-preview",
        tauri::WebviewUrl::App("preview".into()),
    )
    .title("Srijika Browser Preview")
    .inner_size(1440.0, 900.0)
    .min_inner_size(720.0, 480.0)
    .resizable(true)
    .build()
    .map_err(|error| format!("could not create preview window: {error}"))?;

    Ok(())
}

pub fn run() {
    let launch_options = LaunchOptions {
        project: launch_project_from_arguments(std::env::args()),
    };
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StudioCore::default())
        .manage(launch_options)
        .setup(|app| {
            let bridge = tauri::async_runtime::block_on(bridge::StudioBridge::start(app.handle()))?;
            app.manage(bridge);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_ui_document,
            save_ui_document,
            create_code_project,
            create_code_project_ui_source,
            scaffold_code_project_structure,
            run_react_migration,
            open_code_project,
            load_tsx_source,
            save_tsx_source,
            scan_code_project,
            load_code_project_architecture_sources,
            load_code_project_preview_styles,
            open_in_vscode,
            get_project_runtime_status,
            install_project_dependencies,
            build_code_project,
            start_code_project,
            open_code_project_app,
            open_code_project_preview,
            stop_code_project,
            open_preview_window,
            get_launch_project,
            bridge::get_bridge_status,
            bridge::set_bridge_frontend_ready,
            bridge::resolve_bridge_rpc,
        ])
        .build(tauri::generate_context!())
        .expect("Srijika Studio failed to start");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            if let Some(core) = app_handle.try_state::<StudioCore>() {
                core.shutdown_project_runtimes();
            }
            if let Some(bridge) = app_handle.try_state::<bridge::StudioBridge>() {
                bridge.shutdown();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use studio_core::{ResolvedEditorTarget, StudioCoreError};

    #[cfg(target_os = "linux")]
    use super::wsl_windows_vscode_candidates;
    use super::{
        CommandFailure, ReactMigrationOperation, launch_project_from_arguments,
        parse_migration_json, react_migration_cli_arguments, vscode_arguments,
    };

    #[test]
    fn reads_an_explicit_launch_project_without_accepting_empty_values() {
        assert_eq!(
            launch_project_from_arguments([
                "srijika-studio".to_owned(),
                "--project".to_owned(),
                "/tmp/srijika-app".to_owned(),
            ]),
            Some("/tmp/srijika-app".to_owned())
        );
        assert_eq!(
            launch_project_from_arguments(["srijika-studio".to_owned(), "--project=".to_owned(),]),
            None
        );
    }

    #[test]
    fn command_errors_expose_a_stable_code_and_safe_message() {
        let failure = CommandFailure::from(StudioCoreError::InvalidPath("path must be absolute"));

        assert_eq!(failure.code, "invalid_path");
        assert_eq!(
            failure.message,
            "invalid document path: path must be absolute"
        );
    }

    #[test]
    fn react_migration_arguments_match_the_canonical_cli_contract() {
        assert_eq!(
            react_migration_cli_arguments(
                ReactMigrationOperation::Start,
                Some("/workspace/legacy react"),
                "/workspace/new srijika",
            )
            .expect("start arguments"),
            [
                "migrate",
                "react",
                "--source",
                "/workspace/legacy react",
                "--target",
                "/workspace/new srijika",
                "--json",
            ]
        );
        assert_eq!(
            react_migration_cli_arguments(
                ReactMigrationOperation::Status,
                None,
                "/workspace/new srijika",
            )
            .expect("status arguments"),
            [
                "migrate",
                "status",
                "--target",
                "/workspace/new srijika",
                "--json",
            ]
        );
        assert_eq!(
            react_migration_cli_arguments(
                ReactMigrationOperation::Verify,
                None,
                "/workspace/new srijika",
            )
            .expect("verify arguments"),
            [
                "migrate",
                "verify",
                "--target",
                "/workspace/new srijika",
                "--json",
            ]
        );
    }

    #[test]
    fn react_migration_rejects_overlap_and_parses_pretty_status_json() {
        let error = react_migration_cli_arguments(
            ReactMigrationOperation::Start,
            Some("/workspace/react"),
            "/workspace/react/converted",
        )
        .expect_err("nested target must fail closed");
        assert_eq!(error.code, "invalid_migration_request");
        assert!(error.message.contains("source is never modified"));

        let parsed = parse_migration_json(
            r#"{
              "phase": "verified",
              "futureField": { "kept": true }
            }"#,
        )
        .expect("pretty JSON");
        assert_eq!(parsed["phase"], "verified");
        assert_eq!(parsed["futureField"]["kept"], true);
    }

    #[test]
    fn vscode_arguments_open_a_new_window_and_keep_paths_separate() {
        let file = ResolvedEditorTarget {
            project_path: "/workspace/srijika app".to_owned(),
            target_path: "/workspace/srijika app/src/Home UI.ui.tsx".to_owned(),
            line: Some(18),
            column: Some(7),
        };
        assert_eq!(
            vscode_arguments(&file, None),
            [
                "--new-window",
                "/workspace/srijika app",
                "--goto",
                "/workspace/srijika app/src/Home UI.ui.tsx:18:7"
            ]
        );

        let folder = ResolvedEditorTarget {
            project_path: "/workspace/app".to_owned(),
            target_path: "/workspace/app".to_owned(),
            line: None,
            column: None,
        };
        assert_eq!(
            vscode_arguments(&folder, None),
            ["--new-window", "/workspace/app"]
        );
    }

    #[test]
    fn vscode_arguments_open_linux_projects_through_the_wsl_workspace_host() {
        let file = ResolvedEditorTarget {
            project_path: "/home/beste/project/srijika-app".to_owned(),
            target_path: "/home/beste/project/srijika-app/src/Home.ui.tsx".to_owned(),
            line: Some(9),
            column: Some(3),
        };

        assert_eq!(
            vscode_arguments(&file, Some("wsl+Ubuntu")),
            [
                "--new-window",
                "--remote",
                "wsl+Ubuntu",
                "/home/beste/project/srijika-app",
                "--goto",
                "/home/beste/project/srijika-app/src/Home.ui.tsx:9:3"
            ]
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn finds_the_windows_gui_next_to_the_wsl_code_launcher() {
        let candidates = wsl_windows_vscode_candidates(std::ffi::OsStr::new(
            "/usr/bin:/mnt/c/Users/developer/AppData/Local/Programs/Microsoft VS Code/bin",
        ));

        assert!(candidates.contains(&std::path::PathBuf::from(
            "/mnt/c/Users/developer/AppData/Local/Programs/Microsoft VS Code/Code.exe"
        )));
    }
}
