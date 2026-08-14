#![forbid(unsafe_code)]

use std::{
    cmp::Ordering,
    collections::{BinaryHeap, HashMap, HashSet},
    fs::{self, File},
    io::{ErrorKind, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex, MutexGuard},
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use project_store::{JsonProjectStore, StoreError};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tempfile::Builder;
use thiserror::Error;

pub const UI_DOCUMENT_FORMAT_VERSION: u64 = 1;
const JSON_EXTENSION: &str = "json";
const MAX_TSX_SOURCE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PROJECT_CONFIG_BYTES: u64 = 64 * 1024;
const MAX_PROJECT_FILE_BYTES: usize = 4 * 1024 * 1024;
const MAX_PROJECT_BYTES: usize = 24 * 1024 * 1024;
const MAX_PROJECT_FILES: usize = 256;
const MAX_PROJECT_TREE_ENTRIES: usize = 4_096;
const MAX_PROJECT_TREE_DEPTH: usize = 24;
const MAX_PROJECT_TREE_METADATA_BYTES: usize = 2 * 1024 * 1024;
const MAX_PROJECT_TREE_HASH_BYTES: u64 = 24 * 1024 * 1024;
const MAX_ARCHITECTURE_SOURCE_FILES: usize = 4_096;
const MAX_ARCHITECTURE_SOURCE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ARCHITECTURE_SOURCES_BYTES: u64 = 24 * 1024 * 1024;
const MAX_PREVIEW_STYLESHEETS: usize = 16;
const MAX_PREVIEW_STYLESHEET_BYTES: u64 = 1024 * 1024;
const MAX_PREVIEW_STYLES_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PREVIEW_ASSETS: usize = 16;
const MAX_PREVIEW_ASSET_BYTES: u64 = 512 * 1024;
const MAX_PREVIEW_ASSETS_BYTES: u64 = 2 * 1024 * 1024;
const MAX_NEW_UI_RELATIVE_PATH_BYTES: usize = 1_024;
const MAX_NEW_UI_DEPTH: usize = 16;
const MAX_COMPONENT_NAME_BYTES: usize = 64;
const MAX_PACKAGE_JSON_BYTES: u64 = 1024 * 1024;
const MAX_LOCKFILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_TOOL_OUTPUT_BYTES: usize = 256 * 1024;
const MIN_DEV_SERVER_PORT: u16 = 1024;
const DEV_SERVER_READINESS_TIMEOUT: Duration = Duration::from_millis(100);
const DEV_SERVER_START_POLL_INTERVAL: Duration = Duration::from_millis(50);
const DEV_SERVER_START_TIMEOUT: Duration = Duration::from_secs(45);
const LIVE_PREVIEW_BRIDGE_RELATIVE_PATH: &str = "src/srijika/preview-bridge.ts";
const LIVE_PREVIEW_BRIDGE_SOURCE: &str = include_str!("../assets/live-preview-bridge.ts");
const IGNORED_PROJECT_DIRECTORIES: [&str; 4] = [".git", "node_modules", "dist", "build"];
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
#[derive(Debug, Clone)]
pub struct StudioCore {
    store: JsonProjectStore,
    runtimes: Arc<Mutex<RuntimeRegistry>>,
}

impl Default for StudioCore {
    fn default() -> Self {
        Self {
            store: JsonProjectStore::default(),
            runtimes: Arc::new(Mutex::new(RuntimeRegistry::default())),
        }
    }
}

impl StudioCore {
    pub fn new(store: JsonProjectStore) -> Self {
        Self {
            store,
            runtimes: Arc::new(Mutex::new(RuntimeRegistry::default())),
        }
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

    /// Reads one explicit Srijika UI source file. TSX is the persisted source of
    /// truth; the JSON UI document is compiled from this text in the frontend.
    pub fn load_tsx_source(
        &self,
        request: LoadTsxSourceRequest,
    ) -> Result<LoadedTsxSource, StudioCoreError> {
        let path = checked_tsx_path(&request.path)?;
        let metadata =
            fs::metadata(&path).map_err(|source| source_io("inspect TSX source", &path, source))?;
        if !metadata.is_file() {
            return Err(StudioCoreError::InvalidPath(
                "TSX source path must identify a file",
            ));
        }
        if metadata.len() > MAX_TSX_SOURCE_BYTES {
            return Err(StudioCoreError::SourceTooLarge {
                max: MAX_TSX_SOURCE_BYTES,
                actual: metadata.len(),
            });
        }
        let mut source = String::with_capacity(metadata.len().min(usize::MAX as u64) as usize);
        File::open(&path)
            .map_err(|error| source_io("open TSX source", &path, error))?
            .take(MAX_TSX_SOURCE_BYTES.saturating_add(1))
            .read_to_string(&mut source)
            .map_err(|error| source_io("read UTF-8 TSX source", &path, error))?;
        if source.len() as u64 > MAX_TSX_SOURCE_BYTES {
            return Err(StudioCoreError::SourceTooLarge {
                max: MAX_TSX_SOURCE_BYTES,
                actual: source.len() as u64,
            });
        }
        Ok(LoadedTsxSource {
            path: request.path,
            bytes: source.len() as u64,
            hash: source_hash(&source),
            source,
        })
    }

    /// Atomically writes one explicit `.ui.tsx` file without persisting a
    /// second JSON source of truth.
    pub fn save_tsx_source(
        &self,
        request: SaveTsxSourceRequest,
    ) -> Result<SavedTsxSource, StudioCoreError> {
        let path = checked_tsx_path(&request.path)?;
        if request.source.len() as u64 > MAX_TSX_SOURCE_BYTES {
            return Err(StudioCoreError::SourceTooLarge {
                max: MAX_TSX_SOURCE_BYTES,
                actual: request.source.len() as u64,
            });
        }
        let replaced = path.exists();
        if replaced {
            let current = self.load_tsx_source(LoadTsxSourceRequest {
                path: request.path.clone(),
            })?;
            if request.expected_hash.as_deref() != Some(current.hash.as_str()) {
                return Err(StudioCoreError::SourceConflict {
                    expected: request.expected_hash,
                    actual: current.hash,
                });
            }
        }
        atomic_write_text(&path, &request.source)?;
        Ok(SavedTsxSource {
            path: request.path,
            bytes: request.source.len() as u64,
            hash: source_hash(&request.source),
            replaced,
        })
    }

    /// Creates a complete code-first project in a new, explicit directory.
    /// Existing paths are never merged or overwritten.
    pub fn create_code_project(
        &self,
        request: CreateCodeProjectRequest,
    ) -> Result<CreatedCodeProject, StudioCoreError> {
        let target = checked_project_path(&request.path)?;
        if target.exists() {
            return Err(StudioCoreError::ProjectAlreadyExists(target));
        }
        validate_project_files(&request.files, &request.entry_source)?;
        let parent = target
            .parent()
            .filter(|value| !value.as_os_str().is_empty())
            .ok_or(StudioCoreError::InvalidPath(
                "project path must have a parent directory",
            ))?;
        if !parent.is_dir() {
            return Err(StudioCoreError::InvalidPath(
                "project parent directory does not exist",
            ));
        }

        fs::create_dir(&target)
            .map_err(|source| source_io("create project directory", &target, source))?;
        let write_result = (|| {
            for file in &request.files {
                let destination = target.join(&file.path);
                if let Some(directory) = destination.parent() {
                    fs::create_dir_all(directory).map_err(|source| {
                        source_io("create project subdirectory", directory, source)
                    })?;
                }
                atomic_write_text(&destination, &file.contents)?;
            }
            Ok::<(), StudioCoreError>(())
        })();

        if let Err(error) = write_result {
            let _ = fs::remove_dir_all(&target);
            return Err(error);
        }

        let bytes = request
            .files
            .iter()
            .map(|file| file.contents.len() as u64)
            .sum();
        Ok(CreatedCodeProject {
            path: request.path,
            entry_source_path: target
                .join(&request.entry_source)
                .to_string_lossy()
                .into_owned(),
            file_count: request.files.len(),
            bytes,
        })
    }

    /// Creates one route-level UI page and its required connector below `src/pages` in an
    /// already-open Srijika project. Feature UI must use the ownership-aware feature scaffold.
    /// The source text is generated by native code so a caller
    /// cannot use this narrow command as an arbitrary project file writer.
    /// No requested target is ever overwritten and a failed pair is rolled back.
    pub fn create_code_project_ui_source(
        &self,
        request: CreateCodeProjectUiSourceRequest,
    ) -> Result<CreatedCodeProjectUiSource, StudioCoreError> {
        let project = validate_code_project_root(&request.project_path)?;
        validate_component_name(&request.component_name)?;
        if request.kind != CodeProjectUiSourceKind::Page {
            return Err(StudioCoreError::InvalidProject(
                "standalone component roots are retired; create a feature under src/features",
            ));
        }
        if !request.create_connector {
            return Err(StudioCoreError::InvalidProject(
                "every page requires its matching Connector",
            ));
        }
        let relative_path =
            validate_new_ui_relative_path(&request.relative_path, &request.component_name)?;
        let response_relative_path = path_to_forward_slashes(&relative_path)?;
        if !response_relative_path.starts_with("src/pages/") {
            return Err(StudioCoreError::InvalidProject(
                "route-level UI pages must be created under src/pages",
            ));
        }
        let connector_file_name = format!("{}.connector.tsx", request.component_name);
        let connector_relative_path = relative_path
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(connector_file_name);
        let ui_path = project.canonical_root.join(&relative_path);
        let connector_path = project.canonical_root.join(&connector_relative_path);
        let (source, connector_source) = new_ui_source_pair(request.kind, &request.component_name);

        let created_directories = ensure_safe_project_directory(
            &project.canonical_root,
            relative_path.parent().unwrap_or_else(|| Path::new("")),
        )?;
        let creation_result = (|| {
            refuse_existing_project_file(&ui_path)?;
            if request.create_connector {
                refuse_existing_project_file(&connector_path)?;
            }
            atomic_create_text(&project.canonical_root, &ui_path, &source)?;
            if request.create_connector
                && let Err(error) =
                    atomic_create_text(&project.canonical_root, &connector_path, &connector_source)
            {
                let _ = fs::remove_file(&ui_path);
                return Err(error);
            }
            Ok::<(), StudioCoreError>(())
        })();

        if let Err(error) = creation_result {
            remove_created_directories(&created_directories);
            return Err(error);
        }

        Ok(CreatedCodeProjectUiSource {
            path: ui_path.to_string_lossy().into_owned(),
            relative_path: response_relative_path,
            connector_path: request
                .create_connector
                .then(|| connector_path.to_string_lossy().into_owned()),
            bytes: source.len() as u64,
            hash: source_hash(&source),
            source,
            kind: request.kind,
            component_name: request.component_name,
        })
    }

    /// Adds one validated capability to the canonical `src/features/<feature>`
    /// hierarchy. New Feature, Slot, and Part owners always include their UI
    /// and required Connector. All paths are derived from validated PascalCase
    /// names, so callers cannot turn this narrow command into an arbitrary file
    /// writer. Existing files are never replaced and multi-file capabilities
    /// roll back completely when any target cannot be created.
    pub fn scaffold_code_project_structure(
        &self,
        request: ScaffoldCodeProjectStructureRequest,
    ) -> Result<ScaffoldedCodeProjectStructure, StudioCoreError> {
        let project = validate_code_project_root(&request.project_path)?;
        validate_component_name(&request.feature_name)?;

        let feature_slug = pascal_case_path_segment(&request.feature_name)?;
        let feature_store_stem = lower_camel_owner_name(&request.feature_name)?;
        let feature_relative = PathBuf::from("src").join("features").join(&feature_slug);
        let feature_ui_relative = feature_relative.join(format!("{}.ui.tsx", request.feature_name));
        if !matches!(
            &request.capability,
            CodeProjectScaffoldCapability::Feature { .. }
        ) {
            validate_existing_scaffold_ui(&project.canonical_root, &feature_ui_relative)?;
        }

        let mut plans = Vec::new();
        match &request.capability {
            CodeProjectScaffoldCapability::Feature {
                create_connector,
                create_hook,
                create_store,
                create_logic,
                create_api,
                create_types,
                hook_name,
            } => {
                if !create_connector {
                    return Err(StudioCoreError::InvalidProject(
                        "every Feature requires its matching Connector",
                    ));
                }
                plans.push(scaffold_file_plan(
                    feature_ui_relative,
                    CodeProjectScaffoldFileRole::FeatureUi,
                    feature_ui_source(&request.feature_name),
                ));
                append_owner_capability_plans(
                    &mut plans,
                    &feature_relative,
                    &request.feature_name,
                    OwnerFileRoles {
                        connector: CodeProjectScaffoldFileRole::FeatureConnector,
                        hook: CodeProjectScaffoldFileRole::FeatureHook,
                        store: CodeProjectScaffoldFileRole::FeatureStore,
                        logic: CodeProjectScaffoldFileRole::FeatureLogic,
                        api: CodeProjectScaffoldFileRole::FeatureApi,
                        types: CodeProjectScaffoldFileRole::FeatureTypes,
                    },
                    OwnerLayerSelection {
                        hook: *create_hook,
                        store: *create_store,
                        logic: *create_logic,
                        api: *create_api,
                        types: *create_types,
                    },
                    *create_connector,
                    hook_name.as_deref(),
                )?;
            }
            CodeProjectScaffoldCapability::FeatureConnector => {
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &feature_relative,
                    &request.feature_name,
                );
                plans.push(scaffold_file_plan(
                    feature_relative.join(format!("{}.connector.tsx", request.feature_name)),
                    CodeProjectScaffoldFileRole::FeatureConnector,
                    progressive_connector_source(&request.feature_name, layers),
                ));
            }
            CodeProjectScaffoldCapability::FeatureStore => {
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &feature_relative,
                    &request.feature_name,
                );
                plans.push(scaffold_file_plan(
                    feature_relative.join(format!("{feature_store_stem}.store.ts")),
                    CodeProjectScaffoldFileRole::FeatureStore,
                    progressive_store_source(&request.feature_name, layers),
                ));
            }
            CodeProjectScaffoldCapability::FeatureHook => {
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &feature_relative,
                    &request.feature_name,
                );
                plans.push(scaffold_file_plan(
                    feature_relative.join(format!("use{}.ts", request.feature_name)),
                    CodeProjectScaffoldFileRole::FeatureHook,
                    progressive_hook_source(&request.feature_name, layers),
                ));
            }
            CodeProjectScaffoldCapability::FeatureBehaviorHook { hook_name } => {
                validate_scoped_hook_name(hook_name, &request.feature_name)?;
                plans.push(scaffold_file_plan(
                    feature_relative
                        .join("hooks")
                        .join(format!("{hook_name}.ts")),
                    CodeProjectScaffoldFileRole::FeatureHook,
                    hook_source(hook_name, &request.feature_name),
                ));
            }
            CodeProjectScaffoldCapability::FeatureLogic => {
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &feature_relative,
                    &request.feature_name,
                );
                plans.push(scaffold_file_plan(
                    feature_relative.join(format!("{feature_store_stem}.logic.ts")),
                    CodeProjectScaffoldFileRole::FeatureLogic,
                    progressive_logic_source(&request.feature_name, layers),
                ));
            }
            CodeProjectScaffoldCapability::FeatureApi => {
                plans.push(scaffold_file_plan(
                    feature_relative.join(format!("{feature_store_stem}.api.ts")),
                    CodeProjectScaffoldFileRole::FeatureApi,
                    progressive_api_source(&request.feature_name),
                ));
            }
            CodeProjectScaffoldCapability::FeatureTypes => {
                plans.push(scaffold_file_plan(
                    feature_relative.join(format!("{feature_store_stem}.types.ts")),
                    CodeProjectScaffoldFileRole::FeatureTypes,
                    owner_types_source(&request.feature_name),
                ));
            }
            CodeProjectScaffoldCapability::Slot {
                slot_name,
                create_connector,
                create_hook,
                create_store,
                create_logic,
                create_api,
                create_types,
                hook_name,
                part_name,
                create_part_connector,
            } => {
                if !create_connector {
                    return Err(StudioCoreError::InvalidProject(
                        "every Slot requires its matching Connector",
                    ));
                }
                validate_component_name(slot_name)?;
                let slot_slug = pascal_case_path_segment(slot_name)?;
                let slot_relative = feature_relative.join("slots").join(&slot_slug);
                plans.push(scaffold_file_plan(
                    slot_relative.join(format!("{slot_name}.ui.tsx")),
                    CodeProjectScaffoldFileRole::SlotUi,
                    slot_ui_source(slot_name),
                ));
                append_owner_capability_plans(
                    &mut plans,
                    &slot_relative,
                    slot_name,
                    OwnerFileRoles {
                        connector: CodeProjectScaffoldFileRole::SlotConnector,
                        hook: CodeProjectScaffoldFileRole::SlotHook,
                        store: CodeProjectScaffoldFileRole::SlotStore,
                        logic: CodeProjectScaffoldFileRole::SlotLogic,
                        api: CodeProjectScaffoldFileRole::SlotApi,
                        types: CodeProjectScaffoldFileRole::SlotTypes,
                    },
                    OwnerLayerSelection {
                        hook: *create_hook,
                        store: *create_store,
                        logic: *create_logic,
                        api: *create_api,
                        types: *create_types,
                    },
                    *create_connector,
                    hook_name.as_deref(),
                )?;
                if let Some(part_name) = part_name {
                    if !create_part_connector {
                        return Err(StudioCoreError::InvalidProject(
                            "every Part requires its matching Connector",
                        ));
                    }
                    validate_component_name(part_name)?;
                    let part_slug = pascal_case_path_segment(part_name)?;
                    let part_relative = slot_relative.join("parts").join(part_slug);
                    plans.push(scaffold_file_plan(
                        part_relative.join(format!("{part_name}.ui.tsx")),
                        CodeProjectScaffoldFileRole::PartUi,
                        part_ui_source(part_name),
                    ));
                    if *create_part_connector {
                        plans.push(scaffold_file_plan(
                            part_relative.join(format!("{part_name}.connector.tsx")),
                            CodeProjectScaffoldFileRole::PartConnector,
                            connector_source(part_name),
                        ));
                    }
                } else if *create_part_connector {
                    return Err(StudioCoreError::InvalidProject(
                        "a part connector requires a part name",
                    ));
                }
            }
            CodeProjectScaffoldCapability::SlotHook { slot_name } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                )?;
                let layers =
                    existing_owner_layers(&project.canonical_root, &slot_relative, slot_name);
                plans.push(scaffold_file_plan(
                    slot_relative.join(format!("use{slot_name}.ts")),
                    CodeProjectScaffoldFileRole::SlotHook,
                    progressive_hook_source(slot_name, layers),
                ));
            }
            CodeProjectScaffoldCapability::SlotBehaviorHook {
                slot_name,
                hook_name,
            } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                )?;
                validate_scoped_hook_name(hook_name, slot_name)?;
                plans.push(scaffold_file_plan(
                    slot_relative.join("hooks").join(format!("{hook_name}.ts")),
                    CodeProjectScaffoldFileRole::SlotHook,
                    hook_source(hook_name, slot_name),
                ));
            }
            CodeProjectScaffoldCapability::SlotConnector { slot_name } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                )?;
                let layers =
                    existing_owner_layers(&project.canonical_root, &slot_relative, slot_name);
                plans.push(scaffold_file_plan(
                    slot_relative.join(format!("{slot_name}.connector.tsx")),
                    CodeProjectScaffoldFileRole::SlotConnector,
                    progressive_connector_source(slot_name, layers),
                ));
            }
            CodeProjectScaffoldCapability::SlotStore { slot_name } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                )?;
                let slot_store_stem = lower_camel_owner_name(slot_name)?;
                let layers =
                    existing_owner_layers(&project.canonical_root, &slot_relative, slot_name);
                plans.push(scaffold_file_plan(
                    slot_relative.join(format!("{slot_store_stem}.store.ts")),
                    CodeProjectScaffoldFileRole::SlotStore,
                    progressive_store_source(slot_name, layers),
                ));
            }
            CodeProjectScaffoldCapability::SlotLogic { slot_name } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                )?;
                let stem = lower_camel_owner_name(slot_name)?;
                let layers =
                    existing_owner_layers(&project.canonical_root, &slot_relative, slot_name);
                plans.push(scaffold_file_plan(
                    slot_relative.join(format!("{stem}.logic.ts")),
                    CodeProjectScaffoldFileRole::SlotLogic,
                    progressive_logic_source(slot_name, layers),
                ));
            }
            CodeProjectScaffoldCapability::SlotApi { slot_name } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                )?;
                let stem = lower_camel_owner_name(slot_name)?;
                plans.push(scaffold_file_plan(
                    slot_relative.join(format!("{stem}.api.ts")),
                    CodeProjectScaffoldFileRole::SlotApi,
                    progressive_api_source(slot_name),
                ));
            }
            CodeProjectScaffoldCapability::SlotTypes { slot_name } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                )?;
                let stem = lower_camel_owner_name(slot_name)?;
                plans.push(scaffold_file_plan(
                    slot_relative.join(format!("{stem}.types.ts")),
                    CodeProjectScaffoldFileRole::SlotTypes,
                    owner_types_source(slot_name),
                ));
            }
            CodeProjectScaffoldCapability::Part {
                slot_name,
                part_name,
                create_connector,
                create_hook,
                create_store,
                create_logic,
                create_api,
                create_types,
                hook_name,
            } => {
                if !create_connector {
                    return Err(StudioCoreError::InvalidProject(
                        "every Part requires its matching Connector",
                    ));
                }
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                )?;
                validate_component_name(part_name)?;
                let part_slug = pascal_case_path_segment(part_name)?;
                let part_relative = slot_relative.join("parts").join(&part_slug);
                plans.push(scaffold_file_plan(
                    part_relative.join(format!("{part_name}.ui.tsx")),
                    CodeProjectScaffoldFileRole::PartUi,
                    part_ui_source(part_name),
                ));
                append_owner_capability_plans(
                    &mut plans,
                    &part_relative,
                    part_name,
                    OwnerFileRoles {
                        connector: CodeProjectScaffoldFileRole::PartConnector,
                        hook: CodeProjectScaffoldFileRole::PartHook,
                        store: CodeProjectScaffoldFileRole::PartStore,
                        logic: CodeProjectScaffoldFileRole::PartLogic,
                        api: CodeProjectScaffoldFileRole::PartApi,
                        types: CodeProjectScaffoldFileRole::PartTypes,
                    },
                    OwnerLayerSelection {
                        hook: *create_hook,
                        store: *create_store,
                        logic: *create_logic,
                        api: *create_api,
                        types: *create_types,
                    },
                    *create_connector,
                    hook_name.as_deref(),
                )?;
            }
            CodeProjectScaffoldCapability::PartConnector {
                slot_name,
                part_name,
            } => {
                let part_relative = validated_existing_part_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    part_name,
                )?;
                let layers =
                    existing_owner_layers(&project.canonical_root, &part_relative, part_name);
                plans.push(scaffold_file_plan(
                    part_relative.join(format!("{part_name}.connector.tsx")),
                    CodeProjectScaffoldFileRole::PartConnector,
                    progressive_connector_source(part_name, layers),
                ));
            }
            CodeProjectScaffoldCapability::PartStore {
                slot_name,
                part_name,
            } => {
                let part_relative = validated_existing_part_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    part_name,
                )?;
                let part_store_stem = lower_camel_owner_name(part_name)?;
                let layers =
                    existing_owner_layers(&project.canonical_root, &part_relative, part_name);
                plans.push(scaffold_file_plan(
                    part_relative.join(format!("{part_store_stem}.store.ts")),
                    CodeProjectScaffoldFileRole::PartStore,
                    progressive_store_source(part_name, layers),
                ));
            }
            CodeProjectScaffoldCapability::PartHook {
                slot_name,
                part_name,
            } => {
                let part_relative = validated_existing_part_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    part_name,
                )?;
                let layers =
                    existing_owner_layers(&project.canonical_root, &part_relative, part_name);
                plans.push(scaffold_file_plan(
                    part_relative.join(format!("use{part_name}.ts")),
                    CodeProjectScaffoldFileRole::PartHook,
                    progressive_hook_source(part_name, layers),
                ));
            }
            CodeProjectScaffoldCapability::PartBehaviorHook {
                slot_name,
                part_name,
                hook_name,
            } => {
                let part_relative = validated_existing_part_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    part_name,
                )?;
                validate_scoped_hook_name(hook_name, part_name)?;
                plans.push(scaffold_file_plan(
                    part_relative.join("hooks").join(format!("{hook_name}.ts")),
                    CodeProjectScaffoldFileRole::PartHook,
                    hook_source(hook_name, part_name),
                ));
            }
            CodeProjectScaffoldCapability::PartLogic {
                slot_name,
                part_name,
            } => {
                let part_relative = validated_existing_part_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    part_name,
                )?;
                let stem = lower_camel_owner_name(part_name)?;
                let layers =
                    existing_owner_layers(&project.canonical_root, &part_relative, part_name);
                plans.push(scaffold_file_plan(
                    part_relative.join(format!("{stem}.logic.ts")),
                    CodeProjectScaffoldFileRole::PartLogic,
                    progressive_logic_source(part_name, layers),
                ));
            }
            CodeProjectScaffoldCapability::PartApi {
                slot_name,
                part_name,
            } => {
                let part_relative = validated_existing_part_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    part_name,
                )?;
                let stem = lower_camel_owner_name(part_name)?;
                plans.push(scaffold_file_plan(
                    part_relative.join(format!("{stem}.api.ts")),
                    CodeProjectScaffoldFileRole::PartApi,
                    progressive_api_source(part_name),
                ));
            }
            CodeProjectScaffoldCapability::PartTypes {
                slot_name,
                part_name,
            } => {
                let part_relative = validated_existing_part_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    part_name,
                )?;
                let stem = lower_camel_owner_name(part_name)?;
                plans.push(scaffold_file_plan(
                    part_relative.join(format!("{stem}.types.ts")),
                    CodeProjectScaffoldFileRole::PartTypes,
                    owner_types_source(part_name),
                ));
            }
        }

        let files = create_scaffold_files(&project.canonical_root, plans)?;
        let bytes = files.iter().map(|file| file.bytes).sum();
        Ok(ScaffoldedCodeProjectStructure {
            project_path: project.canonical_root.to_string_lossy().into_owned(),
            feature_name: request.feature_name,
            feature_path: path_to_forward_slashes(&feature_relative)?,
            capability: request.capability,
            files,
            bytes,
        })
    }

    /// Opens an existing Srijika project through its bounded configuration and
    /// returns the configured TSX entry source. Project files are never
    /// executed while building the Studio read model.
    pub fn open_code_project(
        &self,
        request: OpenCodeProjectRequest,
    ) -> Result<OpenedCodeProject, StudioCoreError> {
        let project = validate_code_project_root(&request.path)?;
        let entry_source_path = project.entry_path.to_string_lossy().into_owned();
        let loaded = self.load_tsx_source(LoadTsxSourceRequest {
            path: entry_source_path.clone(),
        })?;
        Ok(OpenedCodeProject {
            path: request.path,
            entry_source_path,
            bytes: loaded.bytes,
            hash: loaded.hash,
            source: loaded.source,
        })
    }

    /// Builds a deterministic, bounded filesystem read model for the project
    /// explorer. Generated output and dependency directories are omitted, and
    /// symbolic links are never followed or returned.
    pub fn scan_code_project(
        &self,
        request: ScanCodeProjectRequest,
    ) -> Result<ScannedCodeProject, StudioCoreError> {
        let project = validate_code_project_root(&request.path)?;
        let mut scan = ProjectTreeScan::new(&project.canonical_root);
        scan_directory(&project.canonical_root, Path::new(""), 0, &mut scan)?;

        Ok(ScannedCodeProject {
            path: project.canonical_root.to_string_lossy().into_owned(),
            entry_source_path: project.entry_path.to_string_lossy().into_owned(),
            entries: scan.entries,
            truncated: scan.truncated,
        })
    }

    /// Loads the complete bounded TypeScript ownership model used by Srijika's
    /// architecture validator. The project root and config are validated first;
    /// generated/ignored directories and symbolic links are never traversed.
    pub fn load_code_project_architecture_sources(
        &self,
        request: LoadCodeProjectArchitectureSourcesRequest,
    ) -> Result<LoadedCodeProjectArchitectureSources, StudioCoreError> {
        let project = validate_code_project_root(&request.path)?;
        let mut scan = ProjectTreeScan::new(&project.canonical_root);
        scan_directory(&project.canonical_root, Path::new(""), 0, &mut scan)?;

        let mut candidates = scan
            .entries
            .into_iter()
            .filter(|entry| {
                entry.kind == ProjectTreeEntryKind::File
                    && is_architecture_source_path(&entry.relative_path)
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

        let mut sources = Vec::with_capacity(candidates.len().min(MAX_ARCHITECTURE_SOURCE_FILES));
        let mut total_bytes = 0_u64;
        let mut truncated = scan.truncated;
        for entry in candidates {
            if sources.len() >= MAX_ARCHITECTURE_SOURCE_FILES {
                truncated = true;
                break;
            }
            let expected_bytes = entry.bytes.ok_or(StudioCoreError::InvalidProject(
                "architecture source must be a regular file",
            ))?;
            if expected_bytes > MAX_ARCHITECTURE_SOURCE_BYTES
                || total_bytes.saturating_add(expected_bytes) > MAX_ARCHITECTURE_SOURCES_BYTES
            {
                truncated = true;
                continue;
            }

            let source_path = PathBuf::from(&entry.path);
            let canonical_path = fs::canonicalize(&source_path)
                .map_err(|source| source_io("resolve architecture source", &source_path, source))?;
            ensure_project_containment(&project.canonical_root, &canonical_path)?;
            let source = read_regular_utf8_file(
                &canonical_path,
                MAX_ARCHITECTURE_SOURCE_BYTES,
                "architecture source",
            )?;
            let bytes = source.len() as u64;
            if bytes != expected_bytes {
                return Err(StudioCoreError::ProjectChangedDuringRead);
            }
            total_bytes = total_bytes.saturating_add(bytes);
            sources.push(LoadedCodeProjectArchitectureSource {
                path: canonical_path.to_string_lossy().into_owned(),
                relative_path: entry.relative_path,
                bytes,
                hash: source_hash(&source),
                source,
            });
        }

        Ok(LoadedCodeProjectArchitectureSources {
            path: project.canonical_root.to_string_lossy().into_owned(),
            config_source: project.config_source,
            sources,
            truncated,
        })
    }

    /// Reads only the bounded CSS files declared for the derived Studio preview.
    /// CSS remains project-owned source and is rendered in an isolated document;
    /// it is never injected into Srijika Studio's application document.
    pub fn load_code_project_preview_styles(
        &self,
        request: LoadCodeProjectPreviewStylesRequest,
    ) -> Result<LoadedCodeProjectPreviewStyles, StudioCoreError> {
        let project = validate_code_project_root(&request.path)?;
        let mut stylesheets = Vec::with_capacity(project.preview_style_paths.len());
        let mut total_bytes = 0_u64;

        for relative_path in project.preview_style_paths {
            let stylesheet_path = project.canonical_root.join(&relative_path);
            let source = read_regular_utf8_file(
                &stylesheet_path,
                MAX_PREVIEW_STYLESHEET_BYTES,
                "preview stylesheet",
            )?;
            total_bytes = total_bytes.saturating_add(source.len() as u64);
            if total_bytes > MAX_PREVIEW_STYLES_BYTES {
                return Err(StudioCoreError::InvalidProject(
                    "preview stylesheets exceed the combined size limit",
                ));
            }
            let canonical_path = fs::canonicalize(&stylesheet_path).map_err(|source| {
                source_io("resolve preview stylesheet", &stylesheet_path, source)
            })?;
            ensure_project_containment(&project.canonical_root, &canonical_path)?;
            stylesheets.push(LoadedCodeProjectStylesheet {
                path: canonical_path.to_string_lossy().into_owned(),
                relative_path: path_to_forward_slashes(&relative_path)?,
                bytes: source.len() as u64,
                hash: source_hash(&source),
                source,
            });
        }

        let mut assets = Vec::with_capacity(project.preview_asset_paths.len());
        let mut total_asset_bytes = 0_u64;
        for relative_path in project.preview_asset_paths {
            let asset_path = project.canonical_root.join(&relative_path);
            let source =
                read_regular_utf8_file(&asset_path, MAX_PREVIEW_ASSET_BYTES, "preview asset")?;
            total_asset_bytes = total_asset_bytes.saturating_add(source.len() as u64);
            if total_asset_bytes > MAX_PREVIEW_ASSETS_BYTES {
                return Err(StudioCoreError::InvalidProject(
                    "preview assets exceed the combined size limit",
                ));
            }
            let canonical_path = fs::canonicalize(&asset_path)
                .map_err(|source| source_io("resolve preview asset", &asset_path, source))?;
            ensure_project_containment(&project.canonical_root, &canonical_path)?;
            let public_relative = relative_path.strip_prefix("public").map_err(|_| {
                StudioCoreError::InvalidProject("preview assets must stay below public")
            })?;
            assets.push(LoadedCodeProjectPreviewAsset {
                path: canonical_path.to_string_lossy().into_owned(),
                public_path: format!("/{}", path_to_forward_slashes(public_relative)?),
                bytes: source.len() as u64,
                hash: source_hash(&source),
                media_type: "image/svg+xml".to_owned(),
                source,
            });
        }

        Ok(LoadedCodeProjectPreviewStyles {
            path: project.canonical_root.to_string_lossy().into_owned(),
            stylesheets,
            assets,
            design_props: project.preview_design_props,
        })
    }

    /// Resolves a project root, file, or source location for an editor launch.
    /// The caller receives only a canonical target proven to stay in the
    /// validated Srijika project; launching the editor is owned by the Tauri edge.
    pub fn resolve_project_editor_target(
        &self,
        request: OpenInVsCodeRequest,
    ) -> Result<ResolvedEditorTarget, StudioCoreError> {
        let project = validate_code_project_root(&request.project_path)?;
        if request.line.is_some() && request.relative_path.is_none() {
            return Err(StudioCoreError::InvalidEditorTarget(
                "a source location requires a project-relative file",
            ));
        }
        if request.column.is_some() && request.line.is_none() {
            return Err(StudioCoreError::InvalidEditorTarget(
                "a column requires a line",
            ));
        }
        if request.line == Some(0) || request.line.is_some_and(|line| line > 1_000_000) {
            return Err(StudioCoreError::InvalidEditorTarget(
                "line must be between 1 and 1000000",
            ));
        }
        if request.column == Some(0) || request.column.is_some_and(|column| column > 100_000) {
            return Err(StudioCoreError::InvalidEditorTarget(
                "column must be between 1 and 100000",
            ));
        }

        let (target, target_is_file) = if let Some(relative_path) = request.relative_path.as_deref()
        {
            let relative = checked_relative_project_path(relative_path)?;
            let candidate = project.canonical_root.join(relative);
            let metadata = fs::symlink_metadata(&candidate)
                .map_err(|source| source_io("inspect editor target", &candidate, source))?;
            if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
                return Err(StudioCoreError::InvalidEditorTarget(
                    "editor target must be a regular file or directory",
                ));
            }
            if metadata.is_dir() && request.line.is_some() {
                return Err(StudioCoreError::InvalidEditorTarget(
                    "a directory cannot have a source location",
                ));
            }
            let canonical = fs::canonicalize(&candidate)
                .map_err(|source| source_io("resolve editor target", &candidate, source))?;
            ensure_project_containment(&project.canonical_root, &canonical)?;
            (canonical, metadata.is_file())
        } else {
            (project.canonical_root.clone(), false)
        };
        let line = request.line.or(target_is_file.then_some(1));

        Ok(ResolvedEditorTarget {
            project_path: project.canonical_root.to_string_lossy().into_owned(),
            target_path: target.to_string_lossy().into_owned(),
            line,
            column: request.column.or(line.map(|_| 1)),
        })
    }

    /// Returns dependency readiness and the currently managed task/dev-server
    /// lifecycle for one validated project root.
    pub fn get_project_runtime_status(
        &self,
        request: ProjectRuntimeStatusRequest,
    ) -> Result<ProjectRuntimeStatus, StudioCoreError> {
        let project = validate_code_project_root(&request.path)?;
        let dependency = inspect_project_dependencies(&project.canonical_root)?;
        let mut runtimes = self.lock_runtimes()?;
        if runtimes.shutting_down {
            return Err(StudioCoreError::ProjectBusy(
                "Srijika Studio is shutting down",
            ));
        }
        let record = runtimes
            .projects
            .entry(project.canonical_root.clone())
            .or_default();
        refresh_dev_server(record)?;
        Ok(project_runtime_status(
            &project.canonical_root,
            dependency,
            record,
        ))
    }

    /// Resolves the browser target for a live application from native managed
    /// runtime state. The caller supplies only a project root: the URL is
    /// derived from the tracked loopback port and is returned only after that
    /// port is accepting connections.
    pub fn resolve_project_app_target(
        &self,
        request: OpenCodeProjectAppRequest,
    ) -> Result<ProjectAppTarget, StudioCoreError> {
        let project = validate_code_project_root(&request.path)?;
        let mut runtimes = self.lock_runtimes()?;
        if runtimes.shutting_down {
            return Err(StudioCoreError::ProjectBusy(
                "Srijika Studio is shutting down",
            ));
        }
        let record = runtimes
            .projects
            .get_mut(&project.canonical_root)
            .ok_or(StudioCoreError::ProjectAppNotRunning)?;
        refresh_dev_server(record)?;
        let port = record
            .dev_server
            .as_ref()
            .map(|server| server.port)
            .ok_or(StudioCoreError::ProjectAppNotRunning)?;
        if !loopback_dev_server_ready(port) {
            return Err(StudioCoreError::ProjectAppNotReady);
        }

        Ok(ProjectAppTarget {
            project_path: project.canonical_root.to_string_lossy().into_owned(),
            url: loopback_dev_server_url(port),
        })
    }

    /// Runs `pnpm install --frozen-lockfile` in a validated project and returns
    /// bounded process output. Only one managed task may run per project.
    pub fn install_project_dependencies(
        &self,
        request: ProjectTaskRequest,
    ) -> Result<ProjectTaskResult, StudioCoreError> {
        self.run_project_task(request, ProjectTaskKind::Install)
    }

    /// Runs the generated project's declared build script through pnpm.
    pub fn build_code_project(
        &self,
        request: ProjectTaskRequest,
    ) -> Result<ProjectTaskResult, StudioCoreError> {
        self.run_project_task(request, ProjectTaskKind::Build)
    }

    /// Compiles the generated project, then starts one loopback-only Vite dev
    /// server and returns only after its tracked HTTP endpoint is ready.
    pub fn start_code_project(
        &self,
        request: StartCodeProjectRequest,
    ) -> Result<ProjectRuntimeStatus, StudioCoreError> {
        self.start_code_project_with_timeout(request, DEV_SERVER_START_TIMEOUT)
    }

    fn start_code_project_with_timeout(
        &self,
        request: StartCodeProjectRequest,
        startup_timeout: Duration,
    ) -> Result<ProjectRuntimeStatus, StudioCoreError> {
        let project = validate_code_project_root(&request.path)?;
        let dependency = inspect_project_dependencies(&project.canonical_root)?;
        if dependency.state != ProjectDependencyState::Ready {
            return Err(StudioCoreError::DependenciesNotReady(dependency.message));
        }
        if request.port.is_some_and(|port| port < MIN_DEV_SERVER_PORT) {
            return Err(StudioCoreError::InvalidProject(
                "dev-server port must be between 1024 and 65535",
            ));
        }

        // `src/srijika/preview-bridge.ts` is generated Studio infrastructure.
        // Upgrade only the recognizable legacy bridge, before the required
        // compile, so existing Srijika projects gain live Connector switching
        // without rewriting application-owned files.
        let _ = upgrade_legacy_live_preview_bridge(&project.canonical_root)?;

        {
            let mut runtimes = self.lock_runtimes()?;
            if runtimes.shutting_down {
                return Err(StudioCoreError::ProjectBusy(
                    "Srijika Studio is shutting down",
                ));
            }
            let record = runtimes
                .projects
                .entry(project.canonical_root.clone())
                .or_default();
            refresh_dev_server(record)?;
            if project_runtime_is_busy(record) {
                return Err(StudioCoreError::ProjectBusy(
                    "a task or dev server is already active for this project",
                ));
            }
        }
        // Srijika Studio's own Vite frontend commonly occupies 5173 in desktop
        // development. Reserve a free loopback port for the generated app so
        // readiness can never be satisfied by Studio (or another process).
        let (port, port_reservation) = reserve_loopback_dev_server_port(request.port)?;
        let build_result = self.run_project_task(
            ProjectTaskRequest {
                path: request.path.clone(),
            },
            ProjectTaskKind::Build,
        )?;
        if !build_result.success {
            return Err(StudioCoreError::ProjectAppStartFailed(
                project_build_failure(&build_result),
            ));
        }

        let mut runtimes = self.lock_runtimes()?;
        if runtimes.shutting_down {
            return Err(StudioCoreError::ProjectBusy(
                "Srijika Studio is shutting down",
            ));
        }
        let record = runtimes
            .projects
            .entry(project.canonical_root.clone())
            .or_default();
        refresh_dev_server(record)?;
        if project_runtime_is_busy(record) {
            return Err(StudioCoreError::ProjectBusy(
                "a task or dev server became active while the project was compiling",
            ));
        }
        let mut command = Command::new(pnpm_executable());
        command
            .current_dir(&project.canonical_root)
            .args(pnpm_dev_arguments(port))
            .env("CI", "1")
            .env("NO_COLOR", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_group(&mut command);
        // Vite must bind the reserved port itself. Keep the reservation until
        // the last possible moment to minimize the release-to-spawn race.
        drop(port_reservation);
        let mut child = command
            .spawn()
            .map_err(|source| tool_io("start pnpm dev server", pnpm_executable(), source))?;
        let pid = child.id();
        let stdout = Arc::new(Mutex::new(CappedOutput::default()));
        let stderr = Arc::new(Mutex::new(CappedOutput::default()));
        let stdout_reader = child
            .stdout
            .take()
            .map(|reader| spawn_output_reader(reader, Arc::clone(&stdout)));
        let stderr_reader = child
            .stderr
            .take()
            .map(|reader| spawn_output_reader(reader, Arc::clone(&stderr)));
        record.dev_server = Some(ManagedDevServer {
            child,
            pid,
            port,
            started_at_millis: unix_time_millis(),
            stdout,
            stderr,
            stdout_reader,
            stderr_reader,
        });
        record.last_dev_server = None;
        drop(runtimes);

        self.wait_for_code_project_ready(&project.canonical_root, dependency, startup_timeout)
    }

    fn wait_for_code_project_ready(
        &self,
        project_root: &Path,
        dependency: ProjectDependencyInspection,
        startup_timeout: Duration,
    ) -> Result<ProjectRuntimeStatus, StudioCoreError> {
        let started = Instant::now();
        loop {
            let status = {
                let mut runtimes = self.lock_runtimes()?;
                if runtimes.shutting_down {
                    return Err(StudioCoreError::ProjectBusy(
                        "Srijika Studio is shutting down",
                    ));
                }
                let record = runtimes
                    .projects
                    .get_mut(project_root)
                    .ok_or(StudioCoreError::RuntimeStateUnavailable)?;
                refresh_dev_server(record)?;
                project_runtime_status(project_root, dependency.clone(), record)
            };

            if status.dev_server.state == DevServerState::Exited {
                return Err(StudioCoreError::ProjectAppStartFailed(
                    dev_server_start_failure(&status.dev_server, false),
                ));
            }
            if status.running && status.dev_server.ready {
                return Ok(status);
            }
            if started.elapsed() >= startup_timeout {
                let stopped = self.stop_code_project(ProjectTaskRequest {
                    path: project_root.to_string_lossy().into_owned(),
                })?;
                return Err(StudioCoreError::ProjectAppStartFailed(
                    dev_server_start_failure(&stopped.dev_server, true),
                ));
            }
            thread::sleep(DEV_SERVER_START_POLL_INTERVAL);
        }
    }

    /// Stops the managed dev process tree and waits for it outside the UI
    /// thread (the Tauri command dispatches this method through spawn_blocking).
    pub fn stop_code_project(
        &self,
        request: ProjectTaskRequest,
    ) -> Result<ProjectRuntimeStatus, StudioCoreError> {
        let project = validate_code_project_root(&request.path)?;
        let server = {
            let mut runtimes = self.lock_runtimes()?;
            if runtimes.shutting_down {
                return Err(StudioCoreError::ProjectBusy(
                    "Srijika Studio is shutting down",
                ));
            }
            let record = runtimes
                .projects
                .entry(project.canonical_root.clone())
                .or_default();
            refresh_dev_server(record)?;
            if record.stopping_dev_server {
                return Err(StudioCoreError::ProjectBusy(
                    "the development server is already stopping",
                ));
            }
            let server = record.dev_server.take();
            record.stopping_dev_server = server.is_some();
            server
        };

        let snapshot = if let Some(server) = server {
            stop_managed_dev_server(server).map(Some)
        } else {
            Ok(None)
        };

        let dependency = inspect_project_dependencies(&project.canonical_root);
        let mut runtimes = self.lock_runtimes()?;
        let record = runtimes
            .projects
            .entry(project.canonical_root.clone())
            .or_default();
        record.stopping_dev_server = false;
        let snapshot = snapshot?;
        if let Some(snapshot) = snapshot {
            record.last_dev_server = Some(snapshot);
        }
        let dependency = dependency?;
        Ok(project_runtime_status(
            &project.canonical_root,
            dependency,
            record,
        ))
    }

    /// Best-effort process cleanup used when the native application exits.
    pub fn shutdown_project_runtimes(&self) {
        let (servers, active_task_pids) = self
            .runtimes
            .lock()
            .map(|mut runtimes| {
                runtimes.shutting_down = true;
                let servers = runtimes
                    .projects
                    .values_mut()
                    .filter_map(|record| record.dev_server.take())
                    .collect::<Vec<_>>();
                let active_task_pids = runtimes
                    .projects
                    .values_mut()
                    .filter_map(|record| record.active_task_pid.take())
                    .collect::<Vec<_>>();
                (servers, active_task_pids)
            })
            .unwrap_or_default();
        for pid in active_task_pids {
            terminate_process_tree_by_pid(pid);
        }
        for server in servers {
            let _ = stop_managed_dev_server(server);
        }
    }

    fn run_project_task(
        &self,
        request: ProjectTaskRequest,
        kind: ProjectTaskKind,
    ) -> Result<ProjectTaskResult, StudioCoreError> {
        let project = validate_code_project_root(&request.path)?;
        let dependency = inspect_project_dependencies(&project.canonical_root)?;
        if !dependency.lockfile_present {
            return Err(StudioCoreError::MissingLockfile);
        }
        if kind == ProjectTaskKind::Build && dependency.state != ProjectDependencyState::Ready {
            return Err(StudioCoreError::DependenciesNotReady(dependency.message));
        }
        {
            let mut runtimes = self.lock_runtimes()?;
            if runtimes.shutting_down {
                return Err(StudioCoreError::ProjectBusy(
                    "Srijika Studio is shutting down",
                ));
            }
            let record = runtimes
                .projects
                .entry(project.canonical_root.clone())
                .or_default();
            refresh_dev_server(record)?;
            if project_runtime_is_busy(record) {
                return Err(StudioCoreError::ProjectBusy(
                    "stop the active task or dev server before continuing",
                ));
            }
            record.active_task = Some(ProjectTaskActivity {
                kind,
                started_at_millis: unix_time_millis(),
            });
        }

        let started = Instant::now();
        let arguments: &[&str] = match kind {
            ProjectTaskKind::Install => &["install", "--frozen-lockfile", "--reporter=append-only"],
            ProjectTaskKind::Build => &["run", "build"],
        };
        let execution = run_captured_command(
            pnpm_executable(),
            arguments,
            &project.canonical_root,
            |pid| {
                let mut runtimes = self.lock_runtimes()?;
                if runtimes.shutting_down {
                    return Err(StudioCoreError::ProjectBusy(
                        "Srijika Studio is shutting down",
                    ));
                }
                let record = runtimes
                    .projects
                    .get_mut(&project.canonical_root)
                    .ok_or(StudioCoreError::RuntimeStateUnavailable)?;
                record.active_task_pid = Some(pid);
                Ok(())
            },
        );

        let mut runtimes = self.lock_runtimes()?;
        let record = runtimes
            .projects
            .entry(project.canonical_root.clone())
            .or_default();
        record.active_task = None;
        record.active_task_pid = None;
        let captured = execution?;
        let result = ProjectTaskResult {
            project_path: project.canonical_root.to_string_lossy().into_owned(),
            kind,
            success: captured.status.success(),
            exit_code: captured.status.code(),
            stdout: captured.stdout.text,
            stderr: captured.stderr.text,
            output_truncated: captured.stdout.truncated || captured.stderr.truncated,
            duration_millis: started.elapsed().as_millis().try_into().unwrap_or(u64::MAX),
        };
        record.last_task = Some(result.clone());
        Ok(result)
    }

    fn lock_runtimes(&self) -> Result<MutexGuard<'_, RuntimeRegistry>, StudioCoreError> {
        self.runtimes
            .lock()
            .map_err(|_| StudioCoreError::RuntimeStateUnavailable)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadTsxSourceRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedTsxSource {
    pub path: String,
    pub bytes: u64,
    pub hash: String,
    pub source: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveTsxSourceRequest {
    pub path: String,
    pub source: String,
    pub expected_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedTsxSource {
    pub path: String,
    pub bytes: u64,
    pub hash: String,
    pub replaced: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodeProjectFile {
    pub path: String,
    pub contents: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateCodeProjectRequest {
    pub path: String,
    pub entry_source: String,
    pub files: Vec<CodeProjectFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedCodeProject {
    pub path: String,
    pub entry_source_path: String,
    pub file_count: usize,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CodeProjectUiSourceKind {
    Page,
    Component,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateCodeProjectUiSourceRequest {
    pub project_path: String,
    pub relative_path: String,
    pub kind: CodeProjectUiSourceKind,
    pub component_name: String,
    #[serde(default)]
    pub create_connector: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedCodeProjectUiSource {
    pub path: String,
    pub relative_path: String,
    pub connector_path: Option<String>,
    pub bytes: u64,
    pub hash: String,
    pub source: String,
    pub kind: CodeProjectUiSourceKind,
    pub component_name: String,
}

/// One user-selectable capability in the canonical feature hierarchy. The
/// tagged representation is intentionally suitable for a Studio wizard: the
/// UI asks which capability is needed, then displays only that variant's
/// options.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CodeProjectScaffoldCapability {
    Feature {
        #[serde(default)]
        create_connector: bool,
        #[serde(default)]
        create_hook: bool,
        #[serde(default)]
        create_store: bool,
        #[serde(default)]
        create_logic: bool,
        #[serde(default)]
        create_api: bool,
        #[serde(default)]
        create_types: bool,
        #[serde(default)]
        hook_name: Option<String>,
    },
    FeatureConnector,
    FeatureStore,
    FeatureHook,
    FeatureBehaviorHook {
        hook_name: String,
    },
    FeatureLogic,
    FeatureApi,
    FeatureTypes,
    Slot {
        slot_name: String,
        #[serde(default)]
        create_connector: bool,
        #[serde(default)]
        create_hook: bool,
        #[serde(default)]
        create_store: bool,
        #[serde(default)]
        create_logic: bool,
        #[serde(default)]
        create_api: bool,
        #[serde(default)]
        create_types: bool,
        #[serde(default)]
        hook_name: Option<String>,
        #[serde(default)]
        part_name: Option<String>,
        #[serde(default)]
        create_part_connector: bool,
    },
    SlotHook {
        slot_name: String,
    },
    SlotBehaviorHook {
        slot_name: String,
        hook_name: String,
    },
    SlotConnector {
        slot_name: String,
    },
    SlotStore {
        slot_name: String,
    },
    SlotLogic {
        slot_name: String,
    },
    SlotApi {
        slot_name: String,
    },
    SlotTypes {
        slot_name: String,
    },
    Part {
        slot_name: String,
        part_name: String,
        #[serde(default)]
        create_connector: bool,
        #[serde(default)]
        create_hook: bool,
        #[serde(default)]
        create_store: bool,
        #[serde(default)]
        create_logic: bool,
        #[serde(default)]
        create_api: bool,
        #[serde(default)]
        create_types: bool,
        #[serde(default)]
        hook_name: Option<String>,
    },
    PartConnector {
        slot_name: String,
        part_name: String,
    },
    PartStore {
        slot_name: String,
        part_name: String,
    },
    PartHook {
        slot_name: String,
        part_name: String,
    },
    PartBehaviorHook {
        slot_name: String,
        part_name: String,
        hook_name: String,
    },
    PartLogic {
        slot_name: String,
        part_name: String,
    },
    PartApi {
        slot_name: String,
        part_name: String,
    },
    PartTypes {
        slot_name: String,
        part_name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScaffoldCodeProjectStructureRequest {
    pub project_path: String,
    pub feature_name: String,
    pub capability: CodeProjectScaffoldCapability,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CodeProjectScaffoldFileRole {
    FeatureUi,
    FeatureConnector,
    FeatureStore,
    FeatureHook,
    FeatureLogic,
    FeatureApi,
    FeatureTypes,
    SlotUi,
    SlotConnector,
    SlotStore,
    SlotHook,
    SlotLogic,
    SlotApi,
    SlotTypes,
    PartUi,
    PartConnector,
    PartStore,
    PartHook,
    PartLogic,
    PartApi,
    PartTypes,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaffoldedCodeProjectFile {
    pub path: String,
    pub relative_path: String,
    pub role: CodeProjectScaffoldFileRole,
    pub bytes: u64,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaffoldedCodeProjectStructure {
    pub project_path: String,
    pub feature_name: String,
    pub feature_path: String,
    pub capability: CodeProjectScaffoldCapability,
    pub files: Vec<ScaffoldedCodeProjectFile>,
    pub bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenCodeProjectRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedCodeProject {
    pub path: String,
    pub entry_source_path: String,
    pub bytes: u64,
    pub hash: String,
    pub source: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScanCodeProjectRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedCodeProject {
    pub path: String,
    pub entry_source_path: String,
    pub entries: Vec<ProjectTreeEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadCodeProjectArchitectureSourcesRequest {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedCodeProjectArchitectureSource {
    pub path: String,
    pub relative_path: String,
    pub bytes: u64,
    pub hash: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedCodeProjectArchitectureSources {
    pub path: String,
    pub config_source: String,
    pub sources: Vec<LoadedCodeProjectArchitectureSource>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadCodeProjectPreviewStylesRequest {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedCodeProjectStylesheet {
    pub path: String,
    pub relative_path: String,
    pub bytes: u64,
    pub hash: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedCodeProjectPreviewStyles {
    pub path: String,
    pub stylesheets: Vec<LoadedCodeProjectStylesheet>,
    pub assets: Vec<LoadedCodeProjectPreviewAsset>,
    pub design_props: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedCodeProjectPreviewAsset {
    pub path: String,
    pub public_path: String,
    pub bytes: u64,
    pub hash: String,
    pub media_type: String,
    pub source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectTreeEntryKind {
    Directory,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTreeEntry {
    pub path: String,
    pub relative_path: String,
    pub kind: ProjectTreeEntryKind,
    pub bytes: Option<u64>,
    pub hash: Option<String>,
    pub is_ui_source: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenInVsCodeRequest {
    pub project_path: String,
    pub relative_path: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedEditorTarget {
    pub project_path: String,
    pub target_path: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRuntimeStatusRequest {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenCodeProjectAppRequest {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAppTarget {
    pub project_path: String,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectTaskRequest {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartCodeProjectRequest {
    pub path: String,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectDependencyState {
    MissingLockfile,
    NotInstalled,
    Outdated,
    Ready,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectTaskKind {
    Install,
    Build,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskActivity {
    pub kind: ProjectTaskKind,
    pub started_at_millis: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskResult {
    pub project_path: String,
    pub kind: ProjectTaskKind,
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub output_truncated: bool,
    pub duration_millis: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DevServerState {
    Stopped,
    Running,
    Exited,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevServerStatus {
    pub state: DevServerState,
    pub ready: bool,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub output_truncated: bool,
    pub started_at_millis: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeStatus {
    pub path: String,
    pub lockfile_present: bool,
    pub dependencies_installed: bool,
    pub dependencies_ready: bool,
    pub dependency_state: ProjectDependencyState,
    pub active_task: Option<ProjectTaskActivity>,
    pub last_task: Option<ProjectTaskResult>,
    pub running: bool,
    pub port: Option<u16>,
    pub dev_server: DevServerStatus,
    pub message: String,
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

#[cfg(windows)]
pub const VSCODE_EXECUTABLE: &str = "code.cmd";
#[cfg(not(windows))]
pub const VSCODE_EXECUTABLE: &str = "code";

#[cfg(windows)]
fn pnpm_executable() -> &'static str {
    "pnpm.cmd"
}

#[cfg(not(windows))]
fn pnpm_executable() -> &'static str {
    "pnpm"
}

#[derive(Debug)]
struct ValidatedCodeProject {
    canonical_root: PathBuf,
    entry_path: PathBuf,
    config_source: String,
    preview_style_paths: Vec<PathBuf>,
    preview_asset_paths: Vec<PathBuf>,
    preview_design_props: Map<String, Value>,
}

fn validate_code_project_root(raw_path: &str) -> Result<ValidatedCodeProject, StudioCoreError> {
    let target = checked_project_path(raw_path)?;
    let target_metadata = fs::symlink_metadata(&target)
        .map_err(|source| source_io("inspect project directory", &target, source))?;
    if target_metadata.file_type().is_symlink() || !target_metadata.is_dir() {
        return Err(StudioCoreError::InvalidProject(
            "project path must be a real directory",
        ));
    }
    let canonical_root = fs::canonicalize(&target)
        .map_err(|source| source_io("resolve project directory", &target, source))?;

    let config_path = canonical_root.join("srijika.config.json");
    let config_source = read_regular_utf8_file(
        &config_path,
        MAX_PROJECT_CONFIG_BYTES,
        "Srijika project config",
    )?;
    let config: Value = serde_json::from_str(&config_source)
        .map_err(|_| StudioCoreError::InvalidProject("srijika.config.json is not valid JSON"))?;
    let config = config.as_object().ok_or(StudioCoreError::InvalidProject(
        "srijika.config.json must contain an object",
    ))?;
    if config.get("sourceOfTruth").and_then(Value::as_str) != Some("tsx") {
        return Err(StudioCoreError::InvalidProject(
            "project sourceOfTruth must be tsx",
        ));
    }
    let entry_source =
        config
            .get("entry")
            .and_then(Value::as_str)
            .ok_or(StudioCoreError::InvalidProject(
                "project config must declare a string entry",
            ))?;
    let relative_entry = checked_relative_project_path(entry_source)?;
    if !entry_source.ends_with(".ui.tsx") {
        return Err(StudioCoreError::InvalidProject(
            "project entry must end in .ui.tsx",
        ));
    }
    let entry_candidate = canonical_root.join(relative_entry);
    let entry_metadata = fs::symlink_metadata(&entry_candidate)
        .map_err(|source| source_io("inspect project entry source", &entry_candidate, source))?;
    if entry_metadata.file_type().is_symlink() || !entry_metadata.is_file() {
        return Err(StudioCoreError::InvalidProject(
            "project entry must be a regular file",
        ));
    }
    let entry_path = fs::canonicalize(&entry_candidate)
        .map_err(|source| source_io("resolve project entry source", &entry_candidate, source))?;
    ensure_project_containment(&canonical_root, &entry_path)?;

    let preview = match config.get("preview") {
        None => None,
        Some(value) => Some(value.as_object().ok_or(StudioCoreError::InvalidProject(
            "project preview must be an object",
        ))?),
    };
    let preview_style_paths = preview_style_paths(preview, &canonical_root)?;
    let preview_asset_paths = preview_asset_paths(preview, &canonical_root)?;
    let preview_design_props = match preview.and_then(|value| value.get("props")) {
        None => Map::new(),
        Some(value) => value
            .as_object()
            .cloned()
            .ok_or(StudioCoreError::InvalidProject(
                "project preview.props must be an object",
            ))?,
    };

    Ok(ValidatedCodeProject {
        canonical_root,
        entry_path,
        config_source,
        preview_style_paths,
        preview_asset_paths,
        preview_design_props,
    })
}

fn preview_asset_paths(
    preview: Option<&Map<String, Value>>,
    canonical_root: &Path,
) -> Result<Vec<PathBuf>, StudioCoreError> {
    let configured = preview.and_then(|preview| preview.get("assets"));
    let Some(configured) = configured else {
        let fallback = PathBuf::from("public/srijika-mark.svg");
        return Ok(canonical_root
            .join(&fallback)
            .exists()
            .then_some(fallback)
            .into_iter()
            .collect());
    };
    let configured = configured
        .as_array()
        .ok_or(StudioCoreError::InvalidProject(
            "project preview.assets must be an array",
        ))?;
    if configured.len() > MAX_PREVIEW_ASSETS {
        return Err(StudioCoreError::InvalidProject(
            "project preview.assets contains too many files",
        ));
    }
    let mut unique = HashSet::new();
    let mut result = Vec::with_capacity(configured.len());
    for value in configured {
        let raw_path = value.as_str().ok_or(StudioCoreError::InvalidProject(
            "project preview.assets entries must be strings",
        ))?;
        if raw_path.contains('\\')
            || !raw_path.starts_with("public/")
            || !raw_path.ends_with(".svg")
        {
            return Err(StudioCoreError::InvalidProject(
                "project preview assets must be .svg files below public",
            ));
        }
        let path = checked_relative_project_path(raw_path)?;
        if !unique.insert(path.clone()) {
            return Err(StudioCoreError::InvalidProject(
                "project preview.assets must not contain duplicates",
            ));
        }
        result.push(path);
    }
    Ok(result)
}

fn preview_style_paths(
    preview: Option<&Map<String, Value>>,
    canonical_root: &Path,
) -> Result<Vec<PathBuf>, StudioCoreError> {
    let configured = preview.and_then(|preview| preview.get("styles"));
    let Some(configured) = configured else {
        let fallback = PathBuf::from("src/styles.css");
        return Ok(canonical_root
            .join(&fallback)
            .exists()
            .then_some(fallback)
            .into_iter()
            .collect());
    };
    let configured = configured
        .as_array()
        .ok_or(StudioCoreError::InvalidProject(
            "project preview.styles must be an array",
        ))?;
    if configured.len() > MAX_PREVIEW_STYLESHEETS {
        return Err(StudioCoreError::InvalidProject(
            "project preview.styles contains too many files",
        ));
    }
    let mut unique = HashSet::new();
    let mut result = Vec::with_capacity(configured.len());
    for value in configured {
        let raw_path = value.as_str().ok_or(StudioCoreError::InvalidProject(
            "project preview.styles entries must be strings",
        ))?;
        if raw_path.contains('\\') || !raw_path.starts_with("src/") || !raw_path.ends_with(".css") {
            return Err(StudioCoreError::InvalidProject(
                "project preview stylesheets must be .css files below src",
            ));
        }
        let path = checked_relative_project_path(raw_path)?;
        if !unique.insert(path.clone()) {
            return Err(StudioCoreError::InvalidProject(
                "project preview.styles must not contain duplicates",
            ));
        }
        result.push(path);
    }
    Ok(result)
}

fn read_regular_utf8_file(
    path: &Path,
    maximum_bytes: u64,
    label: &'static str,
) -> Result<String, StudioCoreError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|source| source_io("inspect project file", path, source))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(StudioCoreError::InvalidProject(match label {
            "Srijika project config" => "srijika.config.json must be a regular file",
            "package manifest" => "package.json must be a regular file",
            _ => "project file must be a regular file",
        }));
    }
    if metadata.len() > maximum_bytes {
        return Err(StudioCoreError::InvalidProject(match label {
            "Srijika project config" => "srijika.config.json exceeds the size limit",
            "package manifest" => "package.json exceeds the size limit",
            _ => "project file exceeds the size limit",
        }));
    }
    let mut source = String::with_capacity(metadata.len().min(usize::MAX as u64) as usize);
    File::open(path)
        .map_err(|error| source_io("open project file", path, error))?
        .take(maximum_bytes.saturating_add(1))
        .read_to_string(&mut source)
        .map_err(|error| source_io("read UTF-8 project file", path, error))?;
    if source.len() as u64 > maximum_bytes {
        return Err(StudioCoreError::InvalidProject(
            "project file exceeds the size limit",
        ));
    }
    Ok(source)
}

fn ensure_project_containment(root: &Path, target: &Path) -> Result<(), StudioCoreError> {
    if target.starts_with(root) {
        Ok(())
    } else {
        Err(StudioCoreError::InvalidProject(
            "project target must stay inside the project directory",
        ))
    }
}

#[derive(Debug)]
struct ProjectTreeScan {
    root: PathBuf,
    entries: Vec<ProjectTreeEntry>,
    metadata_bytes: usize,
    hashed_bytes: u64,
    truncated: bool,
}

impl ProjectTreeScan {
    fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
            entries: Vec::new(),
            metadata_bytes: 0,
            hashed_bytes: 0,
            truncated: false,
        }
    }
}

#[derive(Debug)]
struct ProjectTreeCandidate {
    absolute_path: PathBuf,
    relative_path: PathBuf,
    name: String,
    metadata: fs::Metadata,
}

impl ProjectTreeCandidate {
    fn sort_order(&self, other: &Self) -> Ordering {
        let self_kind = u8::from(!self.metadata.is_dir());
        let other_kind = u8::from(!other.metadata.is_dir());
        self_kind
            .cmp(&other_kind)
            .then_with(|| self.name.to_lowercase().cmp(&other.name.to_lowercase()))
            .then_with(|| self.name.cmp(&other.name))
    }
}

impl PartialEq for ProjectTreeCandidate {
    fn eq(&self, other: &Self) -> bool {
        self.metadata.is_dir() == other.metadata.is_dir() && self.name == other.name
    }
}

impl Eq for ProjectTreeCandidate {}

impl PartialOrd for ProjectTreeCandidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ProjectTreeCandidate {
    fn cmp(&self, other: &Self) -> Ordering {
        self.sort_order(other)
    }
}

fn scan_directory(
    directory: &Path,
    relative_directory: &Path,
    depth: usize,
    scan: &mut ProjectTreeScan,
) -> Result<(), StudioCoreError> {
    if scan.truncated {
        return Ok(());
    }
    let candidate_limit = MAX_PROJECT_TREE_ENTRIES.saturating_sub(scan.entries.len());
    if candidate_limit == 0 {
        scan.truncated = true;
        return Ok(());
    }
    // A directory may contain far more entries than the explorer can return.
    // Retain only the globally earliest candidates for this directory so the
    // scan remains deterministic without allocating one object per disk entry.
    let mut candidates = BinaryHeap::with_capacity(candidate_limit);
    let mut omitted_candidate = false;
    for entry in fs::read_dir(directory)
        .map_err(|source| source_io("read project directory", directory, source))?
    {
        let entry = entry.map_err(|source| source_io("read project entry", directory, source))?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| StudioCoreError::InvalidProject("project paths must be valid UTF-8"))?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|source| source_io("inspect project tree entry", &entry.path(), source))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() && IGNORED_PROJECT_DIRECTORIES.contains(&name.as_str()) {
            continue;
        }
        if !metadata.is_dir() && !metadata.is_file() {
            continue;
        }
        let candidate = ProjectTreeCandidate {
            absolute_path: entry.path(),
            relative_path: relative_directory.join(&name),
            name,
            metadata,
        };
        if candidates.len() < candidate_limit {
            candidates.push(candidate);
        } else {
            omitted_candidate = true;
            if candidates
                .peek()
                .is_some_and(|largest| candidate < *largest)
            {
                candidates.pop();
                candidates.push(candidate);
            }
        }
    }

    for candidate in candidates.into_sorted_vec() {
        if scan.entries.len() >= MAX_PROJECT_TREE_ENTRIES {
            scan.truncated = true;
            break;
        }
        let canonical = fs::canonicalize(&candidate.absolute_path).map_err(|source| {
            source_io(
                "resolve project tree entry",
                &candidate.absolute_path,
                source,
            )
        })?;
        ensure_project_containment(&scan.root, &canonical)?;
        let relative_path = path_to_forward_slashes(&candidate.relative_path)?;
        let absolute_path = canonical.to_string_lossy().into_owned();
        let metadata_cost = relative_path
            .len()
            .saturating_add(absolute_path.len())
            .saturating_add(candidate.name.len());
        if scan.metadata_bytes.saturating_add(metadata_cost) > MAX_PROJECT_TREE_METADATA_BYTES {
            scan.truncated = true;
            break;
        }
        scan.metadata_bytes = scan.metadata_bytes.saturating_add(metadata_cost);

        let is_directory = candidate.metadata.is_dir();
        let is_ui_source = !is_directory && candidate.name.ends_with(".ui.tsx");
        let hash = if is_ui_source
            && candidate.metadata.len() <= MAX_TSX_SOURCE_BYTES
            && scan.hashed_bytes.saturating_add(candidate.metadata.len())
                <= MAX_PROJECT_TREE_HASH_BYTES
        {
            scan.hashed_bytes = scan.hashed_bytes.saturating_add(candidate.metadata.len());
            Some(hash_regular_file(&canonical, candidate.metadata.len())?)
        } else {
            if is_ui_source && candidate.metadata.len() <= MAX_TSX_SOURCE_BYTES {
                scan.truncated = true;
            }
            None
        };
        scan.entries.push(ProjectTreeEntry {
            path: absolute_path,
            relative_path,
            kind: if is_directory {
                ProjectTreeEntryKind::Directory
            } else {
                ProjectTreeEntryKind::File
            },
            bytes: (!is_directory).then_some(candidate.metadata.len()),
            hash,
            is_ui_source,
        });

        if is_directory && !is_nested_srijika_project_directory(&canonical)? {
            if depth >= MAX_PROJECT_TREE_DEPTH {
                scan.truncated = true;
                continue;
            }
            scan_directory(
                &canonical,
                &candidate.relative_path,
                depth.saturating_add(1),
                scan,
            )?;
        }
    }
    if omitted_candidate {
        scan.truncated = true;
    }
    Ok(())
}

fn is_nested_srijika_project_directory(directory: &Path) -> Result<bool, StudioCoreError> {
    let config_path = directory.join("srijika.config.json");
    match fs::symlink_metadata(&config_path) {
        Ok(metadata) => Ok(metadata.is_file() && !metadata.file_type().is_symlink()),
        Err(source) if source.kind() == ErrorKind::NotFound => Ok(false),
        Err(source) => Err(source_io(
            "inspect nested Srijika project boundary",
            &config_path,
            source,
        )),
    }
}

fn path_to_forward_slashes(path: &Path) -> Result<String, StudioCoreError> {
    let mut segments = Vec::new();
    for component in path.components() {
        let Component::Normal(value) = component else {
            return Err(StudioCoreError::InvalidProject(
                "project tree contains a non-relative path",
            ));
        };
        segments.push(
            value
                .to_str()
                .ok_or(StudioCoreError::InvalidProject(
                    "project paths must be valid UTF-8",
                ))?
                .to_owned(),
        );
    }
    Ok(segments.join("/"))
}

fn is_architecture_source_path(relative_path: &str) -> bool {
    matches!(
        Path::new(relative_path)
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("ts" | "tsx" | "mts" | "cts")
    )
}

fn hash_regular_file(path: &Path, expected_bytes: u64) -> Result<String, StudioCoreError> {
    let mut file = File::open(path).map_err(|source| source_io("open UI source", path, source))?;
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    let mut read_bytes = 0u64;
    let mut buffer = [0u8; 16 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|source| source_io("hash UI source", path, source))?;
        if count == 0 {
            break;
        }
        read_bytes = read_bytes.saturating_add(count as u64);
        if read_bytes > MAX_TSX_SOURCE_BYTES {
            return Err(StudioCoreError::SourceTooLarge {
                max: MAX_TSX_SOURCE_BYTES,
                actual: read_bytes,
            });
        }
        for byte in &buffer[..count] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    if read_bytes != expected_bytes {
        return Err(StudioCoreError::ProjectChangedDuringRead);
    }
    Ok(format!("fnv1a64:{hash:016x}"))
}

#[derive(Debug, Clone)]
struct ProjectDependencyInspection {
    state: ProjectDependencyState,
    lockfile_present: bool,
    dependencies_installed: bool,
    message: String,
}

fn inspect_project_dependencies(
    root: &Path,
) -> Result<ProjectDependencyInspection, StudioCoreError> {
    let package_path = root.join("package.json");
    let package_source =
        read_regular_utf8_file(&package_path, MAX_PACKAGE_JSON_BYTES, "package manifest")?;
    let package: Value = serde_json::from_str(&package_source)
        .map_err(|_| StudioCoreError::InvalidProject("package.json is not valid JSON"))?;
    let package = package.as_object().ok_or(StudioCoreError::InvalidProject(
        "package.json must contain an object",
    ))?;
    let scripts = package.get("scripts").and_then(Value::as_object).ok_or(
        StudioCoreError::InvalidProject("package.json must declare scripts"),
    )?;
    for script in ["dev", "build"] {
        if scripts.get(script).and_then(Value::as_str).is_none() {
            return Err(StudioCoreError::InvalidProject(
                "package.json must declare string dev and build scripts",
            ));
        }
    }
    if package
        .get("packageManager")
        .and_then(Value::as_str)
        .is_some_and(|manager| !manager.starts_with("pnpm@"))
    {
        return Err(StudioCoreError::InvalidProject(
            "packageManager must select pnpm",
        ));
    }

    let lockfile_path = root.join("pnpm-lock.yaml");
    let lockfile_metadata = match fs::symlink_metadata(&lockfile_path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(StudioCoreError::InvalidProject(
                    "pnpm-lock.yaml must be a regular file",
                ));
            }
            if metadata.len() > MAX_LOCKFILE_BYTES {
                return Err(StudioCoreError::InvalidProject(
                    "pnpm-lock.yaml exceeds the size limit",
                ));
            }
            Some(metadata)
        }
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => None,
        Err(source) => return Err(source_io("inspect pnpm lockfile", &lockfile_path, source)),
    };
    let Some(lockfile_metadata) = lockfile_metadata else {
        return Ok(ProjectDependencyInspection {
            state: ProjectDependencyState::MissingLockfile,
            lockfile_present: false,
            dependencies_installed: false,
            message: "Generate pnpm-lock.yaml before installing dependencies.".to_owned(),
        });
    };

    let node_modules_path = root.join("node_modules");
    let modules_state_path = node_modules_path.join(".modules.yaml");
    let modules_metadata = match (
        fs::symlink_metadata(&node_modules_path),
        fs::symlink_metadata(&modules_state_path),
    ) {
        (Ok(directory), Ok(state))
            if !directory.file_type().is_symlink()
                && directory.is_dir()
                && !state.file_type().is_symlink()
                && state.is_file() =>
        {
            Some(state)
        }
        _ => None,
    };
    let Some(modules_metadata) = modules_metadata else {
        return Ok(ProjectDependencyInspection {
            state: ProjectDependencyState::NotInstalled,
            lockfile_present: true,
            dependencies_installed: false,
            message: "Dependencies are not installed. Run the managed install task.".to_owned(),
        });
    };

    let package_modified = fs::symlink_metadata(&package_path)
        .and_then(|metadata| metadata.modified())
        .ok();
    let lockfile_modified = lockfile_metadata.modified().ok();
    let modules_modified = modules_metadata.modified().ok();
    let is_outdated = modules_modified.is_some_and(|installed| {
        package_modified.is_some_and(|modified| modified > installed)
            || lockfile_modified.is_some_and(|modified| modified > installed)
    });
    if is_outdated {
        Ok(ProjectDependencyInspection {
            state: ProjectDependencyState::Outdated,
            lockfile_present: true,
            dependencies_installed: true,
            message: "package.json or pnpm-lock.yaml changed; reinstall dependencies.".to_owned(),
        })
    } else {
        Ok(ProjectDependencyInspection {
            state: ProjectDependencyState::Ready,
            lockfile_present: true,
            dependencies_installed: true,
            message: "Dependencies are ready.".to_owned(),
        })
    }
}

#[derive(Debug, Default)]
struct RuntimeRegistry {
    projects: HashMap<PathBuf, ProjectRuntimeRecord>,
    shutting_down: bool,
}

#[derive(Debug, Default)]
struct ProjectRuntimeRecord {
    active_task: Option<ProjectTaskActivity>,
    active_task_pid: Option<u32>,
    last_task: Option<ProjectTaskResult>,
    dev_server: Option<ManagedDevServer>,
    stopping_dev_server: bool,
    last_dev_server: Option<DevServerStatus>,
}

fn project_runtime_is_busy(record: &ProjectRuntimeRecord) -> bool {
    record.active_task.is_some() || record.dev_server.is_some() || record.stopping_dev_server
}

#[derive(Debug)]
struct ManagedDevServer {
    child: Child,
    pid: u32,
    port: u16,
    started_at_millis: u64,
    stdout: Arc<Mutex<CappedOutput>>,
    stderr: Arc<Mutex<CappedOutput>>,
    stdout_reader: Option<JoinHandle<()>>,
    stderr_reader: Option<JoinHandle<()>>,
}

impl Drop for ManagedDevServer {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = terminate_process_tree(&mut self.child, self.pid);
            let _ = self.child.wait();
        }
    }
}

#[derive(Debug, Default)]
struct CappedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

impl CappedOutput {
    fn append(&mut self, bytes: &[u8]) {
        let remaining = MAX_TOOL_OUTPUT_BYTES.saturating_sub(self.bytes.len());
        let accepted = bytes.len().min(remaining);
        self.bytes.extend_from_slice(&bytes[..accepted]);
        if accepted < bytes.len() {
            self.truncated = true;
        }
    }

    fn snapshot(&self) -> CapturedText {
        CapturedText {
            text: String::from_utf8_lossy(&self.bytes).into_owned(),
            truncated: self.truncated,
        }
    }
}

#[derive(Debug)]
struct CapturedCommand {
    status: ExitStatus,
    stdout: CapturedText,
    stderr: CapturedText,
}

#[derive(Debug, Clone)]
struct CapturedText {
    text: String,
    truncated: bool,
}

fn run_captured_command(
    executable: &'static str,
    arguments: &[&str],
    current_directory: &Path,
    on_spawn: impl FnOnce(u32) -> Result<(), StudioCoreError>,
) -> Result<CapturedCommand, StudioCoreError> {
    let mut command = Command::new(executable);
    command
        .current_dir(current_directory)
        .args(arguments)
        .env("CI", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|source| tool_io("start project task", executable, source))?;
    let pid = child.id();
    let stdout = Arc::new(Mutex::new(CappedOutput::default()));
    let stderr = Arc::new(Mutex::new(CappedOutput::default()));
    let stdout_reader = child
        .stdout
        .take()
        .map(|reader| spawn_output_reader(reader, Arc::clone(&stdout)));
    let stderr_reader = child
        .stderr
        .take()
        .map(|reader| spawn_output_reader(reader, Arc::clone(&stderr)));
    if let Err(error) = on_spawn(pid) {
        let _ = terminate_process_tree(&mut child, pid);
        let _ = child.wait();
        let _ = join_output_reader(stdout_reader);
        let _ = join_output_reader(stderr_reader);
        return Err(error);
    }
    let status = child
        .wait()
        .map_err(|source| tool_io("wait for project task", executable, source))?;
    join_output_reader(stdout_reader)?;
    join_output_reader(stderr_reader)?;
    Ok(CapturedCommand {
        status,
        stdout: snapshot_output(&stdout)?,
        stderr: snapshot_output(&stderr)?,
    })
}

fn spawn_output_reader(
    mut reader: impl Read + Send + 'static,
    output: Arc<Mutex<CappedOutput>>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0u8; 8 * 1024];
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 {
                break;
            }
            let Ok(mut output) = output.lock() else {
                break;
            };
            output.append(&buffer[..count]);
        }
    })
}

fn join_output_reader(reader: Option<JoinHandle<()>>) -> Result<(), StudioCoreError> {
    if reader.is_some_and(|reader| reader.join().is_err()) {
        Err(StudioCoreError::RuntimeStateUnavailable)
    } else {
        Ok(())
    }
}

fn snapshot_output(output: &Arc<Mutex<CappedOutput>>) -> Result<CapturedText, StudioCoreError> {
    output
        .lock()
        .map(|output| output.snapshot())
        .map_err(|_| StudioCoreError::RuntimeStateUnavailable)
}

fn refresh_dev_server(record: &mut ProjectRuntimeRecord) -> Result<(), StudioCoreError> {
    let exit_status = if let Some(server) = record.dev_server.as_mut() {
        server
            .child
            .try_wait()
            .map_err(|source| tool_io("inspect pnpm dev server", pnpm_executable(), source))?
    } else {
        None
    };
    if let Some(exit_status) = exit_status {
        let server = record
            .dev_server
            .take()
            .ok_or(StudioCoreError::RuntimeStateUnavailable)?;
        record.last_dev_server = Some(finish_dev_server(
            server,
            exit_status,
            DevServerState::Exited,
        )?);
    }
    Ok(())
}

fn loopback_dev_server_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn reserve_loopback_dev_server_port(
    requested_port: Option<u16>,
) -> Result<(u16, TcpListener), StudioCoreError> {
    let port = requested_port.unwrap_or(0);
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port)))
        .map_err(|source| StudioCoreError::ProjectPortUnavailable { port, source })?;
    let reserved_port = listener
        .local_addr()
        .map_err(|source| StudioCoreError::ProjectPortUnavailable { port, source })?
        .port();
    Ok((reserved_port, listener))
}

fn pnpm_dev_arguments(port: u16) -> Vec<String> {
    // pnpm forwards arguments after the script name directly. Adding npm's
    // extra `--` would launch `vite -- --host ...`, causing Vite to treat the
    // flags as positional input while the process remains misleadingly alive.
    vec![
        "run".to_owned(),
        "dev".to_owned(),
        "--host".to_owned(),
        Ipv4Addr::LOCALHOST.to_string(),
        "--port".to_owned(),
        port.to_string(),
        "--strictPort".to_owned(),
    ]
}

fn loopback_dev_server_ready(port: u16) -> bool {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&address, DEV_SERVER_READINESS_TIMEOUT).is_ok()
}

fn dev_server_start_failure(status: &DevServerStatus, timed_out: bool) -> String {
    let base = if timed_out {
        "generated project did not become ready before the startup timeout"
    } else {
        "generated project exited before its dev server became ready"
    };
    let detail = last_process_output(&status.stdout, &status.stderr);
    let exit = status
        .exit_code
        .map(|code| format!(" (exit code {code})"))
        .unwrap_or_default();
    detail.map_or_else(
        || format!("{base}{exit}"),
        |detail| format!("{base}{exit}: {detail}"),
    )
}

fn project_build_failure(result: &ProjectTaskResult) -> String {
    let detail = last_process_output(&result.stdout, &result.stderr);
    let exit = result
        .exit_code
        .map(|code| format!(" (exit code {code})"))
        .unwrap_or_default();
    detail.map_or_else(
        || format!("generated project failed to compile{exit}"),
        |detail| format!("generated project failed to compile{exit}: {detail}"),
    )
}

fn last_process_output(stdout: &str, stderr: &str) -> Option<String> {
    let output = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    output
        .lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .map(|line| line.chars().take(500).collect::<String>())
}

fn finish_dev_server(
    mut server: ManagedDevServer,
    exit_status: ExitStatus,
    state: DevServerState,
) -> Result<DevServerStatus, StudioCoreError> {
    join_output_reader(server.stdout_reader.take())?;
    join_output_reader(server.stderr_reader.take())?;
    let stdout = snapshot_output(&server.stdout)?;
    let stderr = snapshot_output(&server.stderr)?;
    Ok(DevServerStatus {
        state,
        ready: false,
        pid: Some(server.pid),
        port: Some(server.port),
        url: Some(loopback_dev_server_url(server.port)),
        exit_code: exit_status.code(),
        stdout: stdout.text,
        stderr: stderr.text,
        output_truncated: stdout.truncated || stderr.truncated,
        started_at_millis: Some(server.started_at_millis),
    })
}

fn stop_managed_dev_server(
    mut server: ManagedDevServer,
) -> Result<DevServerStatus, StudioCoreError> {
    terminate_process_tree(&mut server.child, server.pid)?;
    let status = server
        .child
        .wait()
        .map_err(|source| tool_io("wait for pnpm dev server", pnpm_executable(), source))?;
    finish_dev_server(server, status, DevServerState::Stopped)
}

fn project_runtime_status(
    project_root: &Path,
    dependency: ProjectDependencyInspection,
    record: &ProjectRuntimeRecord,
) -> ProjectRuntimeStatus {
    let dev_server = if let Some(server) = record.dev_server.as_ref() {
        let stdout = snapshot_output(&server.stdout).unwrap_or(CapturedText {
            text: String::new(),
            truncated: false,
        });
        let stderr = snapshot_output(&server.stderr).unwrap_or(CapturedText {
            text: String::new(),
            truncated: false,
        });
        DevServerStatus {
            state: DevServerState::Running,
            ready: loopback_dev_server_ready(server.port),
            pid: Some(server.pid),
            port: Some(server.port),
            url: Some(loopback_dev_server_url(server.port)),
            exit_code: None,
            stdout: stdout.text,
            stderr: stderr.text,
            output_truncated: stdout.truncated || stderr.truncated,
            started_at_millis: Some(server.started_at_millis),
        }
    } else {
        record.last_dev_server.clone().unwrap_or(DevServerStatus {
            state: DevServerState::Stopped,
            ready: false,
            pid: None,
            port: None,
            url: None,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            output_truncated: false,
            started_at_millis: None,
        })
    };
    let running = dev_server.state == DevServerState::Running;
    let message = if let Some(task) = record.active_task.as_ref() {
        match task.kind {
            ProjectTaskKind::Install => "Installing dependencies…".to_owned(),
            ProjectTaskKind::Build => "Building the application…".to_owned(),
        }
    } else if record.stopping_dev_server {
        "Stopping the application…".to_owned()
    } else if running && dev_server.ready {
        dev_server.port.map_or_else(
            || "Application is running on the loopback interface.".to_owned(),
            |port| format!("Application is running at http://127.0.0.1:{port}."),
        )
    } else if running {
        "Application is starting on the loopback interface…".to_owned()
    } else {
        dependency.message.clone()
    };

    ProjectRuntimeStatus {
        path: project_root.to_string_lossy().into_owned(),
        lockfile_present: dependency.lockfile_present,
        dependencies_installed: dependency.dependencies_installed,
        dependencies_ready: dependency.state == ProjectDependencyState::Ready,
        dependency_state: dependency.state,
        active_task: record.active_task.clone(),
        last_task: record.last_task.clone(),
        running,
        port: running.then_some(dev_server.port).flatten(),
        dev_server,
        message,
    }
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_tree(child: &mut Child, pid: u32) -> Result<(), StudioCoreError> {
    let process_group = format!("-{pid}");
    let _ = Command::new("kill")
        .args(["-TERM", process_group.as_str()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if wait_for_exit(child, Duration::from_secs(2))? {
        return Ok(());
    }
    let _ = Command::new("kill")
        .args(["-KILL", process_group.as_str()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if wait_for_exit(child, Duration::from_secs(2))? {
        Ok(())
    } else {
        child
            .kill()
            .map_err(|source| tool_io("terminate pnpm dev server", pnpm_executable(), source))
    }
}

#[cfg(windows)]
fn terminate_process_tree(child: &mut Child, pid: u32) -> Result<(), StudioCoreError> {
    let tree_was_terminated = Command::new("taskkill.exe")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    if !tree_was_terminated && child.try_wait().ok().flatten().is_none() {
        child
            .kill()
            .map_err(|source| tool_io("terminate pnpm dev server", pnpm_executable(), source))?;
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn terminate_process_tree(child: &mut Child, _pid: u32) -> Result<(), StudioCoreError> {
    child
        .kill()
        .map_err(|source| tool_io("terminate pnpm dev server", pnpm_executable(), source))
}

#[cfg(unix)]
fn terminate_process_tree_by_pid(pid: u32) {
    let process_group = format!("-{pid}");
    let _ = Command::new("kill")
        .args(["-KILL", process_group.as_str()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(windows)]
fn terminate_process_tree_by_pid(pid: u32) {
    let _ = Command::new("taskkill.exe")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(any(unix, windows)))]
fn terminate_process_tree_by_pid(_pid: u32) {}

fn wait_for_exit(child: &mut Child, timeout: Duration) -> Result<bool, StudioCoreError> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if child
            .try_wait()
            .map_err(|source| tool_io("inspect pnpm dev server", pnpm_executable(), source))?
            .is_some()
        {
            return Ok(true);
        }
        thread::sleep(Duration::from_millis(25));
    }
    Ok(false)
}

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn tool_io(
    operation: &'static str,
    executable: &'static str,
    source: std::io::Error,
) -> StudioCoreError {
    if source.kind() == std::io::ErrorKind::NotFound {
        StudioCoreError::ToolUnavailable(executable)
    } else {
        StudioCoreError::ToolIo {
            operation,
            executable,
            source,
        }
    }
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

fn checked_tsx_path(raw_path: &str) -> Result<PathBuf, StudioCoreError> {
    if raw_path.is_empty() || raw_path.contains('\0') {
        return Err(StudioCoreError::InvalidPath("TSX source path is invalid"));
    }
    let path = Path::new(raw_path);
    if !path.is_absolute() || path.file_name().is_none() {
        return Err(StudioCoreError::InvalidPath(
            "TSX source path must be an absolute file path",
        ));
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !file_name.ends_with(".ui.tsx") {
        return Err(StudioCoreError::InvalidPath(
            "Srijika UI source files must end in .ui.tsx",
        ));
    }
    Ok(path.to_path_buf())
}

fn checked_project_path(raw_path: &str) -> Result<PathBuf, StudioCoreError> {
    if raw_path.is_empty() || raw_path.contains('\0') {
        return Err(StudioCoreError::InvalidPath("project path is invalid"));
    }
    let path = Path::new(raw_path);
    if !path.is_absolute() || path.file_name().is_none() {
        return Err(StudioCoreError::InvalidPath(
            "project path must be an absolute directory path",
        ));
    }
    Ok(path.to_path_buf())
}

fn checked_relative_project_path(raw_path: &str) -> Result<PathBuf, StudioCoreError> {
    if raw_path.is_empty() || raw_path.contains('\0') {
        return Err(StudioCoreError::InvalidProjectFile(raw_path.to_owned()));
    }
    let path = Path::new(raw_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(StudioCoreError::InvalidProjectFile(raw_path.to_owned()));
    }
    Ok(path.to_path_buf())
}

fn validate_project_files(
    files: &[CodeProjectFile],
    entry_source: &str,
) -> Result<(), StudioCoreError> {
    if files.is_empty() || files.len() > MAX_PROJECT_FILES {
        return Err(StudioCoreError::InvalidProject(
            "project file count is outside the supported range",
        ));
    }
    let entry = checked_relative_project_path(entry_source)?;
    if !entry_source.ends_with(".ui.tsx") {
        return Err(StudioCoreError::InvalidProject(
            "entry source must end in .ui.tsx",
        ));
    }
    let mut seen = HashSet::new();
    let mut total = 0usize;
    let mut config_source = None;
    for file in files {
        let path = checked_relative_project_path(&file.path)?;
        if !seen.insert(path.clone()) {
            return Err(StudioCoreError::InvalidProjectFile(file.path.clone()));
        }
        if file.contents.len() > MAX_PROJECT_FILE_BYTES {
            return Err(StudioCoreError::InvalidProject(
                "one project file exceeds the size limit",
            ));
        }
        total = total.saturating_add(file.contents.len());
        if total > MAX_PROJECT_BYTES {
            return Err(StudioCoreError::InvalidProject(
                "project contents exceed the size limit",
            ));
        }
        if path == Path::new("srijika.config.json") {
            config_source = Some(file.contents.as_str());
        }
    }
    if !seen.contains(&entry) {
        return Err(StudioCoreError::InvalidProject(
            "entry source is missing from the project files",
        ));
    }
    let config_source = config_source.ok_or(StudioCoreError::InvalidProject(
        "project files must include srijika.config.json",
    ))?;
    if config_source.len() as u64 > MAX_PROJECT_CONFIG_BYTES {
        return Err(StudioCoreError::InvalidProject(
            "srijika.config.json exceeds the size limit",
        ));
    }
    let config: Value = serde_json::from_str(config_source)
        .map_err(|_| StudioCoreError::InvalidProject("srijika.config.json is not valid JSON"))?;
    let config = config.as_object().ok_or(StudioCoreError::InvalidProject(
        "srijika.config.json must contain an object",
    ))?;
    if config.get("sourceOfTruth").and_then(Value::as_str) != Some("tsx") {
        return Err(StudioCoreError::InvalidProject(
            "project sourceOfTruth must be tsx",
        ));
    }
    if config.get("entry").and_then(Value::as_str) != Some(entry_source) {
        return Err(StudioCoreError::InvalidProject(
            "project config entry must match the generated entry source",
        ));
    }
    Ok(())
}

fn validate_component_name(name: &str) -> Result<(), StudioCoreError> {
    if name.is_empty() || name.len() > MAX_COMPONENT_NAME_BYTES {
        return Err(StudioCoreError::InvalidProject(
            "component name must be between 1 and 64 ASCII characters",
        ));
    }
    let mut characters = name.chars();
    if !characters
        .next()
        .is_some_and(|character| character.is_ascii_uppercase())
        || !characters.all(|character| character.is_ascii_alphanumeric())
    {
        return Err(StudioCoreError::InvalidProject(
            "component name must be a PascalCase JavaScript identifier",
        ));
    }
    let slug = pascal_case_path_segment_unchecked(name);
    let canonical = slug
        .split('-')
        .map(|segment| {
            let mut characters = segment.chars();
            let mut word = String::with_capacity(segment.len());
            if let Some(first) = characters.next() {
                word.push(first.to_ascii_uppercase());
                word.extend(characters);
            }
            word
        })
        .collect::<String>();
    if canonical != name {
        return Err(StudioCoreError::InvalidProject(
            "component name must use normalized PascalCase (for example ApiClient, not APIClient)",
        ));
    }
    Ok(())
}

fn validate_new_ui_relative_path(
    raw_path: &str,
    component_name: &str,
) -> Result<PathBuf, StudioCoreError> {
    if raw_path.len() > MAX_NEW_UI_RELATIVE_PATH_BYTES || raw_path.contains('\\') {
        return Err(StudioCoreError::InvalidProject(
            "new UI path must be a bounded forward-slash project path",
        ));
    }
    let relative = checked_relative_project_path(raw_path)?;
    if relative.components().count() > MAX_NEW_UI_DEPTH {
        return Err(StudioCoreError::InvalidProject(
            "new UI path exceeds the supported directory depth",
        ));
    }
    if relative
        .components()
        .next()
        .and_then(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        != Some("src")
    {
        return Err(StudioCoreError::InvalidProject(
            "new UI sources must be created below src",
        ));
    }
    if relative.starts_with(Path::new("src").join("features")) {
        return Err(StudioCoreError::InvalidProject(
            "use ownership-aware Structure capabilities for UI files below src/features",
        ));
    }
    let expected_file_name = format!("{component_name}.ui.tsx");
    if relative.file_name().and_then(|value| value.to_str()) != Some(&expected_file_name) {
        return Err(StudioCoreError::InvalidProject(
            "new UI file name must match the component name and end in .ui.tsx",
        ));
    }
    if relative.components().any(|component| {
        matches!(component, Component::Normal(value) if match value.to_str() {
            Some(part) => {
                part.is_empty()
                    || IGNORED_PROJECT_DIRECTORIES
                        .iter()
                        .any(|ignored| part.eq_ignore_ascii_case(ignored))
            }
            None => true,
        })
    }) {
        return Err(StudioCoreError::InvalidProject(
            "new UI path contains an unsupported project directory",
        ));
    }
    Ok(relative)
}

fn new_ui_source_pair(kind: CodeProjectUiSourceKind, name: &str) -> (String, String) {
    const PAGE_UI: &str = r#"export interface __NAME__UIProps {
  title: string;
  description: string;
}

export function __NAME__UI(props: __NAME__UIProps) {
  return (
    <main className="srijika-page">
      <section>
        <p>New Srijika page</p>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </section>
    </main>
  );
}
"#;
    const PAGE_CONNECTOR: &str = r#"import { __NAME__UI } from './__NAME__.ui';

export function __NAME__Connector() {
  return (
    <__NAME__UI
      title="__NAME__"
      description="Start building this page in __NAME__.ui.tsx."
    />
  );
}
"#;
    const COMPONENT_UI: &str = r#"export interface __NAME__UIProps {
  label: string;
  supportingText: string;
}

export function __NAME__UI(props: __NAME__UIProps) {
  return (
    <section className="srijika-component">
      <h2>{props.label}</h2>
      <p>{props.supportingText}</p>
    </section>
  );
}
"#;
    const COMPONENT_CONNECTOR: &str = r#"import { __NAME__UI } from './__NAME__.ui';

export function __NAME__Connector() {
  return (
    <__NAME__UI
      label="__NAME__"
      supportingText="Connect data and behavior in __NAME__.connector.tsx."
    />
  );
}
"#;

    let (ui, connector) = match kind {
        CodeProjectUiSourceKind::Page => (PAGE_UI, PAGE_CONNECTOR),
        CodeProjectUiSourceKind::Component => (COMPONENT_UI, COMPONENT_CONNECTOR),
    };
    (
        ui.replace("__NAME__", name),
        connector.replace("__NAME__", name),
    )
}

#[derive(Debug)]
struct ScaffoldFilePlan {
    relative_path: PathBuf,
    role: CodeProjectScaffoldFileRole,
    source: String,
}

fn scaffold_file_plan(
    relative_path: PathBuf,
    role: CodeProjectScaffoldFileRole,
    source: String,
) -> ScaffoldFilePlan {
    ScaffoldFilePlan {
        relative_path,
        role,
        source,
    }
}

fn pascal_case_path_segment(name: &str) -> Result<String, StudioCoreError> {
    validate_component_name(name)?;
    Ok(pascal_case_path_segment_unchecked(name))
}

fn pascal_case_path_segment_unchecked(name: &str) -> String {
    let characters = name.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(name.len().saturating_add(8));
    for (index, character) in characters.iter().copied().enumerate() {
        let previous = index.checked_sub(1).and_then(|value| characters.get(value));
        let next = characters.get(index.saturating_add(1));
        if character.is_ascii_uppercase()
            && index > 0
            && (previous.is_some_and(|value| value.is_ascii_lowercase() || value.is_ascii_digit())
                || (previous.is_some_and(|value| value.is_ascii_uppercase())
                    && next.is_some_and(|value| value.is_ascii_lowercase())))
        {
            output.push('-');
        }
        output.push(character.to_ascii_lowercase());
    }
    output
}

fn lower_camel_owner_name(name: &str) -> Result<String, StudioCoreError> {
    validate_component_name(name)?;
    let mut characters = name.chars();
    let first = characters.next().ok_or(StudioCoreError::InvalidProject(
        "component name must not be empty",
    ))?;
    let mut output = String::with_capacity(name.len());
    output.push(first.to_ascii_lowercase());
    output.extend(characters);
    Ok(output)
}

fn validate_scoped_hook_name(name: &str, owner_name: &str) -> Result<(), StudioCoreError> {
    let prefix = format!("use{owner_name}");
    let remainder = name.strip_prefix(&prefix);
    if name.len() > MAX_COMPONENT_NAME_BYTES.saturating_add(3)
        || remainder.is_none()
        || remainder.is_some_and(|value| {
            value.chars().next().is_some_and(|character| {
                !character.is_ascii_uppercase() && !character.is_ascii_digit()
            })
        })
    {
        return Err(StudioCoreError::InvalidProject(
            "hook name must start with use followed by its owner name",
        ));
    }
    let suffix = name.strip_prefix("use").unwrap_or_default();
    validate_component_name(suffix)
}

fn validate_existing_scaffold_ui(root: &Path, relative: &Path) -> Result<(), StudioCoreError> {
    if relative.components().count() > MAX_NEW_UI_DEPTH {
        return Err(StudioCoreError::InvalidProject(
            "scaffold path exceeds the supported directory depth",
        ));
    }
    let path = root.join(relative);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|source| source_io("inspect required scaffold UI", &path, source))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(StudioCoreError::InvalidProject(
            "required scaffold UI must be a real file",
        ));
    }
    let canonical = fs::canonicalize(&path)
        .map_err(|source| source_io("resolve required scaffold UI", &path, source))?;
    ensure_project_containment(root, &canonical)
}

fn validated_existing_slot_relative(
    root: &Path,
    feature_relative: &Path,
    slot_name: &str,
) -> Result<PathBuf, StudioCoreError> {
    validate_component_name(slot_name)?;
    let slot_slug = pascal_case_path_segment(slot_name)?;
    let slot_relative = feature_relative.join("slots").join(slot_slug);
    validate_existing_scaffold_ui(root, &slot_relative.join(format!("{slot_name}.ui.tsx")))?;
    Ok(slot_relative)
}

fn validated_existing_part_relative(
    root: &Path,
    feature_relative: &Path,
    slot_name: &str,
    part_name: &str,
) -> Result<PathBuf, StudioCoreError> {
    let slot_relative = validated_existing_slot_relative(root, feature_relative, slot_name)?;
    validate_component_name(part_name)?;
    let part_slug = pascal_case_path_segment(part_name)?;
    let part_relative = slot_relative.join("parts").join(part_slug);
    validate_existing_scaffold_ui(root, &part_relative.join(format!("{part_name}.ui.tsx")))?;
    Ok(part_relative)
}

fn connector_source(name: &str) -> String {
    format!(
        "import type {{ ComponentProps }} from 'react';\n\nimport {{ {name}UI }} from './{name}.ui';\n\nexport type {name}ConnectorProps = ComponentProps<typeof {name}UI>;\n\nexport function {name}Connector(props: {name}ConnectorProps) {{\n  return <{name}UI {{...props}} />;\n}}\n"
    )
}

#[derive(Debug, Clone, Copy, Default)]
struct OwnerLayerSelection {
    hook: bool,
    store: bool,
    logic: bool,
    api: bool,
    types: bool,
}

#[derive(Debug, Clone, Copy)]
struct OwnerFileRoles {
    connector: CodeProjectScaffoldFileRole,
    hook: CodeProjectScaffoldFileRole,
    store: CodeProjectScaffoldFileRole,
    logic: CodeProjectScaffoldFileRole,
    api: CodeProjectScaffoldFileRole,
    types: CodeProjectScaffoldFileRole,
}

fn progressive_connector_source(name: &str, layers: OwnerLayerSelection) -> String {
    let stem = lower_camel_owner_name(name).expect("validated owner name");
    let (import, access) = if layers.hook {
        (
            format!("import {{ use{name} }} from './use{name}';\n"),
            format!("const {{ ready, run }} = use{name}();"),
        )
    } else if layers.store {
        (
            format!("import {{ use{name}Store }} from './{stem}.store';\n"),
            format!(
                "const ready = use{name}Store((state) => state.ready);\n  const run = use{name}Store((state) => state.run);"
            ),
        )
    } else if layers.logic {
        (
            format!(
                "import {{ useCallback, useState }} from 'react';\n\nimport {{ run{name}Logic }} from './{stem}.logic';\n"
            ),
            format!(
                "const [ready, setReady] = useState(false);\n  const run = useCallback(async () => setReady(await run{name}Logic()), []);"
            ),
        )
    } else if layers.api {
        (
            format!(
                "import {{ useCallback, useState }} from 'react';\n\nimport {{ load{name}FromApi }} from './{stem}.api';\n"
            ),
            format!(
                "const [ready, setReady] = useState(false);\n  const run = useCallback(async () => setReady(await load{name}FromApi()), []);"
            ),
        )
    } else {
        return connector_source(name);
    };

    format!(
        "{import}\nimport {{ {name}UI }} from './{name}.ui';\n\nexport function {name}Connector() {{\n  {access}\n\n  return <{name}UI ready={{ready}} onRun={{() => void run()}} />;\n}}\n"
    )
}

fn progressive_hook_source(name: &str, layers: OwnerLayerSelection) -> String {
    let stem = lower_camel_owner_name(name).expect("validated owner name");
    if layers.store {
        return format!(
            "import {{ use{name}Store }} from './{stem}.store';\n\nexport function use{name}() {{\n  const ready = use{name}Store((state) => state.ready);\n  const run = use{name}Store((state) => state.run);\n\n  return {{ ready, run }};\n}}\n"
        );
    }

    let (import, operation) = if layers.logic {
        (
            format!("import {{ run{name}Logic }} from './{stem}.logic';"),
            format!("run{name}Logic"),
        )
    } else if layers.api {
        (
            format!("import {{ load{name}FromApi }} from './{stem}.api';"),
            format!("load{name}FromApi"),
        )
    } else {
        return format!(
            "import {{ useCallback, useState }} from 'react';\n\nexport function use{name}() {{\n  const [ready, setReady] = useState(false);\n  const run = useCallback(() => setReady(true), []);\n\n  return {{ ready, run }};\n}}\n"
        );
    };

    format!(
        "import {{ useCallback, useState }} from 'react';\n\n{import}\n\nexport function use{name}() {{\n  const [ready, setReady] = useState(false);\n  const run = useCallback(async () => setReady(await {operation}()), []);\n\n  return {{ ready, run }};\n}}\n"
    )
}

fn progressive_store_source(name: &str, layers: OwnerLayerSelection) -> String {
    let stem = lower_camel_owner_name(name).expect("validated owner name");
    let (import, run_body) = if layers.logic {
        (
            format!("import {{ run{name}Logic }} from './{stem}.logic';\n"),
            format!("const ready = await run{name}Logic();\n    set({{ ready }});"),
        )
    } else if layers.api {
        (
            format!("import {{ load{name}FromApi }} from './{stem}.api';\n"),
            format!("const ready = await load{name}FromApi();\n    set({{ ready }});"),
        )
    } else {
        (String::new(), "set({ ready: true });".to_owned())
    };

    format!(
        "import {{ create }} from 'zustand';\n{import}\nexport interface {name}State {{\n  ready: boolean;\n  run: () => Promise<void>;\n}}\n\nexport const use{name}Store = create<{name}State>((set) => ({{\n  ready: false,\n  run: async () => {{\n    {run_body}\n  }},\n}}));\n"
    )
}

fn progressive_logic_source(name: &str, layers: OwnerLayerSelection) -> String {
    if layers.api {
        let stem = lower_camel_owner_name(name).expect("validated owner name");
        return format!(
            "import {{ load{name}FromApi }} from './{stem}.api';\n\nexport async function run{name}Logic(): Promise<boolean> {{\n  const ready = await load{name}FromApi();\n\n  // Keep {name} business rules, validation, and transformations here.\n  return ready;\n}}\n"
        );
    }

    format!(
        "export async function run{name}Logic(): Promise<boolean> {{\n  // Keep {name} business rules, validation, and transformations here.\n  return true;\n}}\n"
    )
}

fn progressive_api_source(name: &str) -> String {
    format!(
        "export async function load{name}FromApi(): Promise<boolean> {{\n  // Keep {name} HTTP transport and response parsing here.\n  return true;\n}}\n"
    )
}

fn owner_types_source(name: &str) -> String {
    format!(
        "export interface {name}Data {{\n  ready: boolean;\n}}\n\nexport type {name}Action = () => void | Promise<void>;\n"
    )
}

fn append_owner_capability_plans(
    plans: &mut Vec<ScaffoldFilePlan>,
    relative: &Path,
    name: &str,
    roles: OwnerFileRoles,
    layers: OwnerLayerSelection,
    create_connector: bool,
    legacy_hook_name: Option<&str>,
) -> Result<(), StudioCoreError> {
    let stem = lower_camel_owner_name(name)?;
    if create_connector {
        plans.push(scaffold_file_plan(
            relative.join(format!("{name}.connector.tsx")),
            roles.connector,
            progressive_connector_source(name, layers),
        ));
    }
    if layers.hook {
        plans.push(scaffold_file_plan(
            relative.join(format!("use{name}.ts")),
            roles.hook,
            progressive_hook_source(name, layers),
        ));
    }
    if layers.store {
        plans.push(scaffold_file_plan(
            relative.join(format!("{stem}.store.ts")),
            roles.store,
            progressive_store_source(name, layers),
        ));
    }
    if layers.logic {
        plans.push(scaffold_file_plan(
            relative.join(format!("{stem}.logic.ts")),
            roles.logic,
            progressive_logic_source(name, layers),
        ));
    }
    if layers.api {
        plans.push(scaffold_file_plan(
            relative.join(format!("{stem}.api.ts")),
            roles.api,
            progressive_api_source(name),
        ));
    }
    if layers.types {
        plans.push(scaffold_file_plan(
            relative.join(format!("{stem}.types.ts")),
            roles.types,
            owner_types_source(name),
        ));
    }
    if let Some(hook_name) = legacy_hook_name {
        validate_scoped_hook_name(hook_name, name)?;
        plans.push(scaffold_file_plan(
            relative.join("hooks").join(format!("{hook_name}.ts")),
            roles.hook,
            hook_source(hook_name, name),
        ));
    }
    Ok(())
}

fn existing_owner_layers(root: &Path, relative: &Path, name: &str) -> OwnerLayerSelection {
    let stem = lower_camel_owner_name(name).expect("validated owner name");
    OwnerLayerSelection {
        hook: root.join(relative).join(format!("use{name}.ts")).is_file(),
        store: root
            .join(relative)
            .join(format!("{stem}.store.ts"))
            .is_file(),
        logic: root
            .join(relative)
            .join(format!("{stem}.logic.ts"))
            .is_file(),
        api: root.join(relative).join(format!("{stem}.api.ts")).is_file(),
        types: root
            .join(relative)
            .join(format!("{stem}.types.ts"))
            .is_file(),
    }
}

fn hook_source(hook_name: &str, owner_name: &str) -> String {
    format!(
        "export function {hook_name}() {{\n  // Keep {owner_name}-scoped React behavior here.\n}}\n"
    )
}

fn feature_ui_source(name: &str) -> String {
    format!(
        "export interface {name}UIProps {{\n  title?: string;\n  ready?: boolean;\n  onRun?: () => void;\n}}\n\nexport function {name}UI(props: {name}UIProps) {{\n  return (\n    <main data-srijika-feature=\"{name}\">\n      <h1>{{props.title ?? '{name}'}}</h1>\n      <button type=\"button\" onClick={{props.onRun}}>\n        {{props.ready ? 'Ready' : 'Run'}}\n      </button>\n    </main>\n  );\n}}\n"
    )
}

fn slot_ui_source(name: &str) -> String {
    format!(
        "export interface {name}UIProps {{\n  label?: string;\n  ready?: boolean;\n  onRun?: () => void;\n}}\n\nexport function {name}UI(props: {name}UIProps) {{\n  return (\n    <section data-srijika-slot=\"{name}\" aria-label={{props.label ?? '{name} slot'}}>\n      <span>{{props.label}}</span>\n      <button type=\"button\" onClick={{props.onRun}}>\n        {{props.ready ? 'Ready' : 'Run'}}\n      </button>\n    </section>\n  );\n}}\n"
    )
}

fn part_ui_source(name: &str) -> String {
    format!(
        "export interface {name}UIProps {{\n  label?: string;\n  ready?: boolean;\n  onRun?: () => void;\n}}\n\nexport function {name}UI(props: {name}UIProps) {{\n  return (\n    <div data-srijika-part=\"{name}\">\n      <span>{{props.label}}</span>\n      <button type=\"button\" onClick={{props.onRun}}>\n        {{props.ready ? 'Ready' : 'Run'}}\n      </button>\n    </div>\n  );\n}}\n"
    )
}

fn create_scaffold_files(
    root: &Path,
    plans: Vec<ScaffoldFilePlan>,
) -> Result<Vec<ScaffoldedCodeProjectFile>, StudioCoreError> {
    if plans.is_empty() {
        return Err(StudioCoreError::InvalidProject(
            "scaffold capability must create at least one file",
        ));
    }

    let relative_paths = plans
        .iter()
        .map(|plan| path_to_forward_slashes(&plan.relative_path))
        .collect::<Result<Vec<_>, _>>()?;
    let mut seen_paths = HashSet::new();
    for (plan, relative) in plans.iter().zip(&relative_paths) {
        if plan.relative_path.components().count() > MAX_NEW_UI_DEPTH
            || !seen_paths.insert(relative.to_ascii_lowercase())
        {
            return Err(StudioCoreError::InvalidProject(
                "scaffold capability contains an invalid or duplicate path",
            ));
        }
    }

    let mut created_directories = Vec::new();
    let mut prepared_parents = HashSet::new();
    let preparation = (|| {
        for plan in &plans {
            let parent = plan.relative_path.parent().unwrap_or_else(|| Path::new(""));
            let parent_key = path_to_forward_slashes(parent)?.to_ascii_lowercase();
            if prepared_parents.insert(parent_key) {
                created_directories.extend(ensure_safe_project_directory(root, parent)?);
            }
        }
        for plan in &plans {
            refuse_existing_project_file(&root.join(&plan.relative_path))?;
        }
        Ok::<(), StudioCoreError>(())
    })();
    if let Err(error) = preparation {
        remove_created_directories(&created_directories);
        return Err(error);
    }

    let mut created_paths = Vec::new();
    for plan in &plans {
        let path = root.join(&plan.relative_path);
        if let Err(error) = atomic_create_text(root, &path, &plan.source) {
            for created in created_paths.iter().rev() {
                let _ = fs::remove_file(created);
            }
            remove_created_directories(&created_directories);
            return Err(error);
        }
        created_paths.push(path);
    }

    Ok(plans
        .into_iter()
        .zip(created_paths)
        .zip(relative_paths)
        .map(|((plan, path), relative_path)| ScaffoldedCodeProjectFile {
            path: path.to_string_lossy().into_owned(),
            relative_path,
            role: plan.role,
            bytes: plan.source.len() as u64,
            hash: source_hash(&plan.source),
        })
        .collect())
}

fn ensure_safe_project_directory(
    root: &Path,
    relative: &Path,
) -> Result<Vec<PathBuf>, StudioCoreError> {
    let mut current = root.to_path_buf();
    let mut created = Vec::new();
    let result = (|| {
        for component in relative.components() {
            let Component::Normal(component) = component else {
                return Err(StudioCoreError::InvalidProject(
                    "new UI directory path is invalid",
                ));
            };
            current.push(component);
            match fs::create_dir(&current) {
                Ok(()) => created.push(current.clone()),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => {
                    return Err(source_io(
                        "create project source directory",
                        &current,
                        error,
                    ));
                }
            }
            let metadata = fs::symlink_metadata(&current).map_err(|source| {
                source_io("inspect project source directory", &current, source)
            })?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(StudioCoreError::InvalidProject(
                    "new UI parent must contain only real directories",
                ));
            }
            let canonical = fs::canonicalize(&current).map_err(|source| {
                source_io("resolve project source directory", &current, source)
            })?;
            ensure_project_containment(root, &canonical)?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        remove_created_directories(&created);
        return Err(error);
    }
    Ok(created)
}

fn remove_created_directories(directories: &[PathBuf]) {
    for directory in directories.iter().rev() {
        let _ = fs::remove_dir(directory);
    }
}

fn refuse_existing_project_file(path: &Path) -> Result<(), StudioCoreError> {
    match fs::symlink_metadata(path) {
        Ok(_) => {
            return Err(StudioCoreError::ProjectFileAlreadyExists(
                path.to_path_buf(),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(source_io("inspect new project source", path, error)),
    }

    let parent = path.parent().ok_or(StudioCoreError::InvalidProject(
        "new UI source must have a project directory",
    ))?;
    let target_name = path.file_name().and_then(|value| value.to_str()).ok_or(
        StudioCoreError::InvalidProject("new UI source name must be UTF-8"),
    )?;
    for entry in fs::read_dir(parent)
        .map_err(|source| source_io("read project source directory", parent, source))?
    {
        let entry = entry
            .map_err(|source| source_io("read project source directory entry", parent, source))?;
        if entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(target_name))
        {
            return Err(StudioCoreError::ProjectFileAlreadyExists(entry.path()));
        }
    }
    Ok(())
}

fn atomic_create_text(root: &Path, path: &Path, contents: &str) -> Result<(), StudioCoreError> {
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .ok_or(StudioCoreError::InvalidProject(
            "new UI source must have a project directory",
        ))?;
    let metadata = fs::symlink_metadata(parent)
        .map_err(|source| source_io("inspect new project source directory", parent, source))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(StudioCoreError::InvalidProject(
            "new UI parent must be a real directory",
        ));
    }
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|source| source_io("resolve new project source directory", parent, source))?;
    ensure_project_containment(root, &canonical_parent)?;

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("source");
    let mut temporary = Builder::new()
        .prefix(&format!(".{file_name}."))
        .suffix(".srijika.tmp")
        .tempfile_in(&canonical_parent)
        .map_err(|source| source_io("create temporary project source", parent, source))?;
    temporary
        .as_file_mut()
        .write_all(contents.as_bytes())
        .and_then(|_| temporary.as_file_mut().flush())
        .map_err(|source| source_io("write temporary project source", temporary.path(), source))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|source| source_io("sync temporary project source", temporary.path(), source))?;
    temporary.persist_noclobber(path).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            StudioCoreError::ProjectFileAlreadyExists(path.to_path_buf())
        } else {
            source_io("create project source", path, error.error)
        }
    })?;
    Ok(())
}

fn atomic_write_text(path: &Path, contents: &str) -> Result<(), StudioCoreError> {
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .ok_or(StudioCoreError::InvalidPath(
            "source path must have a parent directory",
        ))?;
    if !parent.is_dir() {
        return Err(StudioCoreError::InvalidPath(
            "source parent directory does not exist",
        ));
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("source");
    let mut temporary = Builder::new()
        .prefix(&format!(".{file_name}."))
        .suffix(".srijika.tmp")
        .tempfile_in(parent)
        .map_err(|source| source_io("create temporary source file", parent, source))?;
    temporary
        .as_file_mut()
        .write_all(contents.as_bytes())
        .and_then(|_| temporary.as_file_mut().flush())
        .map_err(|source| source_io("write temporary source file", temporary.path(), source))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|source| source_io("sync temporary source file", temporary.path(), source))?;
    temporary
        .persist(path)
        .map_err(|error| source_io("replace source file", path, error.error))?;
    Ok(())
}

fn upgrade_legacy_live_preview_bridge(project_root: &Path) -> Result<bool, StudioCoreError> {
    let path = project_root.join(LIVE_PREVIEW_BRIDGE_RELATIVE_PATH);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(source) => return Err(source_io("inspect live preview bridge", &path, source)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Ok(false);
    }
    if metadata.len() > MAX_TSX_SOURCE_BYTES {
        return Ok(false);
    }

    let canonical_path = fs::canonicalize(&path)
        .map_err(|source| source_io("resolve live preview bridge", &path, source))?;
    ensure_project_containment(project_root, &canonical_path)?;
    let source = fs::read_to_string(&canonical_path)
        .map_err(|source| source_io("read live preview bridge", &canonical_path, source))?;
    if source.contains("const LIVE_PREVIEW_VERSION = 1;")
        && source.contains("srijika:preview-runtime-state")
    {
        return Ok(false);
    }

    let recognizable_legacy_bridge = source
        .contains("const SELECT_MESSAGE = 'srijika:preview-select';")
        && source.contains("const SELECTED_MESSAGE = 'srijika:preview-selected-source';")
        && source.contains("function installPreviewSelectionBridge(): void")
        && source.contains("installPreviewSelectionBridge();");
    if !recognizable_legacy_bridge {
        return Ok(false);
    }

    atomic_write_text(&canonical_path, LIVE_PREVIEW_BRIDGE_SOURCE)?;
    Ok(true)
}

fn source_io(operation: &'static str, path: &Path, source: std::io::Error) -> StudioCoreError {
    StudioCoreError::SourceIo {
        operation,
        path: path.to_path_buf(),
        source,
    }
}

fn source_hash(source: &str) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in source.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("fnv1a64:{hash:016x}")
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
    #[error("TSX source is {actual} bytes; maximum allowed is {max} bytes")]
    SourceTooLarge { max: u64, actual: u64 },
    #[error("project path already exists: {0}")]
    ProjectAlreadyExists(PathBuf),
    #[error("project source already exists: {0}")]
    ProjectFileAlreadyExists(PathBuf),
    #[error("TSX source changed on disk (expected {expected:?}, actual {actual})")]
    SourceConflict {
        expected: Option<String>,
        actual: String,
    },
    #[error("invalid project: {0}")]
    InvalidProject(&'static str),
    #[error("invalid project-relative file path: {0}")]
    InvalidProjectFile(String),
    #[error("invalid VS Code target: {0}")]
    InvalidEditorTarget(&'static str),
    #[error("the project is missing pnpm-lock.yaml")]
    MissingLockfile,
    #[error("project dependencies are not ready: {0}")]
    DependenciesNotReady(String),
    #[error("project runtime is busy: {0}")]
    ProjectBusy(&'static str),
    #[error("project runtime state is unavailable")]
    RuntimeStateUnavailable,
    #[error("project dev-server port {port} is unavailable: {source}")]
    ProjectPortUnavailable {
        port: u16,
        #[source]
        source: std::io::Error,
    },
    #[error("the project application is not running under Srijika Studio")]
    ProjectAppNotRunning,
    #[error("the project application is still starting")]
    ProjectAppNotReady,
    #[error("could not start the project application: {0}")]
    ProjectAppStartFailed(String),
    #[error("project files changed while they were being inspected")]
    ProjectChangedDuringRead,
    #[error("required executable '{0}' is unavailable")]
    ToolUnavailable(&'static str),
    #[error("could not {operation} with {executable}: {source}")]
    ToolIo {
        operation: &'static str,
        executable: &'static str,
        #[source]
        source: std::io::Error,
    },
    #[error("could not {operation} at {path}: {source}")]
    SourceIo {
        operation: &'static str,
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
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
            Self::SourceTooLarge { .. } => "source_too_large",
            Self::ProjectAlreadyExists(_) => "project_exists",
            Self::ProjectFileAlreadyExists(_) => "project_file_exists",
            Self::SourceConflict { .. } => "source_conflict",
            Self::InvalidProject(_) | Self::InvalidProjectFile(_) => "invalid_project",
            Self::InvalidEditorTarget(_) => "invalid_editor_target",
            Self::MissingLockfile => "missing_lockfile",
            Self::DependenciesNotReady(_) => "dependencies_not_ready",
            Self::ProjectBusy(_) => "project_busy",
            Self::RuntimeStateUnavailable => "runtime_state_unavailable",
            Self::ProjectPortUnavailable { .. } => "project_port_unavailable",
            Self::ProjectAppNotRunning => "project_app_not_running",
            Self::ProjectAppNotReady => "project_app_not_ready",
            Self::ProjectAppStartFailed(_) => "project_app_start_failed",
            Self::ProjectChangedDuringRead => "project_changed",
            Self::ToolUnavailable(_) => "tool_unavailable",
            Self::ToolIo { .. } => "tool_error",
            Self::SourceIo { source, .. } if source.kind() == std::io::ErrorKind::NotFound => {
                "not_found"
            }
            Self::SourceIo { .. } => "persistence_error",
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
    use std::{
        fs,
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        process::Command,
        sync::{Arc, Mutex, mpsc},
        thread,
        time::{Duration, Instant},
    };

    #[cfg(unix)]
    use std::os::unix::fs::symlink;

    use serde_json::{Value, json};
    use tempfile::tempdir;

    use super::{
        CappedOutput, CodeProjectFile, CodeProjectScaffoldCapability, CodeProjectScaffoldFileRole,
        CodeProjectUiSourceKind, CreateCodeProjectRequest, CreateCodeProjectUiSourceRequest,
        DevServerState, DocumentValidationError, LoadCodeProjectArchitectureSourcesRequest,
        LoadCodeProjectPreviewStylesRequest, LoadTsxSourceRequest, LoadUiDocumentRequest,
        MAX_ARCHITECTURE_SOURCE_BYTES, MAX_ARCHITECTURE_SOURCES_BYTES, MAX_PROJECT_TREE_DEPTH,
        MAX_PROJECT_TREE_ENTRIES, MAX_TOOL_OUTPUT_BYTES, MIN_DEV_SERVER_PORT, ManagedDevServer,
        OpenCodeProjectAppRequest, OpenCodeProjectRequest, OpenInVsCodeRequest,
        ProjectDependencyState, ProjectRuntimeRecord, ProjectRuntimeStatusRequest,
        ProjectTaskRequest, SaveTsxSourceRequest, SaveUiDocumentRequest,
        ScaffoldCodeProjectStructureRequest, ScanCodeProjectRequest, StartCodeProjectRequest,
        StudioCore, StudioCoreError, pnpm_dev_arguments, pnpm_executable, project_runtime_is_busy,
        upgrade_legacy_live_preview_bridge, validate_ui_document_envelope,
    };

    #[cfg(unix)]
    fn spawn_persistent_test_child() -> std::process::Child {
        let mut command = Command::new("sh");
        command.args(["-c", "while :; do sleep 60; done"]);
        super::configure_process_group(&mut command);
        command.spawn().expect("spawn persistent test child")
    }

    #[cfg(windows)]
    fn spawn_persistent_test_child() -> std::process::Child {
        Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "while ($true) { Start-Sleep -Seconds 60 }",
            ])
            .spawn()
            .expect("spawn persistent test child")
    }

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

    fn write_code_project(project: &std::path::Path, with_package: bool, with_lockfile: bool) {
        let entry = "src/Home.ui.tsx";
        fs::create_dir_all(project.join("src")).expect("create source directory");
        fs::write(
            project.join(entry),
            "export interface HomeProps { title: string; }\nexport function Home(props: HomeProps) { return <main>{props.title}</main>; }\n",
        )
        .expect("write entry source");
        fs::write(
            project.join("srijika.config.json"),
            format!(r#"{{"sourceOfTruth":"tsx","entry":"{entry}"}}"#),
        )
        .expect("write Srijika config");
        if with_package {
            fs::write(
                project.join("package.json"),
                r#"{"name":"test-app","private":true,"packageManager":"pnpm@11.18.0","scripts":{"dev":"vite","build":"vite build"}}"#,
            )
            .expect("write package manifest");
        }
        if with_lockfile {
            fs::write(
                project.join("pnpm-lock.yaml"),
                "lockfileVersion: '9.0'\nsettings: {}\nimporters: {}\n",
            )
            .expect("write lockfile");
        }
    }

    fn write_feature_ui(project: &std::path::Path, feature_name: &str, feature_slug: &str) {
        let feature = project.join("src/features").join(feature_slug);
        fs::create_dir_all(&feature).expect("create feature directory");
        fs::write(
            feature.join(format!("{feature_name}.ui.tsx")),
            format!(
                "export function {feature_name}UI() {{ return <main>{feature_name}</main>; }}\n"
            ),
        )
        .expect("write feature UI");
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
    fn pnpm_dev_arguments_reach_vite_without_an_extra_separator() {
        assert_eq!(
            pnpm_dev_arguments(40_269),
            [
                "run",
                "dev",
                "--host",
                "127.0.0.1",
                "--port",
                "40269",
                "--strictPort",
            ]
        );
    }

    #[test]
    fn upgrades_only_the_recognizable_generated_live_preview_bridge() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path();
        let bridge_directory = project.join("src/srijika");
        fs::create_dir_all(&bridge_directory).expect("create bridge directory");
        let bridge = bridge_directory.join("preview-bridge.ts");
        fs::write(
            &bridge,
            "const SELECT_MESSAGE = 'srijika:preview-select';\nconst SELECTED_MESSAGE = 'srijika:preview-selected-source';\nfunction installPreviewSelectionBridge(): void {}\ninstallPreviewSelectionBridge();\n",
        )
        .expect("write legacy bridge");

        assert!(upgrade_legacy_live_preview_bridge(project).expect("upgrade legacy bridge"));
        let upgraded = fs::read_to_string(&bridge).expect("read upgraded bridge");
        assert!(upgraded.contains("const LIVE_PREVIEW_VERSION = 1;"));
        assert!(upgraded.contains("srijika:preview-runtime-state"));
        assert!(upgraded.contains("import.meta.glob<RuntimeModule>('../**/*.connector.tsx')"));
        assert!(!upgrade_legacy_live_preview_bridge(project).expect("keep current bridge"));

        fs::write(&bridge, "// application-owned custom bridge\n").expect("write custom bridge");
        assert!(!upgrade_legacy_live_preview_bridge(project).expect("preserve custom bridge"));
        assert_eq!(
            fs::read_to_string(&bridge).expect("read custom bridge"),
            "// application-owned custom bridge\n"
        );
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
        let path = directory.path().join("home.srijika.json");
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
        let path = directory.path().join("invalid.srijika.json");
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

    #[test]
    fn creates_a_code_project_and_round_trips_its_tsx_source() {
        let directory = tempdir().expect("temporary directory");
        let project_path = directory.path().join("profile-app");
        let source_relative = "src/components/Profile/Profile.ui.tsx";
        let original = "export function Profile() { return <h1>Hello</h1>; }\n";
        let core = StudioCore::default();

        let created = core
            .create_code_project(CreateCodeProjectRequest {
                path: project_path.to_string_lossy().into_owned(),
                entry_source: source_relative.to_owned(),
                files: vec![
                    CodeProjectFile {
                        path: source_relative.to_owned(),
                        contents: original.to_owned(),
                    },
                    CodeProjectFile {
                        path: "srijika.config.json".to_owned(),
                        contents: format!(
                            "{{\"version\":1,\"sourceOfTruth\":\"tsx\",\"entry\":\"{source_relative}\"}}\n"
                        ),
                    },
                ],
            })
            .expect("create code project");
        assert_eq!(created.file_count, 2);
        assert_eq!(
            created.entry_source_path,
            project_path.join(source_relative).to_string_lossy()
        );

        let loaded = core
            .load_tsx_source(LoadTsxSourceRequest {
                path: created.entry_source_path.clone(),
            })
            .expect("load source");
        assert_eq!(loaded.source, original);

        let opened = core
            .open_code_project(OpenCodeProjectRequest {
                path: project_path.to_string_lossy().into_owned(),
            })
            .expect("open code project");
        assert_eq!(opened.entry_source_path, created.entry_source_path);
        assert_eq!(opened.source, original);
        assert_eq!(opened.hash, loaded.hash);

        let updated = "export function Profile() { return <h1>Changed</h1>; }\n";
        let saved = core
            .save_tsx_source(SaveTsxSourceRequest {
                path: created.entry_source_path.clone(),
                source: updated.to_owned(),
                expected_hash: Some(loaded.hash),
            })
            .expect("save source");
        assert!(saved.replaced);
        assert_eq!(
            core.load_tsx_source(LoadTsxSourceRequest {
                path: created.entry_source_path.clone(),
            })
            .expect("reload source")
            .source,
            updated
        );

        let conflict = core
            .save_tsx_source(SaveTsxSourceRequest {
                path: created.entry_source_path,
                source: original.to_owned(),
                expected_hash: Some("fnv1a64:stale".to_owned()),
            })
            .expect_err("stale Studio write must not replace a VS Code edit");
        assert_eq!(conflict.code(), "source_conflict");
    }

    #[test]
    fn creates_canonical_page_pair_and_rejects_legacy_component_roots() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("source-pair-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();

        let page = core
            .create_code_project_ui_source(CreateCodeProjectUiSourceRequest {
                project_path: project.to_string_lossy().into_owned(),
                relative_path: "src/pages/Dashboard.ui.tsx".to_owned(),
                kind: CodeProjectUiSourceKind::Page,
                component_name: "Dashboard".to_owned(),
                create_connector: true,
            })
            .expect("create page pair");
        let expected_page = r#"export interface DashboardUIProps {
  title: string;
  description: string;
}

export function DashboardUI(props: DashboardUIProps) {
  return (
    <main className="srijika-page">
      <section>
        <p>New Srijika page</p>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </section>
    </main>
  );
}
"#;
        let expected_page_connector = r#"import { DashboardUI } from './Dashboard.ui';

export function DashboardConnector() {
  return (
    <DashboardUI
      title="Dashboard"
      description="Start building this page in Dashboard.ui.tsx."
    />
  );
}
"#;
        assert_eq!(page.source, expected_page);
        assert_eq!(page.bytes, expected_page.len() as u64);
        assert_eq!(page.hash, super::source_hash(expected_page));
        assert_eq!(page.kind, CodeProjectUiSourceKind::Page);
        assert_eq!(page.relative_path, "src/pages/Dashboard.ui.tsx");
        assert_eq!(
            fs::read_to_string(page.connector_path.as_ref().expect("page connector path"))
                .expect("read page connector"),
            expected_page_connector
        );

        let component_error = core
            .create_code_project_ui_source(CreateCodeProjectUiSourceRequest {
                project_path: project.to_string_lossy().into_owned(),
                relative_path: "src/components/ProfileCard.ui.tsx".to_owned(),
                kind: CodeProjectUiSourceKind::Component,
                component_name: "ProfileCard".to_owned(),
                create_connector: true,
            })
            .expect_err("legacy standalone component root must fail");
        assert_eq!(component_error.code(), "invalid_project");
        assert!(!project.join("src/components/ProfileCard.ui.tsx").exists());

        let missing_connector = core
            .create_code_project_ui_source(CreateCodeProjectUiSourceRequest {
                project_path: project.to_string_lossy().into_owned(),
                relative_path: "src/pages/StatusBadge.ui.tsx".to_owned(),
                kind: CodeProjectUiSourceKind::Page,
                component_name: "StatusBadge".to_owned(),
                create_connector: false,
            })
            .expect_err("page without Connector must fail");
        assert_eq!(missing_connector.code(), "invalid_project");
        assert!(!project.join("src/pages/StatusBadge.ui.tsx").exists());
    }

    #[test]
    fn scaffolds_canonical_feature_slot_hook_store_and_part_capabilities() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("structured-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        write_feature_ui(&project, "Home", "home");
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        for (capability, role, relative_path) in [
            (
                CodeProjectScaffoldCapability::FeatureConnector,
                CodeProjectScaffoldFileRole::FeatureConnector,
                "src/features/home/Home.connector.tsx",
            ),
            (
                CodeProjectScaffoldCapability::FeatureStore,
                CodeProjectScaffoldFileRole::FeatureStore,
                "src/features/home/home.store.ts",
            ),
            (
                CodeProjectScaffoldCapability::FeatureBehaviorHook {
                    hook_name: "useHomeAnalytics".to_owned(),
                },
                CodeProjectScaffoldFileRole::FeatureHook,
                "src/features/home/hooks/useHomeAnalytics.ts",
            ),
        ] {
            let created = core
                .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                    project_path: project_path.clone(),
                    feature_name: "Home".to_owned(),
                    capability,
                })
                .expect("scaffold feature capability");
            assert_eq!(created.feature_path, "src/features/home");
            assert_eq!(created.files.len(), 1);
            assert_eq!(created.files[0].role, role);
            assert_eq!(created.files[0].relative_path, relative_path);
            assert!(project.join(relative_path).is_file());
        }

        let connector = fs::read_to_string(project.join("src/features/home/Home.connector.tsx"))
            .expect("read feature connector");
        assert!(connector.contains("ComponentProps<typeof HomeUI>"));
        assert!(connector.contains("return <HomeUI {...props} />;"));
        let store = fs::read_to_string(project.join("src/features/home/home.store.ts"))
            .expect("read feature store");
        assert!(store.contains("import { create } from 'zustand';"));
        assert!(store.contains("export const useHomeStore"));

        let slot_capability = CodeProjectScaffoldCapability::Slot {
            slot_name: "Navigation".to_owned(),
            create_connector: true,
            create_hook: false,
            create_store: true,
            create_logic: false,
            create_api: false,
            create_types: false,
            hook_name: Some("useNavigationKeyboard".to_owned()),
            part_name: Some("NavItem".to_owned()),
            create_part_connector: true,
        };
        let slot = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Home".to_owned(),
                capability: slot_capability.clone(),
            })
            .expect("scaffold complete slot");
        assert_eq!(slot.capability, slot_capability);
        assert_eq!(
            slot.files
                .iter()
                .map(|file| (file.role, file.relative_path.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (
                    CodeProjectScaffoldFileRole::SlotUi,
                    "src/features/home/slots/navigation/Navigation.ui.tsx",
                ),
                (
                    CodeProjectScaffoldFileRole::SlotConnector,
                    "src/features/home/slots/navigation/Navigation.connector.tsx",
                ),
                (
                    CodeProjectScaffoldFileRole::SlotStore,
                    "src/features/home/slots/navigation/navigation.store.ts",
                ),
                (
                    CodeProjectScaffoldFileRole::SlotHook,
                    "src/features/home/slots/navigation/hooks/useNavigationKeyboard.ts",
                ),
                (
                    CodeProjectScaffoldFileRole::PartUi,
                    "src/features/home/slots/navigation/parts/nav-item/NavItem.ui.tsx",
                ),
                (
                    CodeProjectScaffoldFileRole::PartConnector,
                    "src/features/home/slots/navigation/parts/nav-item/NavItem.connector.tsx",
                ),
            ]
        );
        assert_eq!(
            serde_json::to_value(&slot.capability).expect("serialize capability"),
            json!({
                "kind": "slot",
                "slotName": "Navigation",
                "createConnector": true,
                "createHook": false,
                "createStore": true,
                "createLogic": false,
                "createApi": false,
                "createTypes": false,
                "hookName": "useNavigationKeyboard",
                "partName": "NavItem",
                "createPartConnector": true
            })
        );

        let slot_hook = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Home".to_owned(),
                capability: CodeProjectScaffoldCapability::SlotBehaviorHook {
                    slot_name: "Navigation".to_owned(),
                    hook_name: "useNavigationSearch".to_owned(),
                },
            })
            .expect("add slot hook");
        assert_eq!(
            slot_hook.files[0].relative_path,
            "src/features/home/slots/navigation/hooks/useNavigationSearch.ts"
        );

        let part = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path,
                feature_name: "Home".to_owned(),
                capability: CodeProjectScaffoldCapability::Part {
                    slot_name: "Navigation".to_owned(),
                    part_name: "UserMenu".to_owned(),
                    create_connector: true,
                    create_hook: false,
                    create_store: false,
                    create_logic: false,
                    create_api: false,
                    create_types: false,
                    hook_name: None,
                },
            })
            .expect("add required part pair");
        assert_eq!(part.files.len(), 2);
        assert_eq!(part.files[0].role, CodeProjectScaffoldFileRole::PartUi);
        assert_eq!(
            part.files[1].role,
            CodeProjectScaffoldFileRole::PartConnector
        );
        assert!(
            project
                .join("src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx")
                .is_file()
        );
    }

    #[test]
    fn scaffolds_new_features_and_standalone_multword_owner_capabilities() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("new-feature-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        let feature = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "AdminPanel".to_owned(),
                capability: CodeProjectScaffoldCapability::Feature {
                    create_connector: true,
                    create_hook: false,
                    create_store: true,
                    create_logic: false,
                    create_api: false,
                    create_types: false,
                    hook_name: Some("useAdminPanelAccess".to_owned()),
                },
            })
            .expect("create complete feature");
        assert_eq!(feature.feature_path, "src/features/admin-panel");
        assert_eq!(
            feature
                .files
                .iter()
                .map(|file| (file.role, file.relative_path.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (
                    CodeProjectScaffoldFileRole::FeatureUi,
                    "src/features/admin-panel/AdminPanel.ui.tsx",
                ),
                (
                    CodeProjectScaffoldFileRole::FeatureConnector,
                    "src/features/admin-panel/AdminPanel.connector.tsx",
                ),
                (
                    CodeProjectScaffoldFileRole::FeatureStore,
                    "src/features/admin-panel/adminPanel.store.ts",
                ),
                (
                    CodeProjectScaffoldFileRole::FeatureHook,
                    "src/features/admin-panel/hooks/useAdminPanelAccess.ts",
                ),
            ]
        );
        assert!(
            fs::read_to_string(project.join("src/features/admin-panel/AdminPanel.ui.tsx"))
                .expect("read feature UI")
                .contains("data-srijika-feature=\"AdminPanel\"")
        );

        let duplicate = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "AdminPanel".to_owned(),
                capability: CodeProjectScaffoldCapability::Feature {
                    create_connector: true,
                    create_hook: false,
                    create_store: false,
                    create_logic: false,
                    create_api: false,
                    create_types: false,
                    hook_name: None,
                },
            })
            .expect_err("feature UI must never be overwritten");
        assert_eq!(duplicate.code(), "project_file_exists");

        fs::create_dir_all(project.join("src/features/reports"))
            .expect("create partial feature directory");
        fs::write(
            project.join("src/features/reports/reports.store.ts"),
            "keep existing store\n",
        )
        .expect("write colliding optional feature file");
        let partial_feature = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Reports".to_owned(),
                capability: CodeProjectScaffoldCapability::Feature {
                    create_connector: true,
                    create_hook: false,
                    create_store: true,
                    create_logic: false,
                    create_api: false,
                    create_types: false,
                    hook_name: None,
                },
            })
            .expect_err("optional collision must prevent a partial feature");
        assert_eq!(partial_feature.code(), "project_file_exists");
        assert!(!project.join("src/features/reports/Reports.ui.tsx").exists());
        assert!(
            !project
                .join("src/features/reports/Reports.connector.tsx")
                .exists()
        );

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "AdminPanel".to_owned(),
            capability: CodeProjectScaffoldCapability::Slot {
                slot_name: "UserNavigation".to_owned(),
                create_connector: true,
                create_hook: false,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
                hook_name: None,
                part_name: None,
                create_part_connector: false,
            },
        })
        .expect("create required slot pair");
        let created = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "AdminPanel".to_owned(),
                capability: CodeProjectScaffoldCapability::SlotStore {
                    slot_name: "UserNavigation".to_owned(),
                },
            })
            .expect("create standalone slot companion");
        assert_eq!(
            created.files[0].role,
            CodeProjectScaffoldFileRole::SlotStore
        );
        assert_eq!(
            created.files[0].relative_path,
            "src/features/admin-panel/slots/user-navigation/userNavigation.store.ts"
        );

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "AdminPanel".to_owned(),
            capability: CodeProjectScaffoldCapability::Part {
                slot_name: "UserNavigation".to_owned(),
                part_name: "AccountMenu".to_owned(),
                create_connector: true,
                create_hook: false,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
                hook_name: None,
            },
        })
        .expect("create required part pair");
        for (capability, role, relative_path) in [
            (
                CodeProjectScaffoldCapability::PartStore {
                    slot_name: "UserNavigation".to_owned(),
                    part_name: "AccountMenu".to_owned(),
                },
                CodeProjectScaffoldFileRole::PartStore,
                "src/features/admin-panel/slots/user-navigation/parts/account-menu/accountMenu.store.ts",
            ),
            (
                CodeProjectScaffoldCapability::PartBehaviorHook {
                    slot_name: "UserNavigation".to_owned(),
                    part_name: "AccountMenu".to_owned(),
                    hook_name: "useAccountMenuKeyboard".to_owned(),
                },
                CodeProjectScaffoldFileRole::PartHook,
                "src/features/admin-panel/slots/user-navigation/parts/account-menu/hooks/useAccountMenuKeyboard.ts",
            ),
        ] {
            let created = core
                .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                    project_path: project_path.clone(),
                    feature_name: "AdminPanel".to_owned(),
                    capability,
                })
                .expect("create standalone part companion");
            assert_eq!(created.files[0].role, role);
            assert_eq!(created.files[0].relative_path, relative_path);
        }

        let missing_part = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path,
                feature_name: "AdminPanel".to_owned(),
                capability: CodeProjectScaffoldCapability::PartStore {
                    slot_name: "UserNavigation".to_owned(),
                    part_name: "MissingPart".to_owned(),
                },
            })
            .expect_err("part companion requires its canonical UI");
        assert!(matches!(
            missing_part.code(),
            "invalid_project" | "not_found"
        ));
    }

    #[test]
    fn scaffolds_a_complete_progressive_feature_chain_atomically() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("progressive-feature-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);

        let capability = CodeProjectScaffoldCapability::Feature {
            create_connector: true,
            create_hook: true,
            create_store: true,
            create_logic: true,
            create_api: true,
            create_types: true,
            hook_name: None,
        };
        let created = StudioCore::default()
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project.to_string_lossy().into_owned(),
                feature_name: "SalesDashboard".to_owned(),
                capability: capability.clone(),
            })
            .expect("create progressive feature");

        assert_eq!(
            created
                .files
                .iter()
                .map(|file| (file.role, file.relative_path.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (
                    CodeProjectScaffoldFileRole::FeatureUi,
                    "src/features/sales-dashboard/SalesDashboard.ui.tsx",
                ),
                (
                    CodeProjectScaffoldFileRole::FeatureConnector,
                    "src/features/sales-dashboard/SalesDashboard.connector.tsx",
                ),
                (
                    CodeProjectScaffoldFileRole::FeatureHook,
                    "src/features/sales-dashboard/useSalesDashboard.ts",
                ),
                (
                    CodeProjectScaffoldFileRole::FeatureStore,
                    "src/features/sales-dashboard/salesDashboard.store.ts",
                ),
                (
                    CodeProjectScaffoldFileRole::FeatureLogic,
                    "src/features/sales-dashboard/salesDashboard.logic.ts",
                ),
                (
                    CodeProjectScaffoldFileRole::FeatureApi,
                    "src/features/sales-dashboard/salesDashboard.api.ts",
                ),
                (
                    CodeProjectScaffoldFileRole::FeatureTypes,
                    "src/features/sales-dashboard/salesDashboard.types.ts",
                ),
            ]
        );
        assert_eq!(created.capability, capability);
        assert_eq!(
            serde_json::to_value(&created.capability).expect("serialize capability"),
            json!({
                "kind": "feature",
                "createConnector": true,
                "createHook": true,
                "createStore": true,
                "createLogic": true,
                "createApi": true,
                "createTypes": true,
                "hookName": null,
            })
        );

        let root = project.join("src/features/sales-dashboard");
        assert!(
            fs::read_to_string(root.join("SalesDashboard.connector.tsx"))
                .unwrap()
                .contains("import { useSalesDashboard } from './useSalesDashboard';")
        );
        assert!(
            fs::read_to_string(root.join("useSalesDashboard.ts"))
                .unwrap()
                .contains("useSalesDashboardStore")
        );
        assert!(
            fs::read_to_string(root.join("salesDashboard.store.ts"))
                .unwrap()
                .contains("runSalesDashboardLogic")
        );
        assert!(
            fs::read_to_string(root.join("salesDashboard.logic.ts"))
                .unwrap()
                .contains("loadSalesDashboardFromApi")
        );
        assert!(
            fs::read_to_string(root.join("salesDashboard.api.ts"))
                .unwrap()
                .contains("HTTP transport and response parsing")
        );
        assert!(
            fs::read_to_string(root.join("salesDashboard.types.ts"))
                .unwrap()
                .contains("export interface SalesDashboardData")
        );
    }

    #[test]
    fn scaffolds_complete_progressive_slot_and_part_chains_in_their_owner_roots() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("progressive-owner-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        write_feature_ui(&project, "Dashboard", "dashboard");
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        let slot = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Dashboard".to_owned(),
                capability: CodeProjectScaffoldCapability::Slot {
                    slot_name: "SummaryPanel".to_owned(),
                    create_connector: true,
                    create_hook: true,
                    create_store: true,
                    create_logic: true,
                    create_api: true,
                    create_types: true,
                    hook_name: None,
                    part_name: None,
                    create_part_connector: false,
                },
            })
            .expect("create progressive slot");
        assert_eq!(slot.files.len(), 7);
        assert_eq!(
            slot.files[2].relative_path,
            "src/features/dashboard/slots/summary-panel/useSummaryPanel.ts"
        );
        assert_eq!(slot.files[4].role, CodeProjectScaffoldFileRole::SlotLogic);
        assert_eq!(slot.files[5].role, CodeProjectScaffoldFileRole::SlotApi);
        assert_eq!(slot.files[6].role, CodeProjectScaffoldFileRole::SlotTypes);

        let part = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path,
                feature_name: "Dashboard".to_owned(),
                capability: CodeProjectScaffoldCapability::Part {
                    slot_name: "SummaryPanel".to_owned(),
                    part_name: "MetricCard".to_owned(),
                    create_connector: true,
                    create_hook: true,
                    create_store: true,
                    create_logic: true,
                    create_api: true,
                    create_types: true,
                    hook_name: None,
                },
            })
            .expect("create progressive part");
        let part_root =
            project.join("src/features/dashboard/slots/summary-panel/parts/metric-card");
        assert_eq!(part.files.len(), 7);
        assert_eq!(part.files[2].role, CodeProjectScaffoldFileRole::PartHook);
        assert_eq!(
            part.files[2].relative_path,
            "src/features/dashboard/slots/summary-panel/parts/metric-card/useMetricCard.ts"
        );
        assert!(
            fs::read_to_string(part_root.join("MetricCard.connector.tsx"))
                .unwrap()
                .contains("useMetricCard")
        );
        assert!(
            fs::read_to_string(part_root.join("useMetricCard.ts"))
                .unwrap()
                .contains("useMetricCardStore")
        );
        assert!(
            fs::read_to_string(part_root.join("metricCard.store.ts"))
                .unwrap()
                .contains("runMetricCardLogic")
        );
        assert!(
            fs::read_to_string(part_root.join("metricCard.logic.ts"))
                .unwrap()
                .contains("loadMetricCardFromApi")
        );
    }

    #[test]
    fn standalone_capabilities_follow_existing_junior_layers() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("standalone-progressive-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        write_feature_ui(&project, "Dashboard", "dashboard");
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        for capability in [
            CodeProjectScaffoldCapability::FeatureApi,
            CodeProjectScaffoldCapability::FeatureLogic,
            CodeProjectScaffoldCapability::FeatureStore,
            CodeProjectScaffoldCapability::FeatureHook,
            CodeProjectScaffoldCapability::FeatureConnector,
            CodeProjectScaffoldCapability::FeatureTypes,
        ] {
            core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Dashboard".to_owned(),
                capability,
            })
            .expect("add standalone progressive capability");
        }

        let root = project.join("src/features/dashboard");
        assert!(
            fs::read_to_string(root.join("Dashboard.connector.tsx"))
                .unwrap()
                .contains("useDashboard")
        );
        assert!(
            fs::read_to_string(root.join("useDashboard.ts"))
                .unwrap()
                .contains("useDashboardStore")
        );
        assert!(
            fs::read_to_string(root.join("dashboard.store.ts"))
                .unwrap()
                .contains("runDashboardLogic")
        );
        assert!(
            fs::read_to_string(root.join("dashboard.logic.ts"))
                .unwrap()
                .contains("loadDashboardFromApi")
        );
    }

    #[test]
    fn progressive_optional_file_collision_rolls_back_the_entire_owner() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("progressive-collision-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        fs::create_dir_all(project.join("src/features/dashboard"))
            .expect("create feature directory");
        fs::write(
            project.join("src/features/dashboard/DASHBOARD.API.TS"),
            "keep existing API",
        )
        .expect("write portable API collision");

        let error = StudioCore::default()
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project.to_string_lossy().into_owned(),
                feature_name: "Dashboard".to_owned(),
                capability: CodeProjectScaffoldCapability::Feature {
                    create_connector: true,
                    create_hook: true,
                    create_store: true,
                    create_logic: true,
                    create_api: true,
                    create_types: true,
                    hook_name: None,
                },
            })
            .expect_err("API collision must reject every planned owner file");

        assert_eq!(error.code(), "project_file_exists");
        assert_eq!(
            fs::read_to_string(project.join("src/features/dashboard/DASHBOARD.API.TS")).unwrap(),
            "keep existing API"
        );
        for relative in [
            "Dashboard.ui.tsx",
            "Dashboard.connector.tsx",
            "useDashboard.ts",
            "dashboard.store.ts",
            "dashboard.logic.ts",
            "dashboard.types.ts",
        ] {
            assert!(
                !project
                    .join("src/features/dashboard")
                    .join(relative)
                    .exists()
            );
        }
    }

    #[test]
    fn progressive_capability_request_variants_deserialize_from_the_public_contract() {
        let feature: ScaffoldCodeProjectStructureRequest = serde_json::from_value(json!({
            "projectPath": "/tmp/project",
            "featureName": "Dashboard",
            "capability": {
                "kind": "feature",
                "createConnector": true,
                "createHook": true,
                "createStore": true,
                "createLogic": true,
                "createApi": true,
                "createTypes": true
            }
        }))
        .expect("deserialize complete feature request");
        assert_eq!(
            feature.capability,
            CodeProjectScaffoldCapability::Feature {
                create_connector: true,
                create_hook: true,
                create_store: true,
                create_logic: true,
                create_api: true,
                create_types: true,
                hook_name: None,
            }
        );

        for (value, expected) in [
            (
                json!({ "kind": "featureHook" }),
                CodeProjectScaffoldCapability::FeatureHook,
            ),
            (
                json!({ "kind": "slotLogic", "slotName": "Summary" }),
                CodeProjectScaffoldCapability::SlotLogic {
                    slot_name: "Summary".to_owned(),
                },
            ),
            (
                json!({
                    "kind": "partApi",
                    "slotName": "Summary",
                    "partName": "MetricCard"
                }),
                CodeProjectScaffoldCapability::PartApi {
                    slot_name: "Summary".to_owned(),
                    part_name: "MetricCard".to_owned(),
                },
            ),
            (
                json!({
                    "kind": "featureBehaviorHook",
                    "hookName": "useDashboardKeyboard"
                }),
                CodeProjectScaffoldCapability::FeatureBehaviorHook {
                    hook_name: "useDashboardKeyboard".to_owned(),
                },
            ),
        ] {
            let parsed: CodeProjectScaffoldCapability =
                serde_json::from_value(value).expect("deserialize capability variant");
            assert_eq!(parsed, expected);
        }
    }

    #[test]
    fn structure_scaffolding_rejects_non_normalized_pascal_case_without_writing_files() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("canonical-name-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);

        let error = StudioCore::default()
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project.to_string_lossy().into_owned(),
                feature_name: "APIClient".to_owned(),
                capability: CodeProjectScaffoldCapability::Feature {
                    create_connector: true,
                    create_hook: false,
                    create_store: true,
                    create_logic: false,
                    create_api: false,
                    create_types: false,
                    hook_name: None,
                },
            })
            .expect_err("acronym-style names must be normalized before scaffolding");

        assert_eq!(error.code(), "invalid_project");
        assert!(error.to_string().contains("ApiClient"));
        assert!(!project.join("src/features/api-client").exists());
    }

    #[test]
    fn structure_scaffolding_is_no_overwrite_atomic_and_scope_coherent() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("guarded-structure-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        write_feature_ui(&project, "Home", "home");
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        fs::create_dir_all(project.join("src/features/home/slots/navigation"))
            .expect("create slot directory");
        fs::write(
            project.join("src/features/home/slots/navigation/NAVIGATION.STORE.TS"),
            "keep existing store",
        )
        .expect("write portable collision");
        let collision = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Home".to_owned(),
                capability: CodeProjectScaffoldCapability::Slot {
                    slot_name: "Navigation".to_owned(),
                    create_connector: true,
                    create_hook: false,
                    create_store: true,
                    create_logic: false,
                    create_api: false,
                    create_types: false,
                    hook_name: None,
                    part_name: None,
                    create_part_connector: false,
                },
            })
            .expect_err("case-only store collision must refuse the whole slot");
        assert_eq!(collision.code(), "project_file_exists");
        assert!(
            !project
                .join("src/features/home/slots/navigation/Navigation.ui.tsx")
                .exists()
        );
        assert_eq!(
            fs::read_to_string(
                project.join("src/features/home/slots/navigation/NAVIGATION.STORE.TS")
            )
            .unwrap(),
            "keep existing store"
        );

        for capability in [
            CodeProjectScaffoldCapability::FeatureBehaviorHook {
                hook_name: "useNavigationKeyboard".to_owned(),
            },
            CodeProjectScaffoldCapability::Slot {
                slot_name: "Hero".to_owned(),
                create_connector: false,
                create_hook: false,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
                hook_name: Some("useHeaderScroll".to_owned()),
                part_name: None,
                create_part_connector: false,
            },
            CodeProjectScaffoldCapability::Slot {
                slot_name: "Hero".to_owned(),
                create_connector: false,
                create_hook: false,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
                hook_name: None,
                part_name: None,
                create_part_connector: true,
            },
            CodeProjectScaffoldCapability::SlotBehaviorHook {
                slot_name: "Missing".to_owned(),
                hook_name: "useMissingKeyboard".to_owned(),
            },
        ] {
            let error = core
                .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                    project_path: project_path.clone(),
                    feature_name: "Home".to_owned(),
                    capability,
                })
                .expect_err("incoherent capability must fail");
            assert!(matches!(error.code(), "invalid_project" | "not_found"));
        }

        let missing_feature = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path,
                feature_name: "Dashboard".to_owned(),
                capability: CodeProjectScaffoldCapability::FeatureStore,
            })
            .expect_err("feature capability requires its canonical UI");
        assert_eq!(missing_feature.code(), "not_found");
    }

    #[cfg(unix)]
    #[test]
    fn structure_scaffolding_rejects_symlinked_scope_ancestors() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("symlinked-structure-project");
        let outside = directory.path().join("outside");
        fs::create_dir(&project).expect("create project");
        fs::create_dir(&outside).expect("create outside directory");
        write_code_project(&project, false, false);
        write_feature_ui(&project, "Home", "home");
        symlink(&outside, project.join("src/features/home/slots")).expect("create slot symlink");

        let error = StudioCore::default()
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project.to_string_lossy().into_owned(),
                feature_name: "Home".to_owned(),
                capability: CodeProjectScaffoldCapability::Slot {
                    slot_name: "Navigation".to_owned(),
                    create_connector: true,
                    create_hook: false,
                    create_store: true,
                    create_logic: false,
                    create_api: false,
                    create_types: false,
                    hook_name: None,
                    part_name: None,
                    create_part_connector: false,
                },
            })
            .expect_err("symlinked slot root must fail");
        assert_eq!(error.code(), "invalid_project");
        assert!(outside.read_dir().expect("read outside").next().is_none());
    }

    #[test]
    fn new_ui_creation_refuses_both_targets_and_portable_case_collisions() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("collision-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        fs::create_dir_all(project.join("src/pages")).expect("create pages");
        let core = StudioCore::default();

        fs::write(project.join("src/pages/Account.ui.tsx"), "keep ui").expect("write existing UI");
        let ui_collision = core
            .create_code_project_ui_source(CreateCodeProjectUiSourceRequest {
                project_path: project.to_string_lossy().into_owned(),
                relative_path: "src/pages/Account.ui.tsx".to_owned(),
                kind: CodeProjectUiSourceKind::Page,
                component_name: "Account".to_owned(),
                create_connector: true,
            })
            .expect_err("existing UI must not be overwritten");
        assert_eq!(ui_collision.code(), "project_file_exists");
        assert_eq!(
            fs::read_to_string(project.join("src/pages/Account.ui.tsx")).unwrap(),
            "keep ui"
        );
        assert!(!project.join("src/pages/Account.connector.tsx").exists());

        fs::write(
            project.join("src/pages/Settings.connector.tsx"),
            "keep connector",
        )
        .expect("write existing connector");
        let connector_collision = core
            .create_code_project_ui_source(CreateCodeProjectUiSourceRequest {
                project_path: project.to_string_lossy().into_owned(),
                relative_path: "src/pages/Settings.ui.tsx".to_owned(),
                kind: CodeProjectUiSourceKind::Page,
                component_name: "Settings".to_owned(),
                create_connector: true,
            })
            .expect_err("existing connector must prevent a partial pair");
        assert_eq!(connector_collision.code(), "project_file_exists");
        assert!(!project.join("src/pages/Settings.ui.tsx").exists());
        assert_eq!(
            fs::read_to_string(project.join("src/pages/Settings.connector.tsx")).unwrap(),
            "keep connector"
        );

        fs::write(project.join("src/pages/PORTABLE.UI.TSX"), "keep portable")
            .expect("write portable case collision");
        let portable_collision = core
            .create_code_project_ui_source(CreateCodeProjectUiSourceRequest {
                project_path: project.to_string_lossy().into_owned(),
                relative_path: "src/pages/Portable.ui.tsx".to_owned(),
                kind: CodeProjectUiSourceKind::Page,
                component_name: "Portable".to_owned(),
                create_connector: true,
            })
            .expect_err("case-only sibling collision must be portable");
        assert_eq!(portable_collision.code(), "project_file_exists");
        assert!(!project.join("src/pages/Portable.ui.tsx").exists());
        assert!(!project.join("src/pages/Portable.connector.tsx").exists());

        fs::write(
            project.join("src/pages/TOOLBAR.CONNECTOR.TSX"),
            "keep portable connector",
        )
        .expect("write portable connector collision");
        let portable_connector_collision = core
            .create_code_project_ui_source(CreateCodeProjectUiSourceRequest {
                project_path: project.to_string_lossy().into_owned(),
                relative_path: "src/pages/Toolbar.ui.tsx".to_owned(),
                kind: CodeProjectUiSourceKind::Page,
                component_name: "Toolbar".to_owned(),
                create_connector: true,
            })
            .expect_err("case-only connector collision must be portable");
        assert_eq!(portable_connector_collision.code(), "project_file_exists");
        assert!(!project.join("src/pages/Toolbar.ui.tsx").exists());
        assert!(!project.join("src/pages/Toolbar.connector.tsx").exists());
    }

    #[test]
    fn new_ui_creation_rejects_invalid_names_paths_and_symlink_ancestors() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("validated-source-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();

        for (name, path) in [
            ("profile", "src/pages/profile.ui.tsx"),
            ("Bad-Name", "src/pages/Bad-Name.ui.tsx"),
            ("Mismatch", "src/pages/Other.ui.tsx"),
            ("Escape", "../Escape.ui.tsx"),
            ("Outside", "public/Outside.ui.tsx"),
            ("AuditCard", "src/features/home/AuditCard.ui.tsx"),
        ] {
            let error = core
                .create_code_project_ui_source(CreateCodeProjectUiSourceRequest {
                    project_path: project.to_string_lossy().into_owned(),
                    relative_path: path.to_owned(),
                    kind: CodeProjectUiSourceKind::Page,
                    component_name: name.to_owned(),
                    create_connector: true,
                })
                .expect_err("invalid name/path must fail");
            assert_eq!(error.code(), "invalid_project", "{name}: {path}");
        }

        #[cfg(unix)]
        {
            let outside = directory.path().join("outside");
            fs::create_dir(&outside).expect("create outside directory");
            fs::create_dir_all(project.join("src/pages")).expect("create pages");
            symlink(&outside, project.join("src/pages/linked")).expect("create source symlink");
            let linked = core
                .create_code_project_ui_source(CreateCodeProjectUiSourceRequest {
                    project_path: project.to_string_lossy().into_owned(),
                    relative_path: "src/pages/linked/Escape.ui.tsx".to_owned(),
                    kind: CodeProjectUiSourceKind::Page,
                    component_name: "Escape".to_owned(),
                    create_connector: true,
                })
                .expect_err("symlink ancestor must fail");
            assert_eq!(linked.code(), "invalid_project");
            assert!(!outside.join("Escape.ui.tsx").exists());
            assert!(!outside.join("Escape.connector.tsx").exists());
        }
    }

    #[test]
    fn code_project_creation_refuses_existing_targets_and_escaping_files() {
        let directory = tempdir().expect("temporary directory");
        let core = StudioCore::default();
        let existing = core
            .create_code_project(CreateCodeProjectRequest {
                path: directory.path().to_string_lossy().into_owned(),
                entry_source: "Home.ui.tsx".to_owned(),
                files: vec![CodeProjectFile {
                    path: "Home.ui.tsx".to_owned(),
                    contents: "export function Home() { return <main />; }".to_owned(),
                }],
            })
            .expect_err("existing target must not be overwritten");
        assert_eq!(existing.code(), "project_exists");

        let escaping = core
            .create_code_project(CreateCodeProjectRequest {
                path: directory
                    .path()
                    .join("new-project")
                    .to_string_lossy()
                    .into_owned(),
                entry_source: "Home.ui.tsx".to_owned(),
                files: vec![CodeProjectFile {
                    path: "../Home.ui.tsx".to_owned(),
                    contents: String::new(),
                }],
            })
            .expect_err("escaping file must fail");
        assert_eq!(escaping.code(), "invalid_project");
        assert!(!directory.path().join("new-project").exists());
    }

    #[test]
    fn code_project_creation_requires_config_to_match_the_returned_entry() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("mismatched-project");
        let error = StudioCore::default()
            .create_code_project(CreateCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
                entry_source: "src/Home.ui.tsx".to_owned(),
                files: vec![
                    CodeProjectFile {
                        path: "src/Home.ui.tsx".to_owned(),
                        contents: "export function Home() { return <main />; }".to_owned(),
                    },
                    CodeProjectFile {
                        path: "srijika.config.json".to_owned(),
                        contents: r#"{"sourceOfTruth":"tsx","entry":"src/Other.ui.tsx"}"#
                            .to_owned(),
                    },
                ],
            })
            .expect_err("generated entry and project config must agree");

        assert_eq!(error.code(), "invalid_project");
        assert!(!project.exists());
    }

    #[test]
    fn opening_a_code_project_rejects_invalid_or_escaping_configuration() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("existing-project");
        fs::create_dir(&project).expect("create project directory");
        fs::write(project.join("srijika.config.json"), "{not-json").expect("write invalid config");
        let core = StudioCore::default();

        let invalid = core
            .open_code_project(OpenCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect_err("invalid config must fail");
        assert_eq!(invalid.code(), "invalid_project");

        fs::write(
            project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"../Outside.ui.tsx"}"#,
        )
        .expect("write escaping config");
        let escaping = core
            .open_code_project(OpenCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect_err("escaping entry must fail");
        assert_eq!(escaping.code(), "invalid_project");
    }

    #[test]
    fn loads_configured_preview_styles_in_order_and_falls_back_to_src_styles() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("styled-project");
        fs::create_dir(&project).expect("create project directory");
        write_code_project(&project, false, false);
        fs::write(
            project.join("src/styles.css"),
            ":root { --brand: #7657ff; }\n",
        )
        .expect("write fallback stylesheet");
        fs::create_dir_all(project.join("public")).expect("create public directory");
        fs::write(
            project.join("public/srijika-mark.svg"),
            "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n",
        )
        .expect("write preview asset");
        let core = StudioCore::default();
        let request = LoadCodeProjectPreviewStylesRequest {
            path: project.to_string_lossy().into_owned(),
        };

        let fallback = core
            .load_code_project_preview_styles(request.clone())
            .expect("load fallback stylesheet");
        assert_eq!(fallback.stylesheets.len(), 1);
        assert!(fallback.design_props.is_empty());
        assert_eq!(fallback.assets.len(), 1);
        assert_eq!(fallback.assets[0].public_path, "/srijika-mark.svg");
        assert_eq!(fallback.stylesheets[0].relative_path, "src/styles.css");
        assert_eq!(
            fallback.stylesheets[0].source,
            ":root { --brand: #7657ff; }\n"
        );

        fs::create_dir_all(project.join("src/theme")).expect("create theme directory");
        fs::write(project.join("src/theme/base.css"), "body { margin: 0; }\n")
            .expect("write base stylesheet");
        fs::write(
            project.join("src/theme/page.css"),
            ".hero { display: grid; }\n",
        )
        .expect("write page stylesheet");
        fs::write(
            project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Home.ui.tsx","preview":{"styles":["src/theme/base.css","src/theme/page.css"],"props":{"pageClassName":"theme-page"}}}"#,
        )
        .expect("write configured styles");

        let configured = core
            .load_code_project_preview_styles(request.clone())
            .expect("load configured stylesheets");
        assert_eq!(
            configured
                .stylesheets
                .iter()
                .map(|stylesheet| stylesheet.relative_path.as_str())
                .collect::<Vec<_>>(),
            ["src/theme/base.css", "src/theme/page.css"]
        );
        assert_eq!(
            configured.stylesheets[1].source,
            ".hero { display: grid; }\n"
        );
        assert_ne!(
            configured.stylesheets[0].hash,
            configured.stylesheets[1].hash
        );
        assert_eq!(
            configured.design_props.get("pageClassName"),
            Some(&Value::String("theme-page".to_owned()))
        );

        fs::write(
            project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Home.ui.tsx","preview":{"styles":["../outside.css"]}}"#,
        )
        .expect("write escaping style config");
        let escaping = core
            .load_code_project_preview_styles(request)
            .expect_err("escaping preview stylesheet must fail");
        assert_eq!(escaping.code(), "invalid_project");
    }

    #[test]
    fn scans_a_deterministic_bounded_project_tree_and_ignores_generated_content() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("tree-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, true, true);
        fs::create_dir_all(project.join("src/components")).expect("create component directory");
        fs::write(
            project.join("src/components/Profile.ui.tsx"),
            "export function Profile() { return <aside>Profile</aside>; }\n",
        )
        .expect("write component");
        fs::write(project.join("src/z-last.ts"), "export {};\n").expect("write source");
        for ignored in [".git", "node_modules", "dist", "build"] {
            fs::create_dir(project.join(ignored)).expect("create ignored directory");
            fs::write(project.join(ignored).join("hidden.ts"), "hidden").expect("write ignored");
        }
        fs::create_dir_all(project.join("zz-nested-project/src"))
            .expect("create nested project source");
        fs::write(
            project.join("zz-nested-project/srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Nested.ui.tsx"}"#,
        )
        .expect("write nested project config");
        fs::write(
            project.join("zz-nested-project/src/Nested.ui.tsx"),
            "export function NestedUI() { return <main />; }\n",
        )
        .expect("write nested project UI");
        #[cfg(unix)]
        {
            let outside = directory.path().join("outside.ui.tsx");
            fs::write(&outside, "outside").expect("write outside source");
            symlink(outside, project.join("src/Escape.ui.tsx")).expect("create source symlink");
        }

        let core = StudioCore::default();
        let first = core
            .scan_code_project(ScanCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("scan project");
        let second = core
            .scan_code_project(ScanCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("scan project again");
        let first_paths = first
            .entries
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect::<Vec<_>>();
        let second_paths = second
            .entries
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(first_paths, second_paths);
        assert_eq!(first_paths.first(), Some(&"src"));
        assert!(first_paths.contains(&"src/components/Profile.ui.tsx"));
        assert!(first_paths.contains(&"zz-nested-project"));
        assert!(
            !first_paths
                .iter()
                .any(|path| path.starts_with("zz-nested-project/"))
        );
        assert!(
            !first_paths
                .iter()
                .any(|path| path.contains("node_modules") || path.contains("hidden.ts"))
        );
        assert!(
            !first_paths
                .iter()
                .any(|path| path.ends_with("Escape.ui.tsx"))
        );
        let profile = first
            .entries
            .iter()
            .find(|entry| entry.relative_path == "src/components/Profile.ui.tsx")
            .expect("profile entry");
        assert!(profile.is_ui_source);
        assert!(
            profile
                .hash
                .as_deref()
                .is_some_and(|hash| hash.starts_with("fnv1a64:"))
        );
        assert!(!first.truncated);
    }

    #[test]
    fn loads_architecture_sources_deterministically_without_following_links_or_ignored_dirs() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("architecture-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        fs::create_dir_all(project.join("src/nested")).expect("create nested source directory");
        fs::write(project.join("src/a.ts"), "export const a = 1;\n").expect("write TS source");
        fs::write(
            project.join("src/nested/View.tsx"),
            "export function View() { return <section />; }\n",
        )
        .expect("write TSX source");
        fs::write(project.join("src/nested/module.mts"), "export {};\n").expect("write MTS source");
        fs::write(project.join("src/nested/module.cts"), "export {};\n").expect("write CTS source");
        fs::write(project.join("src/nested/notes.css"), ".ignored {}\n")
            .expect("write non-source file");
        fs::create_dir_all(project.join("zz-nested-project/src"))
            .expect("create nested project source");
        fs::write(
            project.join("zz-nested-project/srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Nested.ui.tsx"}"#,
        )
        .expect("write nested project config");
        fs::write(
            project.join("zz-nested-project/src/Nested.ui.tsx"),
            "export function NestedUI() { return <main />; }\n",
        )
        .expect("write nested project architecture source");
        fs::create_dir(project.join("node_modules")).expect("create ignored directory");
        fs::write(project.join("node_modules/hidden.ts"), "hidden\n")
            .expect("write ignored source");
        #[cfg(unix)]
        {
            let outside = directory.path().join("outside.ts");
            fs::write(&outside, "outside\n").expect("write outside source");
            symlink(outside, project.join("src/nested/Escape.ts"))
                .expect("create architecture source symlink");
        }

        let core = StudioCore::default();
        let request = LoadCodeProjectArchitectureSourcesRequest {
            path: project.to_string_lossy().into_owned(),
        };
        let first = core
            .load_code_project_architecture_sources(request.clone())
            .expect("load architecture sources");
        let second = core
            .load_code_project_architecture_sources(request)
            .expect("load architecture sources again");
        let paths = first
            .sources
            .iter()
            .map(|source| source.relative_path.clone())
            .collect::<Vec<_>>();
        let mut sorted_paths = paths.clone();
        sorted_paths.sort();

        assert_eq!(paths, sorted_paths);
        assert_eq!(first.sources, second.sources);
        assert!(first.config_source.contains(r#""sourceOfTruth":"tsx""#));
        assert!(paths.contains(&"src/Home.ui.tsx".to_owned()));
        assert!(paths.contains(&"src/a.ts".to_owned()));
        assert!(paths.contains(&"src/nested/View.tsx".to_owned()));
        assert!(paths.contains(&"src/nested/module.mts".to_owned()));
        assert!(paths.contains(&"src/nested/module.cts".to_owned()));
        assert!(!paths.iter().any(|path| path.contains("node_modules")));
        assert!(!paths.iter().any(|path| path.contains("zz-nested-project")));
        assert!(!paths.iter().any(|path| path.ends_with("Escape.ts")));
        assert!(!paths.iter().any(|path| path.ends_with("notes.css")));
        assert!(first.sources.iter().all(|source| {
            source.bytes == source.source.len() as u64 && source.hash.starts_with("fnv1a64:")
        }));
        assert!(!first.truncated);
    }

    #[test]
    fn architecture_source_reader_skips_per_file_and_combined_limit_overflow() {
        let directory = tempdir().expect("temporary directory");
        let oversized_project = directory.path().join("oversized-architecture-project");
        fs::create_dir(&oversized_project).expect("create oversized project");
        write_code_project(&oversized_project, false, false);
        fs::write(
            oversized_project.join("src/Oversized.ts"),
            vec![b'x'; MAX_ARCHITECTURE_SOURCE_BYTES as usize + 1],
        )
        .expect("write oversized architecture source");

        let oversized = StudioCore::default()
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: oversized_project.to_string_lossy().into_owned(),
            })
            .expect("load project with oversized source");
        assert!(oversized.truncated);
        assert!(
            !oversized
                .sources
                .iter()
                .any(|source| source.relative_path.ends_with("Oversized.ts"))
        );
        assert!(
            oversized
                .sources
                .iter()
                .any(|source| source.relative_path == "src/Home.ui.tsx")
        );

        let combined_project = directory.path().join("combined-architecture-project");
        fs::create_dir(&combined_project).expect("create combined project");
        write_code_project(&combined_project, false, false);
        let bounded_source = vec![b'x'; MAX_ARCHITECTURE_SOURCE_BYTES as usize];
        for index in 0..7 {
            fs::write(
                combined_project.join(format!("src/blob-{index:02}.ts")),
                &bounded_source,
            )
            .expect("write bounded architecture source");
        }
        let combined = StudioCore::default()
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: combined_project.to_string_lossy().into_owned(),
            })
            .expect("load project at combined bound");
        let combined_bytes = combined
            .sources
            .iter()
            .map(|source| source.bytes)
            .sum::<u64>();
        assert!(combined.truncated);
        assert!(combined_bytes <= MAX_ARCHITECTURE_SOURCES_BYTES);
        assert!(combined.sources.len() < 8);
    }

    #[cfg(unix)]
    #[test]
    fn architecture_source_reader_rejects_symlinked_roots_and_configs() {
        let directory = tempdir().expect("temporary directory");
        let real_project = directory.path().join("real-project");
        fs::create_dir(&real_project).expect("create real project");
        write_code_project(&real_project, false, false);
        let linked_project = directory.path().join("linked-project");
        symlink(&real_project, &linked_project).expect("create project root symlink");
        let core = StudioCore::default();

        let linked_root = core
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: linked_project.to_string_lossy().into_owned(),
            })
            .expect_err("symlinked project root must fail");
        assert_eq!(linked_root.code(), "invalid_project");

        let linked_config_project = directory.path().join("linked-config-project");
        fs::create_dir(&linked_config_project).expect("create linked config project");
        write_code_project(&linked_config_project, false, false);
        let outside_config = directory.path().join("outside-srijika.config.json");
        fs::write(
            &outside_config,
            r#"{"sourceOfTruth":"tsx","entry":"src/Home.ui.tsx"}"#,
        )
        .expect("write outside config");
        fs::remove_file(linked_config_project.join("srijika.config.json"))
            .expect("remove real config");
        symlink(
            &outside_config,
            linked_config_project.join("srijika.config.json"),
        )
        .expect("create config symlink");

        let linked_config = core
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: linked_config_project.to_string_lossy().into_owned(),
            })
            .expect_err("symlinked project config must fail");
        assert_eq!(linked_config.code(), "invalid_project");
    }

    #[test]
    fn project_tree_reports_truncation_at_the_depth_boundary() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("deep-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let mut nested = project.join("deep");
        for index in 0..=MAX_PROJECT_TREE_DEPTH {
            nested = nested.join(format!("level-{index:02}"));
        }
        fs::create_dir_all(&nested).expect("create deep tree");
        fs::write(nested.join("hidden.ts"), "export {};\n").expect("write deep file");

        let scan = StudioCore::default()
            .scan_code_project(ScanCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("scan deep project");
        assert!(scan.truncated);
        assert!(
            !scan
                .entries
                .iter()
                .any(|entry| entry.relative_path.ends_with("hidden.ts"))
        );
    }

    #[test]
    fn project_tree_caps_a_single_wide_directory_deterministically() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("wide-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        for index in 0..=MAX_PROJECT_TREE_ENTRIES {
            fs::write(project.join(format!("entry-{index:05}.ts")), "export {};\n")
                .expect("write wide project entry");
        }

        let scan = StudioCore::default()
            .scan_code_project(ScanCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("scan wide project");

        assert!(scan.truncated);
        assert_eq!(scan.entries.len(), MAX_PROJECT_TREE_ENTRIES);
        assert!(
            scan.entries
                .iter()
                .any(|entry| entry.relative_path == "entry-00000.ts")
        );
        assert!(
            !scan
                .entries
                .iter()
                .any(|entry| entry.relative_path == "entry-04096.ts")
        );
    }

    #[test]
    fn resolves_only_real_editor_targets_inside_the_project() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("editor-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();

        let root = core
            .resolve_project_editor_target(OpenInVsCodeRequest {
                project_path: project.to_string_lossy().into_owned(),
                relative_path: None,
                line: None,
                column: None,
            })
            .expect("resolve root");
        assert_eq!(
            root.target_path,
            fs::canonicalize(&project).unwrap().to_string_lossy()
        );
        assert_eq!(root.line, None);

        let source = core
            .resolve_project_editor_target(OpenInVsCodeRequest {
                project_path: project.to_string_lossy().into_owned(),
                relative_path: Some("src/Home.ui.tsx".to_owned()),
                line: Some(8),
                column: None,
            })
            .expect("resolve source location");
        assert_eq!(source.line, Some(8));
        assert_eq!(source.column, Some(1));

        let traversal = core
            .resolve_project_editor_target(OpenInVsCodeRequest {
                project_path: project.to_string_lossy().into_owned(),
                relative_path: Some("../outside.ts".to_owned()),
                line: None,
                column: None,
            })
            .expect_err("path traversal must fail");
        assert_eq!(traversal.code(), "invalid_project");

        #[cfg(unix)]
        {
            let outside = directory.path().join("outside.ts");
            fs::write(&outside, "outside").expect("write outside target");
            symlink(outside, project.join("src/link.ts")).expect("create editor symlink");
            let linked = core
                .resolve_project_editor_target(OpenInVsCodeRequest {
                    project_path: project.to_string_lossy().into_owned(),
                    relative_path: Some("src/link.ts".to_owned()),
                    line: None,
                    column: None,
                })
                .expect_err("symbolic-link target must fail");
            assert_eq!(linked.code(), "invalid_editor_target");
        }
    }

    #[test]
    fn reports_dependency_readiness_without_executing_the_project() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("runtime-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, true, false);
        let core = StudioCore::default();

        let missing_lockfile = core
            .get_project_runtime_status(ProjectRuntimeStatusRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("inspect status");
        assert_eq!(
            missing_lockfile.dependency_state,
            ProjectDependencyState::MissingLockfile
        );
        assert!(!missing_lockfile.lockfile_present);
        assert!(!missing_lockfile.dependencies_installed);

        fs::write(
            project.join("pnpm-lock.yaml"),
            "lockfileVersion: '9.0'\nsettings: {}\nimporters: {}\n",
        )
        .expect("write lockfile");
        let not_installed = core
            .get_project_runtime_status(ProjectRuntimeStatusRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("inspect uninstalled status");
        assert_eq!(
            not_installed.dependency_state,
            ProjectDependencyState::NotInstalled
        );
        assert!(not_installed.lockfile_present);
        assert!(!not_installed.dependencies_ready);

        fs::create_dir(project.join("node_modules")).expect("create node_modules");
        thread::sleep(Duration::from_millis(5));
        fs::write(
            project.join("node_modules/.modules.yaml"),
            "layoutVersion: 5\n",
        )
        .expect("write pnpm modules state");
        let ready = core
            .get_project_runtime_status(ProjectRuntimeStatusRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("inspect ready status");
        assert_eq!(ready.dependency_state, ProjectDependencyState::Ready);
        assert!(ready.dependencies_installed);
        assert!(ready.dependencies_ready);
        assert!(!ready.running);

        thread::sleep(Duration::from_millis(5));
        fs::write(
            project.join("package.json"),
            r#"{"name":"test-app","private":true,"scripts":{"dev":"vite","build":"vite build"}}"#,
        )
        .expect("update package manifest");
        let outdated = core
            .get_project_runtime_status(ProjectRuntimeStatusRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("inspect outdated status");
        assert_eq!(outdated.dependency_state, ProjectDependencyState::Outdated);
        assert!(outdated.dependencies_installed);
        assert!(!outdated.dependencies_ready);
    }

    #[test]
    fn lifecycle_commands_fail_safely_before_spawning_pnpm_when_prerequisites_are_missing() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("lifecycle-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, true, false);
        let core = StudioCore::default();

        let install = core
            .install_project_dependencies(ProjectTaskRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect_err("frozen install requires a lockfile");
        assert_eq!(install.code(), "missing_lockfile");

        fs::write(
            project.join("pnpm-lock.yaml"),
            "lockfileVersion: '9.0'\nsettings: {}\nimporters: {}\n",
        )
        .expect("write lockfile");
        let build = core
            .build_code_project(ProjectTaskRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect_err("build requires installed dependencies");
        assert_eq!(build.code(), "dependencies_not_ready");
        let start = core
            .start_code_project(StartCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
                port: Some(5173),
            })
            .expect_err("dev server requires installed dependencies");
        assert_eq!(start.code(), "dependencies_not_ready");
    }

    #[test]
    fn project_start_never_treats_an_unrelated_server_as_the_generated_app() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("occupied-port-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, true, true);
        fs::create_dir(project.join("node_modules")).expect("create node_modules");
        fs::write(
            project.join("node_modules/.modules.yaml"),
            "layoutVersion: 5\n",
        )
        .expect("write dependency state");

        let unrelated_server = TcpListener::bind(("127.0.0.1", 0)).expect("bind unrelated server");
        let occupied_port = unrelated_server
            .local_addr()
            .expect("unrelated server address")
            .port();
        let core = StudioCore::default();

        let error = core
            .start_code_project(StartCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
                port: Some(occupied_port),
            })
            .expect_err("an occupied port must not be reported as the project app");
        assert_eq!(error.code(), "project_port_unavailable");

        let status = core
            .get_project_runtime_status(ProjectRuntimeStatusRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("read status after rejected start");
        assert!(!status.running);
        assert!(!status.dev_server.ready);
        drop(unrelated_server);
    }

    #[test]
    fn project_start_requires_a_successful_compile_before_spawning_vite() {
        if Command::new(pnpm_executable())
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("compile-failure-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, true, true);
        fs::write(
            project.join("package.json"),
            r#"{"name":"compile-failure-test","private":true,"scripts":{"dev":"node dev-should-not-run.mjs","build":"node build-fail.mjs"}}"#,
        )
        .expect("write package manifest");
        fs::write(
            project.join("build-fail.mjs"),
            "console.error('srijika-tsx-build-failed'); process.exit(9);\n",
        )
        .expect("write failing build script");
        fs::write(
            project.join("dev-should-not-run.mjs"),
            "import { writeFileSync } from 'node:fs'; writeFileSync('dev-started', 'bad'); setInterval(() => {}, 1000);\n",
        )
        .expect("write guarded dev script");
        fs::create_dir(project.join("node_modules")).expect("create node_modules");
        fs::write(
            project.join("node_modules/.modules.yaml"),
            "layoutVersion: 5\n",
        )
        .expect("write dependency state");
        let core = StudioCore::default();

        let error = core
            .start_code_project(StartCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
                port: None,
            })
            .expect_err("Run App must stop when compilation fails");
        assert_eq!(error.code(), "project_app_start_failed");
        assert!(error.to_string().contains("srijika-tsx-build-failed"));
        assert!(!project.join("dev-started").exists());

        let status = core
            .get_project_runtime_status(ProjectRuntimeStatusRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("read compile failure status");
        assert!(!status.running);
        assert!(status.last_task.is_some_and(|task| !task.success));
    }

    #[test]
    fn project_start_reports_the_dev_process_error_before_claiming_readiness() {
        if Command::new(pnpm_executable())
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("failing-start-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, true, true);
        fs::write(
            project.join("package.json"),
            r#"{"name":"failing-start-test","private":true,"scripts":{"dev":"node fail.mjs","build":"node -e \"process.exit(0)\""}}"#,
        )
        .expect("write package manifest");
        fs::write(
            project.join("fail.mjs"),
            "console.error('srijika-project-compile-failed'); process.exit(7);\n",
        )
        .expect("write failing dev script");
        fs::create_dir(project.join("node_modules")).expect("create node_modules");
        fs::write(
            project.join("node_modules/.modules.yaml"),
            "layoutVersion: 5\n",
        )
        .expect("write dependency state");
        let core = StudioCore::default();

        let error = core
            .start_code_project_with_timeout(
                StartCodeProjectRequest {
                    path: project.to_string_lossy().into_owned(),
                    port: None,
                },
                Duration::from_secs(3),
            )
            .expect_err("a failed compiler process must fail Run App");
        assert_eq!(error.code(), "project_app_start_failed");
        assert!(error.to_string().contains("srijika-project-compile-failed"));

        let status = core
            .get_project_runtime_status(ProjectRuntimeStatusRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("read failed runtime status");
        assert!(!status.running);
        assert_eq!(status.dev_server.state, DevServerState::Exited);
        assert_eq!(status.dev_server.exit_code, Some(7));
    }

    #[test]
    fn project_start_timeout_stops_a_process_that_never_opens_its_port() {
        if Command::new(pnpm_executable())
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("stalled-start-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, true, true);
        fs::write(
            project.join("package.json"),
            r#"{"name":"stalled-start-test","private":true,"scripts":{"dev":"node stall.mjs","build":"node -e \"process.exit(0)\""}}"#,
        )
        .expect("write package manifest");
        fs::write(
            project.join("stall.mjs"),
            "console.log('srijika-project-stalled'); setInterval(() => {}, 1000);\n",
        )
        .expect("write stalled dev script");
        fs::create_dir(project.join("node_modules")).expect("create node_modules");
        fs::write(
            project.join("node_modules/.modules.yaml"),
            "layoutVersion: 5\n",
        )
        .expect("write dependency state");
        let core = StudioCore::default();

        let error = core
            .start_code_project_with_timeout(
                StartCodeProjectRequest {
                    path: project.to_string_lossy().into_owned(),
                    port: None,
                },
                Duration::from_secs(1),
            )
            .expect_err("a process without a listening server must time out");
        assert_eq!(error.code(), "project_app_start_failed");
        assert!(error.to_string().contains("startup timeout"));

        let status = core
            .get_project_runtime_status(ProjectRuntimeStatusRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("read timed-out runtime status");
        assert!(!status.running);
        assert_eq!(status.dev_server.state, DevServerState::Stopped);
    }

    #[test]
    fn project_app_target_requires_a_tracked_ready_loopback_server() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("open-app-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, true, false);
        let project_path = project.to_string_lossy().into_owned();
        let core = StudioCore::default();

        let untracked = core
            .resolve_project_app_target(OpenCodeProjectAppRequest {
                path: project_path.clone(),
            })
            .expect_err("an untracked server must not produce a browser target");
        assert_eq!(untracked.code(), "project_app_not_running");

        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind ready loopback server");
        let port = listener.local_addr().expect("listener address").port();
        let child = spawn_persistent_test_child();
        let pid = child.id();
        core.runtimes
            .lock()
            .expect("runtime registry")
            .projects
            .insert(
                fs::canonicalize(&project).expect("canonical project"),
                ProjectRuntimeRecord {
                    dev_server: Some(ManagedDevServer {
                        child,
                        pid,
                        port,
                        started_at_millis: 1,
                        stdout: Arc::new(Mutex::new(CappedOutput::default())),
                        stderr: Arc::new(Mutex::new(CappedOutput::default())),
                        stdout_reader: None,
                        stderr_reader: None,
                    }),
                    ..ProjectRuntimeRecord::default()
                },
            );

        let status = core
            .get_project_runtime_status(ProjectRuntimeStatusRequest {
                path: project_path.clone(),
            })
            .expect("read tracked runtime status");
        assert!(status.running);
        assert!(status.dev_server.ready);

        let target = core
            .resolve_project_app_target(OpenCodeProjectAppRequest {
                path: project_path.clone(),
            })
            .expect("resolve ready managed application");
        assert_eq!(
            target.project_path,
            fs::canonicalize(&project).unwrap().to_string_lossy()
        );
        assert_eq!(target.url, format!("http://127.0.0.1:{port}"));

        drop(listener);
        let closed_at = Instant::now();
        let not_ready = loop {
            match core.resolve_project_app_target(OpenCodeProjectAppRequest {
                path: project_path.clone(),
            }) {
                Err(error) => break error,
                Ok(_) => {
                    assert!(
                        closed_at.elapsed() < Duration::from_secs(2),
                        "a closed loopback port remained ready after the listener was dropped"
                    );
                    thread::sleep(Duration::from_millis(5));
                }
            }
        };
        assert_eq!(not_ready.code(), "project_app_not_ready");
        core.shutdown_project_runtimes();
    }

    #[test]
    fn a_project_cannot_restart_while_its_previous_server_is_stopping() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("stopping-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, true, true);
        fs::create_dir(project.join("node_modules")).expect("create node_modules");
        fs::write(
            project.join("node_modules/.modules.yaml"),
            "layoutVersion: 5\n",
        )
        .expect("write dependency state");
        let canonical_project = fs::canonicalize(&project).expect("canonical project");
        let core = StudioCore::default();
        core.runtimes
            .lock()
            .expect("runtime registry")
            .projects
            .insert(
                canonical_project,
                ProjectRuntimeRecord {
                    stopping_dev_server: true,
                    ..ProjectRuntimeRecord::default()
                },
            );

        let error = core
            .start_code_project(StartCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
                port: Some(51_998),
            })
            .expect_err("a concurrent restart must not race process-tree cleanup");

        assert_eq!(error.code(), "project_busy");
        assert!(project_runtime_is_busy(
            core.runtimes
                .lock()
                .expect("runtime registry")
                .projects
                .get(&fs::canonicalize(&project).expect("canonical project"))
                .expect("project runtime")
        ));
    }

    #[test]
    fn process_output_is_capped_while_the_reader_can_continue_draining() {
        let mut output = CappedOutput::default();
        output.append(&vec![b'x'; MAX_TOOL_OUTPUT_BYTES + 128]);
        output.append(b"more output");
        let snapshot = output.snapshot();
        assert_eq!(snapshot.text.len(), MAX_TOOL_OUTPUT_BYTES);
        assert!(snapshot.truncated);
    }

    #[test]
    fn managed_tasks_and_dev_server_complete_the_real_process_lifecycle_when_pnpm_is_available() {
        if Command::new(pnpm_executable())
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }

        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("managed-runtime-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        fs::write(
            project.join("package.json"),
            r#"{"name":"managed-runtime-test","private":true,"packageManager":"pnpm@11.18.0","scripts":{"dev":"node dev-server.mjs","build":"node -e \"console.log('srijika-build-ok')\""}}"#,
        )
        .expect("write executable package manifest");
        fs::write(
            project.join("dev-server.mjs"),
            r#"import { createServer } from 'node:http';
const portIndex = process.argv.indexOf('--port');
const port = Number(process.argv[portIndex + 1]);
createServer((_request, response) => response.end('srijika-generated-project'))
  .listen(port, '127.0.0.1', () => console.log('srijika-dev-ready'));
"#,
        )
        .expect("write project dev server");
        fs::write(
            project.join("pnpm-lock.yaml"),
            "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
        )
        .expect("write frozen lockfile");
        let core = StudioCore::default();

        let install = core
            .install_project_dependencies(ProjectTaskRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("run frozen install");
        assert!(install.success, "install stderr: {}", install.stderr);
        assert_eq!(install.exit_code, Some(0));

        let modules_state = project.join("node_modules/.modules.yaml");
        if !modules_state.exists() {
            fs::create_dir_all(project.join("node_modules"))
                .expect("create dependency state folder");
            fs::write(&modules_state, "layoutVersion: 5\n").expect("write dependency state");
        }
        let build = core
            .build_code_project(ProjectTaskRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("run build");
        assert!(build.success, "build stderr: {}", build.stderr);
        assert!(build.stdout.contains("srijika-build-ok"));

        let running = core
            .start_code_project(StartCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
                port: None,
            })
            .expect("start dev process");
        assert!(running.running);
        assert!(running.port.is_some_and(|port| port >= MIN_DEV_SERVER_PORT));
        let started = Instant::now();
        let live_status = loop {
            thread::sleep(Duration::from_millis(50));
            let status = core
                .get_project_runtime_status(ProjectRuntimeStatusRequest {
                    path: project.to_string_lossy().into_owned(),
                })
                .expect("read running status");
            if status.dev_server.ready && status.dev_server.stdout.contains("srijika-dev-ready")
                || started.elapsed() > Duration::from_secs(3)
            {
                break status;
            }
        };
        assert!(
            live_status.running,
            "dev status: {:?}",
            live_status.dev_server
        );
        assert!(live_status.dev_server.stdout.contains("srijika-dev-ready"));
        assert!(live_status.dev_server.ready);
        let live_port = live_status.port.expect("managed project port");
        let mut connection =
            TcpStream::connect(("127.0.0.1", live_port)).expect("connect managed project");
        connection
            .write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .expect("request managed project");
        let mut response = String::new();
        connection
            .read_to_string(&mut response)
            .expect("read managed project response");
        assert!(response.contains("srijika-generated-project"));

        let stopped = core
            .stop_code_project(ProjectTaskRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("stop dev process");
        assert!(!stopped.running);
        assert_eq!(stopped.port, None);
        assert!(stopped.dev_server.stdout.contains("srijika-dev-ready"));
    }

    #[test]
    fn shutdown_terminates_an_active_managed_project_task() {
        if Command::new(pnpm_executable())
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }

        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("shutdown-task-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        fs::write(
            project.join("package.json"),
            r#"{"name":"shutdown-task-test","private":true,"scripts":{"dev":"vite","build":"node -e \"setInterval(() => {}, 1000)\""}}"#,
        )
        .expect("write package manifest");
        fs::write(
            project.join("pnpm-lock.yaml"),
            "lockfileVersion: '9.0'\nsettings: {}\nimporters: {}\n",
        )
        .expect("write lockfile");
        fs::create_dir(project.join("node_modules")).expect("create node_modules");
        fs::write(
            project.join("node_modules/.modules.yaml"),
            "layoutVersion: 5\n",
        )
        .expect("write dependency state");

        let core = StudioCore::default();
        let task_core = core.clone();
        let project_path = project.to_string_lossy().into_owned();
        let task_path = project_path.clone();
        let (sender, receiver) = mpsc::channel();
        let task = thread::spawn(move || {
            let result = task_core.build_code_project(ProjectTaskRequest { path: task_path });
            sender.send(result).expect("send task result");
        });

        let canonical_project = fs::canonicalize(&project).expect("canonical project");
        let started = Instant::now();
        loop {
            let active_pid = core
                .runtimes
                .lock()
                .expect("runtime registry")
                .projects
                .get(&canonical_project)
                .and_then(|record| record.active_task_pid);
            if active_pid.is_some() {
                break;
            }
            assert!(
                started.elapsed() < Duration::from_secs(3),
                "managed task did not start"
            );
            thread::sleep(Duration::from_millis(10));
        }

        core.shutdown_project_runtimes();
        let result = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("shutdown must release the waiting managed task")
            .expect("task should return its terminated exit status");
        assert!(!result.success);
        task.join().expect("managed task thread");
        assert!(
            core.runtimes
                .lock()
                .expect("runtime registry")
                .projects
                .get(&canonical_project)
                .is_some_and(|record| record.active_task_pid.is_none())
        );
    }
}
