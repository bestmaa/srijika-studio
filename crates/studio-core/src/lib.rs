#![forbid(unsafe_code)]

use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Component, Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex, MutexGuard},
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
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
const MAX_TYPESCRIPT_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_PROJECT_ENTRY_SEGMENTS: usize = 32;
const MAX_PROJECT_FILE_BYTES: usize = 4 * 1024 * 1024;
const MAX_PROJECT_BYTES: usize = 24 * 1024 * 1024;
const MAX_PROJECT_FILES: usize = 256;
const MAX_PROJECT_TREE_ENTRIES: usize = 4_096;
const MAX_PROJECT_TREE_DEPTH: usize = 24;
const MAX_PROJECT_TREE_METADATA_BYTES: usize = 2 * 1024 * 1024;
const MAX_PROJECT_TREE_HASH_BYTES: u64 = 24 * 1024 * 1024;
const MAX_ARCHITECTURE_SOURCE_FILES: usize = 4_096;
const MAX_ARCHITECTURE_SCAN_ENTRIES: usize = 32_768;
const MAX_ARCHITECTURE_SCAN_DIRECTORIES: usize = 4_096;
const MAX_ARCHITECTURE_SCAN_DEPTH: usize = 32;
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
const IGNORED_PROJECT_DIRECTORIES: [&str; 10] = [
    ".git",
    ".next",
    ".srijika",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
];
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
        let checked = checked_tsx_path(&request.path)?;
        let path = checked.path;
        let (mut file, metadata) = open_regular_file_for_read(
            &path,
            MAX_TSX_SOURCE_BYTES,
            "TSX source",
            checked.project_root.as_deref(),
        )?;
        let mut source = String::with_capacity(metadata.len().min(usize::MAX as u64) as usize);
        (&mut file)
            .take(MAX_TSX_SOURCE_BYTES.saturating_add(1))
            .read_to_string(&mut source)
            .map_err(|error| source_io("read UTF-8 TSX source", &path, error))?;
        if source.len() as u64 > MAX_TSX_SOURCE_BYTES {
            return Err(StudioCoreError::SourceTooLarge {
                max: MAX_TSX_SOURCE_BYTES,
                actual: source.len() as u64,
            });
        }
        ensure_open_file_still_matches_path(&path, &file, checked.project_root.as_deref())?;
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
        let checked = checked_tsx_path(&request.path)?;
        let path = checked.path;
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
        let relative_path = validate_new_ui_relative_path(
            &request.relative_path,
            &request.component_name,
            &project.architecture,
        )?;
        let response_relative_path = path_to_forward_slashes(&relative_path)?;
        if !response_relative_path.starts_with("src/pages/") {
            return Err(StudioCoreError::InvalidProject(
                "route-level UI pages must be created under src/pages",
            ));
        }
        let connector_file_name = project
            .architecture
            .connector_file_name(&request.component_name);
        let connector_relative_path = relative_path
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(connector_file_name);
        let ui_path = project.canonical_root.join(&relative_path);
        let connector_path = project.canonical_root.join(&connector_relative_path);
        let (source, connector_source) =
            new_ui_source_pair(request.kind, &request.component_name, &project.architecture);

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
        let architecture = &project.architecture;

        if is_shared_scaffold_capability(&request.capability) {
            return scaffold_shared_code_project_structure(
                &project.canonical_root,
                architecture,
                request,
            );
        }

        let feature_slug = pascal_case_path_segment(&request.feature_name)?;
        let feature_relative = architecture.features.join(&feature_slug);
        let feature_ui_relative =
            feature_relative.join(architecture.ui_file_name(&request.feature_name));
        if !matches!(
            &request.capability,
            CodeProjectScaffoldCapability::Feature { .. }
        ) {
            validate_existing_scaffold_ui(&project.canonical_root, &feature_ui_relative)?;
        }

        let mut plans = Vec::new();
        match &request.capability {
            CodeProjectScaffoldCapability::SharedUi { .. }
            | CodeProjectScaffoldCapability::SharedUiTypes
            | CodeProjectScaffoldCapability::SharedWidget { .. }
            | CodeProjectScaffoldCapability::SharedWidgetConnector
            | CodeProjectScaffoldCapability::SharedWidgetStore
            | CodeProjectScaffoldCapability::SharedWidgetHook
            | CodeProjectScaffoldCapability::SharedWidgetBehaviorHook { .. }
            | CodeProjectScaffoldCapability::SharedWidgetStoreSlice { .. }
            | CodeProjectScaffoldCapability::SharedWidgetLogic
            | CodeProjectScaffoldCapability::SharedWidgetApi
            | CodeProjectScaffoldCapability::SharedWidgetTypes
            | CodeProjectScaffoldCapability::SharedCapability { .. }
            | CodeProjectScaffoldCapability::SharedCapabilityStore
            | CodeProjectScaffoldCapability::SharedCapabilityHook
            | CodeProjectScaffoldCapability::SharedCapabilityBehaviorHook { .. }
            | CodeProjectScaffoldCapability::SharedCapabilityStoreSlice { .. }
            | CodeProjectScaffoldCapability::SharedCapabilityLogic
            | CodeProjectScaffoldCapability::SharedCapabilityApi
            | CodeProjectScaffoldCapability::SharedCapabilityTypes => {
                unreachable!("shared scaffolds are handled before Feature resolution")
            }
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
                    architecture,
                )?;
            }
            CodeProjectScaffoldCapability::FeatureConnector => {
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &feature_relative,
                    &request.feature_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    feature_relative.join(architecture.connector_file_name(&request.feature_name)),
                    CodeProjectScaffoldFileRole::FeatureConnector,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &feature_relative,
                        &request.feature_name,
                        OwnerRuntimeLayer::Connector,
                        layers,
                        architecture,
                    ),
                ));
            }
            CodeProjectScaffoldCapability::FeatureStore => {
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &feature_relative,
                    &request.feature_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    feature_relative.join(architecture.store_file_name(&request.feature_name)),
                    CodeProjectScaffoldFileRole::FeatureStore,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &feature_relative,
                        &request.feature_name,
                        OwnerRuntimeLayer::Store,
                        layers,
                        architecture,
                    ),
                ));
            }
            CodeProjectScaffoldCapability::FeatureHook => {
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &feature_relative,
                    &request.feature_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    feature_relative.join(architecture.hook_file_name(&request.feature_name)),
                    CodeProjectScaffoldFileRole::FeatureHook,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &feature_relative,
                        &request.feature_name,
                        OwnerRuntimeLayer::Hook,
                        layers,
                        architecture,
                    ),
                ));
            }
            CodeProjectScaffoldCapability::FeatureBehaviorHook { hook_name } => {
                validate_scoped_hook_name(hook_name, &request.feature_name)?;
                let files = expand_owner_capability(
                    &project.canonical_root,
                    architecture,
                    &feature_relative,
                    &request.feature_name,
                    ExpandedOwnerCapability::Hook,
                    hook_name,
                    CodeProjectScaffoldFileRole::FeatureHook,
                )?;
                let bytes = files.iter().map(|file| file.bytes).sum();
                return Ok(ScaffoldedCodeProjectStructure {
                    project_path: project.canonical_root.to_string_lossy().into_owned(),
                    feature_name: request.feature_name,
                    feature_path: path_to_forward_slashes(&feature_relative)?,
                    capability: request.capability,
                    files,
                    bytes,
                });
            }
            CodeProjectScaffoldCapability::FeatureStoreSlice { store_name } => {
                validate_scoped_store_name(store_name, &request.feature_name)?;
                let files = expand_owner_capability(
                    &project.canonical_root,
                    architecture,
                    &feature_relative,
                    &request.feature_name,
                    ExpandedOwnerCapability::Store,
                    store_name,
                    CodeProjectScaffoldFileRole::FeatureStore,
                )?;
                let bytes = files.iter().map(|file| file.bytes).sum();
                return Ok(ScaffoldedCodeProjectStructure {
                    project_path: project.canonical_root.to_string_lossy().into_owned(),
                    feature_name: request.feature_name,
                    feature_path: path_to_forward_slashes(&feature_relative)?,
                    capability: request.capability,
                    files,
                    bytes,
                });
            }
            CodeProjectScaffoldCapability::FeatureLogic => {
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &feature_relative,
                    &request.feature_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    feature_relative.join(architecture.logic_file_name(&request.feature_name)),
                    CodeProjectScaffoldFileRole::FeatureLogic,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &feature_relative,
                        &request.feature_name,
                        OwnerRuntimeLayer::Logic,
                        layers,
                        architecture,
                    ),
                ));
            }
            CodeProjectScaffoldCapability::FeatureApi => {
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &feature_relative,
                    &request.feature_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    feature_relative.join(architecture.api_file_name(&request.feature_name)),
                    CodeProjectScaffoldFileRole::FeatureApi,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &feature_relative,
                        &request.feature_name,
                        OwnerRuntimeLayer::Api,
                        layers,
                        architecture,
                    ),
                ));
            }
            CodeProjectScaffoldCapability::FeatureTypes => {
                plans.push(scaffold_file_plan(
                    feature_relative.join(architecture.types_file_name(&request.feature_name)),
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
                let slot_relative = feature_relative
                    .join(&architecture.slots_directory)
                    .join(&slot_slug);
                plans.push(scaffold_file_plan(
                    slot_relative.join(architecture.ui_file_name(slot_name)),
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
                    architecture,
                )?;
                if let Some(part_name) = part_name {
                    if !create_part_connector {
                        return Err(StudioCoreError::InvalidProject(
                            "every Part requires its matching Connector",
                        ));
                    }
                    validate_component_name(part_name)?;
                    let part_slug = pascal_case_path_segment(part_name)?;
                    let part_relative = slot_relative
                        .join(&architecture.parts_directory)
                        .join(part_slug);
                    plans.push(scaffold_file_plan(
                        part_relative.join(architecture.ui_file_name(part_name)),
                        CodeProjectScaffoldFileRole::PartUi,
                        part_ui_source(part_name),
                    ));
                    if *create_part_connector {
                        plans.push(scaffold_file_plan(
                            part_relative.join(architecture.connector_file_name(part_name)),
                            CodeProjectScaffoldFileRole::PartConnector,
                            connector_source(part_name, architecture),
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
                    architecture,
                )?;
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &slot_relative,
                    slot_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    slot_relative.join(architecture.hook_file_name(slot_name)),
                    CodeProjectScaffoldFileRole::SlotHook,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &slot_relative,
                        slot_name,
                        OwnerRuntimeLayer::Hook,
                        layers,
                        architecture,
                    ),
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
                    architecture,
                )?;
                validate_scoped_hook_name(hook_name, slot_name)?;
                let files = expand_owner_capability(
                    &project.canonical_root,
                    architecture,
                    &slot_relative,
                    slot_name,
                    ExpandedOwnerCapability::Hook,
                    hook_name,
                    CodeProjectScaffoldFileRole::SlotHook,
                )?;
                let bytes = files.iter().map(|file| file.bytes).sum();
                return Ok(ScaffoldedCodeProjectStructure {
                    project_path: project.canonical_root.to_string_lossy().into_owned(),
                    feature_name: request.feature_name,
                    feature_path: path_to_forward_slashes(&feature_relative)?,
                    capability: request.capability,
                    files,
                    bytes,
                });
            }
            CodeProjectScaffoldCapability::SlotStoreSlice {
                slot_name,
                store_name,
            } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    architecture,
                )?;
                validate_scoped_store_name(store_name, slot_name)?;
                let files = expand_owner_capability(
                    &project.canonical_root,
                    architecture,
                    &slot_relative,
                    slot_name,
                    ExpandedOwnerCapability::Store,
                    store_name,
                    CodeProjectScaffoldFileRole::SlotStore,
                )?;
                let bytes = files.iter().map(|file| file.bytes).sum();
                return Ok(ScaffoldedCodeProjectStructure {
                    project_path: project.canonical_root.to_string_lossy().into_owned(),
                    feature_name: request.feature_name,
                    feature_path: path_to_forward_slashes(&feature_relative)?,
                    capability: request.capability,
                    files,
                    bytes,
                });
            }
            CodeProjectScaffoldCapability::SlotConnector { slot_name } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    architecture,
                )?;
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &slot_relative,
                    slot_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    slot_relative.join(architecture.connector_file_name(slot_name)),
                    CodeProjectScaffoldFileRole::SlotConnector,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &slot_relative,
                        slot_name,
                        OwnerRuntimeLayer::Connector,
                        layers,
                        architecture,
                    ),
                ));
            }
            CodeProjectScaffoldCapability::SlotStore { slot_name } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    architecture,
                )?;
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &slot_relative,
                    slot_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    slot_relative.join(architecture.store_file_name(slot_name)),
                    CodeProjectScaffoldFileRole::SlotStore,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &slot_relative,
                        slot_name,
                        OwnerRuntimeLayer::Store,
                        layers,
                        architecture,
                    ),
                ));
            }
            CodeProjectScaffoldCapability::SlotLogic { slot_name } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    architecture,
                )?;
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &slot_relative,
                    slot_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    slot_relative.join(architecture.logic_file_name(slot_name)),
                    CodeProjectScaffoldFileRole::SlotLogic,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &slot_relative,
                        slot_name,
                        OwnerRuntimeLayer::Logic,
                        layers,
                        architecture,
                    ),
                ));
            }
            CodeProjectScaffoldCapability::SlotApi { slot_name } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    architecture,
                )?;
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &slot_relative,
                    slot_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    slot_relative.join(architecture.api_file_name(slot_name)),
                    CodeProjectScaffoldFileRole::SlotApi,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &slot_relative,
                        slot_name,
                        OwnerRuntimeLayer::Api,
                        layers,
                        architecture,
                    ),
                ));
            }
            CodeProjectScaffoldCapability::SlotTypes { slot_name } => {
                let slot_relative = validated_existing_slot_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    architecture,
                )?;
                plans.push(scaffold_file_plan(
                    slot_relative.join(architecture.types_file_name(slot_name)),
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
                    architecture,
                )?;
                validate_component_name(part_name)?;
                let part_slug = pascal_case_path_segment(part_name)?;
                let part_relative = slot_relative
                    .join(&architecture.parts_directory)
                    .join(&part_slug);
                plans.push(scaffold_file_plan(
                    part_relative.join(architecture.ui_file_name(part_name)),
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
                    architecture,
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
                    architecture,
                )?;
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &part_relative,
                    part_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    part_relative.join(architecture.connector_file_name(part_name)),
                    CodeProjectScaffoldFileRole::PartConnector,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &part_relative,
                        part_name,
                        OwnerRuntimeLayer::Connector,
                        layers,
                        architecture,
                    ),
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
                    architecture,
                )?;
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &part_relative,
                    part_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    part_relative.join(architecture.store_file_name(part_name)),
                    CodeProjectScaffoldFileRole::PartStore,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &part_relative,
                        part_name,
                        OwnerRuntimeLayer::Store,
                        layers,
                        architecture,
                    ),
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
                    architecture,
                )?;
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &part_relative,
                    part_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    part_relative.join(architecture.hook_file_name(part_name)),
                    CodeProjectScaffoldFileRole::PartHook,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &part_relative,
                        part_name,
                        OwnerRuntimeLayer::Hook,
                        layers,
                        architecture,
                    ),
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
                    architecture,
                )?;
                validate_scoped_hook_name(hook_name, part_name)?;
                let files = expand_owner_capability(
                    &project.canonical_root,
                    architecture,
                    &part_relative,
                    part_name,
                    ExpandedOwnerCapability::Hook,
                    hook_name,
                    CodeProjectScaffoldFileRole::PartHook,
                )?;
                let bytes = files.iter().map(|file| file.bytes).sum();
                return Ok(ScaffoldedCodeProjectStructure {
                    project_path: project.canonical_root.to_string_lossy().into_owned(),
                    feature_name: request.feature_name,
                    feature_path: path_to_forward_slashes(&feature_relative)?,
                    capability: request.capability,
                    files,
                    bytes,
                });
            }
            CodeProjectScaffoldCapability::PartStoreSlice {
                slot_name,
                part_name,
                store_name,
            } => {
                let part_relative = validated_existing_part_relative(
                    &project.canonical_root,
                    &feature_relative,
                    slot_name,
                    part_name,
                    architecture,
                )?;
                validate_scoped_store_name(store_name, part_name)?;
                let files = expand_owner_capability(
                    &project.canonical_root,
                    architecture,
                    &part_relative,
                    part_name,
                    ExpandedOwnerCapability::Store,
                    store_name,
                    CodeProjectScaffoldFileRole::PartStore,
                )?;
                let bytes = files.iter().map(|file| file.bytes).sum();
                return Ok(ScaffoldedCodeProjectStructure {
                    project_path: project.canonical_root.to_string_lossy().into_owned(),
                    feature_name: request.feature_name,
                    feature_path: path_to_forward_slashes(&feature_relative)?,
                    capability: request.capability,
                    files,
                    bytes,
                });
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
                    architecture,
                )?;
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &part_relative,
                    part_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    part_relative.join(architecture.logic_file_name(part_name)),
                    CodeProjectScaffoldFileRole::PartLogic,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &part_relative,
                        part_name,
                        OwnerRuntimeLayer::Logic,
                        layers,
                        architecture,
                    ),
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
                    architecture,
                )?;
                let layers = existing_owner_layers(
                    &project.canonical_root,
                    &part_relative,
                    part_name,
                    architecture,
                );
                plans.push(scaffold_file_plan(
                    part_relative.join(architecture.api_file_name(part_name)),
                    CodeProjectScaffoldFileRole::PartApi,
                    canonical_progressive_runtime_source_for_new_file(
                        &project.canonical_root,
                        &part_relative,
                        part_name,
                        OwnerRuntimeLayer::Api,
                        layers,
                        architecture,
                    ),
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
                    architecture,
                )?;
                plans.push(scaffold_file_plan(
                    part_relative.join(architecture.types_file_name(part_name)),
                    CodeProjectScaffoldFileRole::PartTypes,
                    owner_types_source(part_name),
                ));
            }
        }

        let senior_update =
            if let Some(new_layer) = standalone_progressive_runtime_layer(&request.capability) {
                let (owner_relative, owner_name) = standalone_progressive_owner(
                    &feature_relative,
                    &request.feature_name,
                    &request.capability,
                    architecture,
                )?
                .ok_or(StudioCoreError::InvalidProject(
                    "standalone runtime capability is missing its canonical owner",
                ))?;
                standalone_progressive_senior_update(
                    &project.canonical_root,
                    &owner_relative,
                    owner_name,
                    new_layer,
                    architecture,
                )?
            } else {
                None
            };
        let files = create_scaffold_files(&project.canonical_root, plans)?;
        apply_scaffold_source_update(&files, senior_update, "owner runtime gateway")?;
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
        let mut scan = ProjectTreeScan::new(&project.canonical_root, &project.architecture);
        scan_directory(&project.canonical_root, Path::new(""), 0, &mut scan)?;
        if scan.entry_budget_exceeded {
            // Filesystem iteration order is not portable. Returning an arbitrary
            // prefix after the physical work budget is exceeded would make the
            // Explorer nondeterministic, so discard the partial read model and
            // report only the bounded truncation state.
            scan.entries.clear();
        }

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
        let mut scan =
            ProjectTreeScan::architecture(&project.canonical_root, &project.architecture);
        for architecture_root in [&project.architecture.features, &project.architecture.shared] {
            ensure_project_path_components_are_real(
                &project.canonical_root,
                architecture_root,
                true,
            )?;
            let root_path = project.canonical_root.join(architecture_root);
            let metadata = match fs::symlink_metadata(&root_path) {
                Ok(metadata) => metadata,
                Err(source) if source.kind() == ErrorKind::NotFound => {
                    // Node/portable count each configured-root visit, including
                    // an absent optional root, against the directory budget.
                    scan.record_directory_visit();
                    continue;
                }
                Err(source) => {
                    return Err(source_io(
                        "inspect architecture source root",
                        &root_path,
                        source,
                    ));
                }
            };
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(StudioCoreError::InvalidProject(
                    "configured architecture roots must be real directories",
                ));
            }
            let canonical = fs::canonicalize(&root_path).map_err(|source| {
                source_io("resolve architecture source root", &root_path, source)
            })?;
            ensure_project_containment(&project.canonical_root, &canonical)?;
            // Match the portable/Node contract: each configured source root is
            // directory depth 1, so its deepest accepted descendant is 32.
            scan_directory(&canonical, architecture_root, 1, &mut scan)?;
        }
        if scan.unsafe_entry.is_some() {
            return Err(StudioCoreError::InvalidProject(
                "architecture source scan cannot skip symbolic links or non-regular project entries",
            ));
        }
        if scan.truncated {
            return Err(StudioCoreError::InvalidProject(
                "architecture source scan exceeded the complete-project directory, entry, metadata, depth, or hash limits",
            ));
        }

        let mut candidates = scan
            .entries
            .into_iter()
            .filter(|entry| {
                entry.kind == ProjectTreeEntryKind::File
                    && is_architecture_source_path(&entry.relative_path)
            })
            .collect::<Vec<_>>();
        let entry_relative_path = project
            .entry_path
            .strip_prefix(&project.canonical_root)
            .map_err(|_| StudioCoreError::InvalidProject("project entry must remain inside root"))?
            .to_path_buf();
        let entry_relative = path_to_forward_slashes(&entry_relative_path)?;
        if !candidates
            .iter()
            .any(|candidate| candidate.relative_path == entry_relative)
        {
            ensure_project_path_components_are_real(
                &project.canonical_root,
                &entry_relative_path,
                false,
            )?;
            let metadata = fs::symlink_metadata(&project.entry_path).map_err(|source| {
                source_io("inspect project entry source", &project.entry_path, source)
            })?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(StudioCoreError::InvalidProject(
                    "project entry must be a regular file",
                ));
            }
            candidates.push(ProjectTreeEntry {
                path: project.entry_path.to_string_lossy().into_owned(),
                relative_path: entry_relative,
                kind: ProjectTreeEntryKind::File,
                bytes: Some(metadata.len()),
                hash: None,
                is_ui_source: true,
            });
        }
        candidates.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        if candidates.len() > MAX_ARCHITECTURE_SOURCE_FILES {
            return Err(StudioCoreError::InvalidProject(
                "architecture source scan exceeds the source file count limit",
            ));
        }

        let mut sources = Vec::with_capacity(candidates.len());
        let mut total_bytes = 0_u64;
        for entry in candidates {
            if sources.len() >= MAX_ARCHITECTURE_SOURCE_FILES {
                return Err(StudioCoreError::InvalidProject(
                    "architecture source scan exceeds the source file count limit",
                ));
            }
            let expected_bytes = entry.bytes.ok_or(StudioCoreError::InvalidProject(
                "architecture source must be a regular file",
            ))?;
            if expected_bytes > MAX_ARCHITECTURE_SOURCE_BYTES {
                return Err(StudioCoreError::InvalidProject(
                    "architecture source exceeds the per-file size limit",
                ));
            }
            let next_total =
                total_bytes
                    .checked_add(expected_bytes)
                    .ok_or(StudioCoreError::InvalidProject(
                        "architecture sources exceed the combined size limit",
                    ))?;
            if next_total > MAX_ARCHITECTURE_SOURCES_BYTES {
                return Err(StudioCoreError::InvalidProject(
                    "architecture sources exceed the combined size limit",
                ));
            }

            let relative_path = PathBuf::from(&entry.relative_path);
            ensure_project_path_components_are_real(
                &project.canonical_root,
                &relative_path,
                false,
            )?;
            let source_path = project.canonical_root.join(&relative_path);
            let source = read_regular_utf8_file_in_project(
                &source_path,
                MAX_ARCHITECTURE_SOURCE_BYTES,
                "architecture source",
                &project.canonical_root,
            )?;
            let canonical_path = fs::canonicalize(&source_path)
                .map_err(|source| source_io("resolve architecture source", &source_path, source))?;
            ensure_project_containment(&project.canonical_root, &canonical_path)?;
            let bytes = source.len() as u64;
            if bytes != expected_bytes {
                return Err(StudioCoreError::ProjectChangedDuringRead);
            }
            total_bytes = next_total;
            sources.push(LoadedCodeProjectArchitectureSource {
                path: canonical_path.to_string_lossy().into_owned(),
                relative_path: entry.relative_path,
                bytes,
                hash: source_hash(&source),
                source,
            });
        }

        let tsconfig_path = project.canonical_root.join("tsconfig.json");
        let tsconfig_source = match fs::symlink_metadata(&tsconfig_path) {
            Ok(_) => Some(read_regular_utf8_file_in_project(
                &tsconfig_path,
                MAX_TYPESCRIPT_CONFIG_BYTES,
                "TypeScript project config",
                &project.canonical_root,
            )?),
            Err(source) if source.kind() == ErrorKind::NotFound => None,
            Err(source) => {
                return Err(source_io(
                    "inspect TypeScript project config",
                    &tsconfig_path,
                    source,
                ));
            }
        };

        Ok(LoadedCodeProjectArchitectureSources {
            path: project.canonical_root.to_string_lossy().into_owned(),
            config_source: project.config_source,
            tsconfig_source,
            sources,
            truncated: false,
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
            let source = read_regular_utf8_file_in_project(
                &stylesheet_path,
                MAX_PREVIEW_STYLESHEET_BYTES,
                "preview stylesheet",
                &project.canonical_root,
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
            let source = read_regular_utf8_file_in_project(
                &asset_path,
                MAX_PREVIEW_ASSET_BYTES,
                "preview asset",
                &project.canonical_root,
            )?;
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
    SharedUi {
        #[serde(default)]
        create_types: bool,
    },
    SharedUiTypes,
    SharedWidget {
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
    },
    SharedWidgetConnector,
    SharedWidgetStore,
    SharedWidgetHook,
    SharedWidgetBehaviorHook {
        hook_name: String,
    },
    SharedWidgetStoreSlice {
        store_name: String,
    },
    SharedWidgetLogic,
    SharedWidgetApi,
    SharedWidgetTypes,
    SharedCapability {
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
    },
    SharedCapabilityStore,
    SharedCapabilityHook,
    SharedCapabilityBehaviorHook {
        hook_name: String,
    },
    SharedCapabilityStoreSlice {
        store_name: String,
    },
    SharedCapabilityLogic,
    SharedCapabilityApi,
    SharedCapabilityTypes,
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
    FeatureStoreSlice {
        store_name: String,
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
    SlotStoreSlice {
        slot_name: String,
        store_name: String,
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
    PartStoreSlice {
        slot_name: String,
        part_name: String,
        store_name: String,
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
    SharedUi,
    SharedUiTypes,
    SharedWidgetUi,
    SharedWidgetConnector,
    SharedWidgetStore,
    SharedWidgetHook,
    SharedWidgetLogic,
    SharedWidgetApi,
    SharedWidgetTypes,
    SharedCapabilityStore,
    SharedCapabilityHook,
    SharedCapabilityLogic,
    SharedCapabilityApi,
    SharedCapabilityTypes,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tsconfig_source: Option<String>,
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
    architecture: CodeProjectArchitectureConfig,
    preview_style_paths: Vec<PathBuf>,
    preview_asset_paths: Vec<PathBuf>,
    preview_design_props: Map<String, Value>,
}

#[derive(Debug, Clone)]
struct CodeProjectArchitectureConfig {
    features: PathBuf,
    shared: PathBuf,
    slots_directory: String,
    parts_directory: String,
    hooks_directory: String,
    stores_directory: String,
    ui_suffix: String,
    connector_suffix: String,
    store_suffix: String,
    logic_suffix: String,
    api_suffix: String,
    types_suffix: String,
}

impl CodeProjectArchitectureConfig {
    fn ui_file_name(&self, owner_name: &str) -> String {
        format!("{owner_name}{}", self.ui_suffix)
    }

    fn connector_file_name(&self, owner_name: &str) -> String {
        format!("{owner_name}{}", self.connector_suffix)
    }

    fn hook_file_name(&self, owner_name: &str) -> String {
        format!("use{owner_name}.ts")
    }

    fn store_file_name(&self, owner_name: &str) -> String {
        let stem = lower_camel_owner_name(owner_name).expect("validated owner name");
        format!("{stem}{}", self.store_suffix)
    }

    fn logic_file_name(&self, owner_name: &str) -> String {
        let stem = lower_camel_owner_name(owner_name).expect("validated owner name");
        format!("{stem}{}", self.logic_suffix)
    }

    fn api_file_name(&self, owner_name: &str) -> String {
        let stem = lower_camel_owner_name(owner_name).expect("validated owner name");
        format!("{stem}{}", self.api_suffix)
    }

    fn types_file_name(&self, owner_name: &str) -> String {
        let stem = lower_camel_owner_name(owner_name).expect("validated owner name");
        format!("{stem}{}", self.types_suffix)
    }

    fn local_module_for_file_name(&self, file_name: String) -> String {
        let without_extension = file_name
            .strip_suffix(".tsx")
            .or_else(|| file_name.strip_suffix(".ts"))
            .expect("validated TypeScript architecture suffix");
        format!("./{without_extension}")
    }

    fn ui_module(&self, owner_name: &str) -> String {
        self.local_module_for_file_name(self.ui_file_name(owner_name))
    }

    fn hook_module(&self, owner_name: &str) -> String {
        self.local_module_for_file_name(self.hook_file_name(owner_name))
    }

    fn store_module(&self, owner_name: &str) -> String {
        self.local_module_for_file_name(self.store_file_name(owner_name))
    }

    fn logic_module(&self, owner_name: &str) -> String {
        self.local_module_for_file_name(self.logic_file_name(owner_name))
    }

    fn api_module(&self, owner_name: &str) -> String {
        self.local_module_for_file_name(self.api_file_name(owner_name))
    }

    fn types_module(&self, owner_name: &str) -> String {
        self.local_module_for_file_name(self.types_file_name(owner_name))
    }
}

fn configured_architecture_root(
    architecture: Option<&Map<String, Value>>,
    field: &'static str,
    fallback: &'static str,
) -> Result<PathBuf, StudioCoreError> {
    let raw = match architecture.and_then(|value| value.get(field)) {
        None => fallback,
        Some(value) => value.as_str().ok_or(StudioCoreError::InvalidProject(
            "project architecture roots must be strings",
        ))?,
    };
    if raw.contains('\\')
        || raw.starts_with('/')
        || raw.ends_with('/')
        || raw.split('/').any(str::is_empty)
        || is_windows_drive_path(raw)
    {
        return Err(StudioCoreError::InvalidProject(
            "project architecture roots must be normalized project-relative paths",
        ));
    }
    let path = checked_relative_project_path(raw)?;
    // Reserve the deepest canonical suffix:
    // <feature>/slots/<slot>/parts/<part>/<file>.
    if path.components().count() > MAX_NEW_UI_DEPTH.saturating_sub(6) {
        return Err(StudioCoreError::InvalidProject(
            "project architecture root exceeds the supported directory depth",
        ));
    }
    Ok(path)
}

fn configured_architecture_directory(
    architecture: Option<&Map<String, Value>>,
    field: &'static str,
    fallback: &'static str,
) -> Result<String, StudioCoreError> {
    let raw = match architecture.and_then(|value| value.get(field)) {
        None => fallback,
        Some(value) => value.as_str().ok_or(StudioCoreError::InvalidProject(
            "project architecture directories must be strings",
        ))?,
    };
    let path = checked_relative_project_path(raw)?;
    if raw.contains('\\')
        || raw.starts_with('/')
        || raw.ends_with('/')
        || is_windows_drive_path(raw)
        || path.components().count() != 1
    {
        return Err(StudioCoreError::InvalidProject(
            "project architecture directories must be normalized single path segments",
        ));
    }
    Ok(raw.to_owned())
}

fn configured_architecture_suffix(
    architecture: Option<&Map<String, Value>>,
    field: &'static str,
    fallback: &'static str,
    expected_extension: &'static str,
) -> Result<String, StudioCoreError> {
    let raw = match architecture.and_then(|value| value.get(field)) {
        None => fallback,
        Some(value) => value.as_str().ok_or(StudioCoreError::InvalidProject(
            "project architecture suffixes must be strings",
        ))?,
    };
    if raw.is_empty()
        || !raw.starts_with('.')
        || !raw.ends_with(expected_extension)
        || raw.ends_with(".d.ts")
        || raw.ends_with(".d.tsx")
        || raw.contains(['/', '\\', '\0'])
    {
        return Err(StudioCoreError::InvalidProject(
            "project architecture suffixes must be bounded filename suffixes with the expected TypeScript extension",
        ));
    }
    Ok(raw.to_owned())
}

fn is_windows_drive_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn checked_project_entry_path(raw: &str) -> Result<PathBuf, StudioCoreError> {
    let segments = raw.split('/').collect::<Vec<_>>();
    if raw.is_empty()
        || raw.contains(['\0', '\\'])
        || raw.starts_with('/')
        || raw.ends_with('/')
        || is_windows_drive_path(raw)
        || segments.len() > MAX_PROJECT_ENTRY_SEGMENTS
        || segments
            .iter()
            .any(|segment| segment.is_empty() || *segment == "." || *segment == "..")
    {
        return Err(StudioCoreError::InvalidProject(
            "project entry must be a normalized bounded project-relative path",
        ));
    }
    checked_relative_project_path(raw)
}

fn configured_architecture(
    config: &Map<String, Value>,
) -> Result<CodeProjectArchitectureConfig, StudioCoreError> {
    let architecture = match config.get("architecture") {
        None => None,
        Some(value) => Some(value.as_object().ok_or(StudioCoreError::InvalidProject(
            "project architecture must be an object",
        ))?),
    };
    if let Some(architecture) = architecture {
        match architecture.get("profile") {
            None => {
                return Err(StudioCoreError::InvalidProject(
                    "project architecture.profile is required and must be feature-slot-part-v1",
                ));
            }
            Some(profile) if profile.as_str() == Some("feature-slot-part-v1") => {}
            Some(_) => {
                return Err(StudioCoreError::InvalidProject(
                    "project architecture profile is unsupported; expected feature-slot-part-v1",
                ));
            }
        }
    }
    let features = configured_architecture_root(architecture, "featuresRoot", "src/features")?;
    let shared = configured_architecture_root(architecture, "sharedRoot", "src/shared")?;
    let features_key = path_to_forward_slashes(&features)?.to_lowercase();
    let shared_key = path_to_forward_slashes(&shared)?.to_lowercase();
    if features_key == shared_key
        || features_key.starts_with(&format!("{shared_key}/"))
        || shared_key.starts_with(&format!("{features_key}/"))
    {
        return Err(StudioCoreError::InvalidProject(
            "project feature and shared roots must be separate non-overlapping directories",
        ));
    }
    let slots_directory =
        configured_architecture_directory(architecture, "slotsDirectory", "slots")?;
    let parts_directory =
        configured_architecture_directory(architecture, "partsDirectory", "parts")?;
    let hooks_directory =
        configured_architecture_directory(architecture, "hooksDirectory", "hooks")?;
    let stores_directory =
        configured_architecture_directory(architecture, "storesDirectory", "stores")?;
    let unique_directories = [
        slots_directory.to_lowercase(),
        parts_directory.to_lowercase(),
        hooks_directory.to_lowercase(),
        stores_directory.to_lowercase(),
    ]
    .into_iter()
    .collect::<HashSet<String>>();
    if unique_directories.len() != 4 {
        return Err(StudioCoreError::InvalidProject(
            "project architecture directories must be distinct",
        ));
    }
    let ui_suffix = configured_architecture_suffix(architecture, "uiSuffix", ".ui.tsx", ".tsx")?;
    let connector_suffix =
        configured_architecture_suffix(architecture, "connectorSuffix", ".connector.tsx", ".tsx")?;
    let store_suffix =
        configured_architecture_suffix(architecture, "storeSuffix", ".store.ts", ".ts")?;
    let logic_suffix =
        configured_architecture_suffix(architecture, "logicSuffix", ".logic.ts", ".ts")?;
    let api_suffix = configured_architecture_suffix(architecture, "apiSuffix", ".api.ts", ".ts")?;
    let types_suffix =
        configured_architecture_suffix(architecture, "typesSuffix", ".types.ts", ".ts")?;
    let suffixes = [
        ui_suffix.to_lowercase(),
        connector_suffix.to_lowercase(),
        store_suffix.to_lowercase(),
        logic_suffix.to_lowercase(),
        api_suffix.to_lowercase(),
        types_suffix.to_lowercase(),
    ];
    for (index, suffix) in suffixes.iter().enumerate() {
        if suffixes
            .iter()
            .enumerate()
            .any(|(other_index, other)| index != other_index && suffix.ends_with(other))
        {
            return Err(StudioCoreError::InvalidProject(
                "project architecture suffixes must be distinct and non-overlapping",
            ));
        }
    }
    Ok(CodeProjectArchitectureConfig {
        features,
        shared,
        slots_directory,
        parts_directory,
        hooks_directory,
        stores_directory,
        ui_suffix,
        connector_suffix,
        store_suffix,
        logic_suffix,
        api_suffix,
        types_suffix,
    })
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
    let lexical_root = normalize_absolute_path_without_links(&target)?;
    if !paths_equal_for_platform(&lexical_root, &canonical_root) {
        return Err(StudioCoreError::InvalidProject(
            "project path must not contain symbolic-link ancestors",
        ));
    }

    let config_path = canonical_root.join("srijika.config.json");
    let config_source = read_regular_utf8_file_in_project(
        &config_path,
        MAX_PROJECT_CONFIG_BYTES,
        "Srijika project config",
        &canonical_root,
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
    let architecture = configured_architecture(config)?;
    let entry_source =
        config
            .get("entry")
            .and_then(Value::as_str)
            .ok_or(StudioCoreError::InvalidProject(
                "project config must declare a string entry",
            ))?;
    let relative_entry = checked_project_entry_path(entry_source)?;
    if !entry_source.ends_with(&architecture.ui_suffix) {
        return Err(StudioCoreError::InvalidProject(
            "project entry must use the configured UI suffix",
        ));
    }
    let entry_candidate = canonical_root.join(&relative_entry);
    ensure_project_path_components_are_real(&canonical_root, &relative_entry, false)?;
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
    for relative_path in preview_style_paths.iter().chain(&preview_asset_paths) {
        ensure_project_path_components_are_real(&canonical_root, relative_path, false)?;
    }
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
        // Keep the checked lexical path so the later O_NOFOLLOW read can
        // detect a swap at the configured entry instead of reopening a stale
        // canonical target captured during validation.
        entry_path: entry_candidate,
        config_source,
        architecture,
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
    read_regular_utf8_file_with_root(path, maximum_bytes, label, None)
}

fn read_regular_utf8_file_in_project(
    path: &Path,
    maximum_bytes: u64,
    label: &'static str,
    project_root: &Path,
) -> Result<String, StudioCoreError> {
    read_regular_utf8_file_with_root(path, maximum_bytes, label, Some(project_root))
}

fn read_regular_utf8_file_with_root(
    path: &Path,
    maximum_bytes: u64,
    label: &'static str,
    project_root: Option<&Path>,
) -> Result<String, StudioCoreError> {
    let (mut file, metadata) =
        open_regular_file_for_read(path, maximum_bytes, label, project_root)?;
    let mut source = String::with_capacity(metadata.len().min(usize::MAX as u64) as usize);
    (&mut file)
        .take(maximum_bytes.saturating_add(1))
        .read_to_string(&mut source)
        .map_err(|error| source_io("read UTF-8 project file", path, error))?;
    if source.len() as u64 > maximum_bytes {
        return Err(StudioCoreError::InvalidProject(
            "project file exceeds the size limit",
        ));
    }
    ensure_open_file_still_matches_path(path, &file, project_root)?;
    Ok(source)
}

fn open_regular_file_for_read(
    path: &Path,
    maximum_bytes: u64,
    label: &'static str,
    project_root: Option<&Path>,
) -> Result<(File, fs::Metadata), StudioCoreError> {
    let before = fs::symlink_metadata(path)
        .map_err(|source| source_io("inspect project file", path, source))?;
    if before.file_type().is_symlink() || !before.is_file() {
        return Err(invalid_regular_file(label));
    }
    if before.len() > maximum_bytes {
        return Err(file_too_large(label, maximum_bytes, before.len()));
    }

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let file = options
        .open(path)
        .map_err(|source| source_io("open project file without following links", path, source))?;
    let opened = file
        .metadata()
        .map_err(|source| source_io("inspect opened project file", path, source))?;
    if !opened.is_file() || !same_file_identity(&before, &opened) {
        return Err(StudioCoreError::ProjectChangedDuringRead);
    }
    if opened.len() > maximum_bytes {
        return Err(file_too_large(label, maximum_bytes, opened.len()));
    }
    ensure_open_file_still_matches_path(path, &file, project_root)?;
    Ok((file, opened))
}

fn ensure_open_file_still_matches_path(
    path: &Path,
    file: &File,
    project_root: Option<&Path>,
) -> Result<(), StudioCoreError> {
    let opened = file
        .metadata()
        .map_err(|source| source_io("inspect opened project file", path, source))?;
    let current = fs::symlink_metadata(path)
        .map_err(|source| source_io("reinspect project file", path, source))?;
    if current.file_type().is_symlink()
        || !current.is_file()
        || !same_file_identity(&opened, &current)
    {
        return Err(StudioCoreError::ProjectChangedDuringRead);
    }
    if let Some(project_root) = project_root {
        ensure_open_file_containment(path, file, project_root)?;
    }
    Ok(())
}

#[cfg(unix)]
fn same_file_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.len() == right.len()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
        && left.ctime() == right.ctime()
        && left.ctime_nsec() == right.ctime_nsec()
}

#[cfg(not(unix))]
fn same_file_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    left.len() == right.len()
        && left.modified().ok() == right.modified().ok()
        && left.created().ok() == right.created().ok()
}

#[cfg(target_os = "linux")]
fn ensure_open_file_containment(
    path: &Path,
    file: &File,
    project_root: &Path,
) -> Result<(), StudioCoreError> {
    use std::os::fd::AsRawFd;

    let descriptor_path = PathBuf::from("/proc/self/fd").join(file.as_raw_fd().to_string());
    let opened_path = fs::canonicalize(&descriptor_path)
        .map_err(|source| source_io("resolve opened project file", path, source))?;
    ensure_project_containment(project_root, &opened_path)
}

#[cfg(not(target_os = "linux"))]
fn ensure_open_file_containment(
    path: &Path,
    _file: &File,
    project_root: &Path,
) -> Result<(), StudioCoreError> {
    let current_path = fs::canonicalize(path)
        .map_err(|source| source_io("resolve opened project file", path, source))?;
    ensure_project_containment(project_root, &current_path)
}

fn invalid_regular_file(label: &'static str) -> StudioCoreError {
    StudioCoreError::InvalidProject(match label {
        "Srijika project config" => "srijika.config.json must be a regular file",
        "package manifest" => "package.json must be a regular file",
        "TSX source" => "TSX source path must identify a regular file",
        _ => "project file must be a regular file",
    })
}

fn file_too_large(label: &'static str, maximum_bytes: u64, actual: u64) -> StudioCoreError {
    if label == "TSX source" {
        StudioCoreError::SourceTooLarge {
            max: maximum_bytes,
            actual,
        }
    } else {
        StudioCoreError::InvalidProject(match label {
            "Srijika project config" => "srijika.config.json exceeds the size limit",
            "package manifest" => "package.json exceeds the size limit",
            _ => "project file exceeds the size limit",
        })
    }
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

fn ensure_project_path_components_are_real(
    root: &Path,
    relative_path: &Path,
    allow_missing_leaf: bool,
) -> Result<(), StudioCoreError> {
    let components = relative_path.components().collect::<Vec<_>>();
    let mut current = root.to_path_buf();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(value) = component else {
            return Err(StudioCoreError::InvalidProject(
                "project paths must contain only normal relative segments",
            ));
        };
        current.push(value);
        let is_leaf = index + 1 == components.len();
        let metadata = match fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(source) if source.kind() == ErrorKind::NotFound && allow_missing_leaf => {
                return Ok(());
            }
            Err(source) => {
                return Err(source_io(
                    "inspect project path component",
                    &current,
                    source,
                ));
            }
        };
        if metadata.file_type().is_symlink() {
            return Err(StudioCoreError::InvalidProject(
                "project paths must not contain symbolic-link components",
            ));
        }
        if !is_leaf && !metadata.is_dir() {
            return Err(StudioCoreError::InvalidProject(
                "project path ancestors must be real directories",
            ));
        }
    }
    Ok(())
}

#[derive(Debug)]
struct ProjectTreeScan {
    root: PathBuf,
    ui_suffix: String,
    entries: Vec<ProjectTreeEntry>,
    metadata_bytes: usize,
    hashed_bytes: u64,
    truncated: bool,
    unsafe_entry: Option<PathBuf>,
    reject_ignored_symlinks: bool,
    stop_at_nested_projects: bool,
    max_entries: usize,
    scanned_entries: usize,
    entry_budget_exceeded: bool,
    max_directories: Option<usize>,
    max_depth: usize,
    scanned_directories: usize,
    max_metadata_bytes: Option<usize>,
    max_hash_bytes: Option<u64>,
}

impl ProjectTreeScan {
    fn new(root: &Path, architecture: &CodeProjectArchitectureConfig) -> Self {
        Self {
            root: root.to_path_buf(),
            ui_suffix: architecture.ui_suffix.clone(),
            entries: Vec::new(),
            metadata_bytes: 0,
            hashed_bytes: 0,
            truncated: false,
            unsafe_entry: None,
            reject_ignored_symlinks: false,
            stop_at_nested_projects: true,
            max_entries: MAX_PROJECT_TREE_ENTRIES,
            scanned_entries: 0,
            entry_budget_exceeded: false,
            max_directories: None,
            max_depth: MAX_PROJECT_TREE_DEPTH,
            scanned_directories: 0,
            max_metadata_bytes: Some(MAX_PROJECT_TREE_METADATA_BYTES),
            max_hash_bytes: Some(MAX_PROJECT_TREE_HASH_BYTES),
        }
    }

    fn architecture(root: &Path, architecture: &CodeProjectArchitectureConfig) -> Self {
        Self {
            reject_ignored_symlinks: true,
            // The governed Feature and Shared roots are one ownership graph.
            // A nested config inside either root must not silently hide source
            // from validation. Full-project migration scans opt back into the
            // nested-project boundary before they can rewrite importers.
            stop_at_nested_projects: false,
            max_entries: MAX_ARCHITECTURE_SCAN_ENTRIES,
            max_directories: Some(MAX_ARCHITECTURE_SCAN_DIRECTORIES),
            max_depth: MAX_ARCHITECTURE_SCAN_DEPTH,
            max_metadata_bytes: None,
            max_hash_bytes: None,
            ..Self::new(root, architecture)
        }
    }

    fn record_directory_visit(&mut self) {
        self.scanned_directories = self.scanned_directories.saturating_add(1);
        if self
            .max_directories
            .is_some_and(|maximum| self.scanned_directories > maximum)
        {
            self.truncated = true;
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

fn scan_directory(
    directory: &Path,
    relative_directory: &Path,
    depth: usize,
    scan: &mut ProjectTreeScan,
) -> Result<(), StudioCoreError> {
    if scan.truncated {
        return Ok(());
    }
    scan.record_directory_visit();
    if scan.truncated {
        return Ok(());
    }
    let directory_before = fs::symlink_metadata(directory)
        .map_err(|source| source_io("inspect project directory", directory, source))?;
    if directory_before.file_type().is_symlink() || !directory_before.is_dir() {
        return Err(StudioCoreError::ProjectChangedDuringRead);
    }
    let candidate_limit = scan.max_entries.saturating_sub(scan.scanned_entries);
    // Retain and sort only candidates inside the physical work budget. If one
    // more entry exists, the caller discards the partial Explorer model rather
    // than exposing a filesystem-order-dependent prefix.
    let mut candidates = Vec::with_capacity(candidate_limit);
    let entries = fs::read_dir(directory)
        .map_err(|source| source_io("read project directory", directory, source))?;
    for entry in entries {
        let entry = entry.map_err(|source| source_io("read project entry", directory, source))?;
        scan.scanned_entries = scan.scanned_entries.saturating_add(1);
        if scan.scanned_entries > scan.max_entries {
            scan.truncated = true;
            scan.entry_budget_exceeded = true;
            break;
        }
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| StudioCoreError::InvalidProject("project paths must be valid UTF-8"))?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|source| source_io("inspect project tree entry", &entry.path(), source))?;
        if metadata.file_type().is_symlink() {
            if (scan.reject_ignored_symlinks
                || !IGNORED_PROJECT_DIRECTORIES.contains(&name.as_str()))
                && scan.unsafe_entry.is_none()
            {
                scan.unsafe_entry = Some(relative_directory.join(&name));
            }
            continue;
        }
        if metadata.is_dir() && IGNORED_PROJECT_DIRECTORIES.contains(&name.as_str()) {
            continue;
        }
        if !metadata.is_dir() && !metadata.is_file() {
            if scan.unsafe_entry.is_none() {
                scan.unsafe_entry = Some(relative_directory.join(&name));
            }
            continue;
        }
        let candidate = ProjectTreeCandidate {
            absolute_path: entry.path(),
            relative_path: relative_directory.join(&name),
            name,
            metadata,
        };
        candidates.push(candidate);
    }
    let directory_after = fs::symlink_metadata(directory)
        .map_err(|source| source_io("reinspect project directory", directory, source))?;
    if directory_after.file_type().is_symlink()
        || !directory_after.is_dir()
        || !same_file_identity(&directory_before, &directory_after)
    {
        return Err(StudioCoreError::ProjectChangedDuringRead);
    }
    if scan.entry_budget_exceeded {
        return Ok(());
    }

    candidates.sort_by(ProjectTreeCandidate::sort_order);
    for candidate in candidates {
        if scan.entry_budget_exceeded {
            return Ok(());
        }
        if scan.entries.len() >= scan.max_entries {
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
        if let Some(maximum) = scan.max_metadata_bytes {
            if scan.metadata_bytes.saturating_add(metadata_cost) > maximum {
                scan.truncated = true;
                break;
            }
            scan.metadata_bytes = scan.metadata_bytes.saturating_add(metadata_cost);
        }

        let is_directory = candidate.metadata.is_dir();
        let is_ui_source = !is_directory && candidate.name.ends_with(&scan.ui_suffix);
        let hash = if is_ui_source
            && candidate.metadata.len() <= MAX_TSX_SOURCE_BYTES
            && scan.max_hash_bytes.is_some_and(|maximum| {
                scan.hashed_bytes.saturating_add(candidate.metadata.len()) <= maximum
            }) {
            scan.hashed_bytes = scan.hashed_bytes.saturating_add(candidate.metadata.len());
            Some(hash_regular_file(&canonical, candidate.metadata.len())?)
        } else {
            if is_ui_source
                && candidate.metadata.len() <= MAX_TSX_SOURCE_BYTES
                && scan.max_hash_bytes.is_some()
            {
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

        let crosses_nested_project_boundary = scan.stop_at_nested_projects
            && is_directory
            && is_nested_srijika_project_directory(&canonical)?;
        if is_directory && !crosses_nested_project_boundary {
            if depth >= scan.max_depth {
                scan.truncated = true;
                continue;
            }
            scan_directory(
                &canonical,
                &candidate.relative_path,
                depth.saturating_add(1),
                scan,
            )?;
            if scan.entry_budget_exceeded {
                return Ok(());
            }
        }
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
    let lower = relative_path.to_ascii_lowercase();
    if [".d.ts", ".d.tsx", ".d.mts", ".d.cts"]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
    {
        return false;
    }
    [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
}

fn is_migration_source_path(relative_path: &str) -> bool {
    let lower = relative_path.to_ascii_lowercase();
    if [".d.ts", ".d.tsx", ".d.mts", ".d.cts"]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
    {
        return false;
    }
    [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
}

fn hash_regular_file(path: &Path, expected_bytes: u64) -> Result<String, StudioCoreError> {
    let (mut file, metadata) =
        open_regular_file_for_read(path, MAX_TSX_SOURCE_BYTES, "TSX source", None)?;
    if metadata.len() != expected_bytes {
        return Err(StudioCoreError::ProjectChangedDuringRead);
    }
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
    ensure_open_file_still_matches_path(path, &file, None)?;
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

struct CheckedTsxPath {
    path: PathBuf,
    project_root: Option<PathBuf>,
}

fn checked_tsx_path(raw_path: &str) -> Result<CheckedTsxPath, StudioCoreError> {
    if is_windows_drive_path(raw_path) || raw_path.is_empty() || raw_path.contains('\0') {
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
    let mut project = None;
    for ancestor in path.parent().into_iter().flat_map(Path::ancestors) {
        let config_path = ancestor.join("srijika.config.json");
        match fs::symlink_metadata(&config_path) {
            Ok(_) => {
                let ancestor = ancestor.to_str().ok_or(StudioCoreError::InvalidPath(
                    "TSX source project path must be valid UTF-8",
                ))?;
                project = Some(validate_code_project_root(ancestor)?);
                break;
            }
            Err(source) if source.kind() == ErrorKind::NotFound => {}
            Err(source) => {
                return Err(source_io(
                    "inspect TSX source project boundary",
                    &config_path,
                    source,
                ));
            }
        }
    }
    let required_suffix = project
        .as_ref()
        .map_or(".ui.tsx", |project| project.architecture.ui_suffix.as_str());
    if !file_name.ends_with(required_suffix) {
        return Err(StudioCoreError::InvalidPath(
            "Srijika UI source file suffix does not match the project architecture",
        ));
    }
    let project_root = project.map(|project| project.canonical_root);
    if let Some(project_root) = &project_root {
        let relative_path = path.strip_prefix(project_root).map_err(|_| {
            StudioCoreError::InvalidProject("TSX source must stay inside its Srijika project")
        })?;
        ensure_project_path_components_are_real(project_root, relative_path, !path.exists())?;
        let parent = path.parent().ok_or(StudioCoreError::InvalidPath(
            "TSX source path must identify a file",
        ))?;
        let canonical_parent = fs::canonicalize(parent)
            .map_err(|source| source_io("resolve TSX source parent", parent, source))?;
        ensure_project_containment(project_root, &canonical_parent)?;
    }
    Ok(CheckedTsxPath {
        path: path.to_path_buf(),
        project_root,
    })
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

fn normalize_absolute_path_without_links(path: &Path) -> Result<PathBuf, StudioCoreError> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(Path::new(std::path::MAIN_SEPARATOR_STR)),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(StudioCoreError::InvalidProject(
                        "project path must be lexically normalized",
                    ));
                }
            }
            Component::Normal(value) => normalized.push(value),
        }
    }
    Ok(normalized)
}

#[cfg(windows)]
fn paths_equal_for_platform(left: &Path, right: &Path) -> bool {
    left.to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
}

#[cfg(not(windows))]
fn paths_equal_for_platform(left: &Path, right: &Path) -> bool {
    left == right
}

fn checked_relative_project_path(raw_path: &str) -> Result<PathBuf, StudioCoreError> {
    if is_windows_drive_path(raw_path) || raw_path.is_empty() || raw_path.contains('\0') {
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
    let entry = checked_project_entry_path(entry_source)?;
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
    let architecture = configured_architecture(config)?;
    if !entry_source.ends_with(&architecture.ui_suffix) {
        return Err(StudioCoreError::InvalidProject(
            "entry source must use the configured UI suffix",
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
    architecture: &CodeProjectArchitectureConfig,
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
    let expected_file_name = architecture.ui_file_name(component_name);
    if relative.file_name().and_then(|value| value.to_str()) != Some(&expected_file_name) {
        return Err(StudioCoreError::InvalidProject(
            "new UI file name must match the component name and configured UI suffix",
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

fn new_ui_source_pair(
    kind: CodeProjectUiSourceKind,
    name: &str,
    architecture: &CodeProjectArchitectureConfig,
) -> (String, String) {
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
    const PAGE_CONNECTOR: &str = r#"import { __NAME__UI } from '__UI_MODULE__';

export function __NAME__Connector() {
  return (
    <__NAME__UI
      title="__NAME__"
      description="Start building this page in __UI_FILE__."
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
    const COMPONENT_CONNECTOR: &str = r#"import { __NAME__UI } from '__UI_MODULE__';

export function __NAME__Connector() {
  return (
    <__NAME__UI
      label="__NAME__"
      supportingText="Connect data and behavior in __CONNECTOR_FILE__."
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
        connector
            .replace("__NAME__", name)
            .replace("__UI_MODULE__", &architecture.ui_module(name))
            .replace("__UI_FILE__", &architecture.ui_file_name(name))
            .replace(
                "__CONNECTOR_FILE__",
                &architecture.connector_file_name(name),
            ),
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
            value.is_empty()
                || value.chars().next().is_some_and(|character| {
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

fn validate_scoped_store_name(name: &str, owner_name: &str) -> Result<(), StudioCoreError> {
    let owner_stem = lower_camel_owner_name(owner_name)?;
    let remainder = name.strip_prefix(&owner_stem);
    if name.len() > MAX_COMPONENT_NAME_BYTES
        || remainder.is_none()
        || remainder.is_some_and(|value| {
            value.is_empty()
                || value.chars().next().is_some_and(|character| {
                    !character.is_ascii_uppercase() && !character.is_ascii_digit()
                })
        })
    {
        return Err(StudioCoreError::InvalidProject(
            "store concern name must start with the lower-camel owner name",
        ));
    }
    let mut pascal_name = name.to_owned();
    if let Some(first) = pascal_name.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    validate_component_name(&pascal_name)
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
    architecture: &CodeProjectArchitectureConfig,
) -> Result<PathBuf, StudioCoreError> {
    validate_component_name(slot_name)?;
    let slot_slug = pascal_case_path_segment(slot_name)?;
    let slot_relative = feature_relative
        .join(&architecture.slots_directory)
        .join(slot_slug);
    validate_existing_scaffold_ui(
        root,
        &slot_relative.join(architecture.ui_file_name(slot_name)),
    )?;
    Ok(slot_relative)
}

fn validated_existing_part_relative(
    root: &Path,
    feature_relative: &Path,
    slot_name: &str,
    part_name: &str,
    architecture: &CodeProjectArchitectureConfig,
) -> Result<PathBuf, StudioCoreError> {
    let slot_relative =
        validated_existing_slot_relative(root, feature_relative, slot_name, architecture)?;
    validate_component_name(part_name)?;
    let part_slug = pascal_case_path_segment(part_name)?;
    let part_relative = slot_relative
        .join(&architecture.parts_directory)
        .join(part_slug);
    validate_existing_scaffold_ui(
        root,
        &part_relative.join(architecture.ui_file_name(part_name)),
    )?;
    Ok(part_relative)
}

fn is_shared_scaffold_capability(capability: &CodeProjectScaffoldCapability) -> bool {
    matches!(
        capability,
        CodeProjectScaffoldCapability::SharedUi { .. }
            | CodeProjectScaffoldCapability::SharedUiTypes
            | CodeProjectScaffoldCapability::SharedWidget { .. }
            | CodeProjectScaffoldCapability::SharedWidgetConnector
            | CodeProjectScaffoldCapability::SharedWidgetStore
            | CodeProjectScaffoldCapability::SharedWidgetHook
            | CodeProjectScaffoldCapability::SharedWidgetBehaviorHook { .. }
            | CodeProjectScaffoldCapability::SharedWidgetStoreSlice { .. }
            | CodeProjectScaffoldCapability::SharedWidgetLogic
            | CodeProjectScaffoldCapability::SharedWidgetApi
            | CodeProjectScaffoldCapability::SharedWidgetTypes
            | CodeProjectScaffoldCapability::SharedCapability { .. }
            | CodeProjectScaffoldCapability::SharedCapabilityStore
            | CodeProjectScaffoldCapability::SharedCapabilityHook
            | CodeProjectScaffoldCapability::SharedCapabilityBehaviorHook { .. }
            | CodeProjectScaffoldCapability::SharedCapabilityStoreSlice { .. }
            | CodeProjectScaffoldCapability::SharedCapabilityLogic
            | CodeProjectScaffoldCapability::SharedCapabilityApi
            | CodeProjectScaffoldCapability::SharedCapabilityTypes
    )
}

fn validate_existing_scaffold_directory(
    root: &Path,
    relative: &Path,
) -> Result<(), StudioCoreError> {
    if relative.components().count() > MAX_NEW_UI_DEPTH {
        return Err(StudioCoreError::InvalidProject(
            "scaffold path exceeds the supported directory depth",
        ));
    }
    let path = root.join(relative);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|source| source_io("inspect required scaffold owner", &path, source))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(StudioCoreError::InvalidProject(
            "required shared owner must be a real directory",
        ));
    }
    let canonical = fs::canonicalize(&path)
        .map_err(|source| source_io("resolve required scaffold owner", &path, source))?;
    ensure_project_containment(root, &canonical)
}

fn shared_scaffold_response(
    root: &Path,
    owner_name: String,
    owner_relative: &Path,
    capability: CodeProjectScaffoldCapability,
    files: Vec<ScaffoldedCodeProjectFile>,
) -> Result<ScaffoldedCodeProjectStructure, StudioCoreError> {
    let bytes = files.iter().map(|file| file.bytes).sum();
    Ok(ScaffoldedCodeProjectStructure {
        project_path: root.to_string_lossy().into_owned(),
        feature_name: owner_name,
        feature_path: path_to_forward_slashes(owner_relative)?,
        capability,
        files,
        bytes,
    })
}

fn scaffold_shared_code_project_structure(
    root: &Path,
    architecture: &CodeProjectArchitectureConfig,
    request: ScaffoldCodeProjectStructureRequest,
) -> Result<ScaffoldedCodeProjectStructure, StudioCoreError> {
    let name = request.feature_name.clone();
    let slug = pascal_case_path_segment(&name)?;
    let category = match &request.capability {
        CodeProjectScaffoldCapability::SharedUi { .. }
        | CodeProjectScaffoldCapability::SharedUiTypes => "ui",
        CodeProjectScaffoldCapability::SharedWidget { .. }
        | CodeProjectScaffoldCapability::SharedWidgetConnector
        | CodeProjectScaffoldCapability::SharedWidgetStore
        | CodeProjectScaffoldCapability::SharedWidgetHook
        | CodeProjectScaffoldCapability::SharedWidgetBehaviorHook { .. }
        | CodeProjectScaffoldCapability::SharedWidgetStoreSlice { .. }
        | CodeProjectScaffoldCapability::SharedWidgetLogic
        | CodeProjectScaffoldCapability::SharedWidgetApi
        | CodeProjectScaffoldCapability::SharedWidgetTypes => "widgets",
        CodeProjectScaffoldCapability::SharedCapability { .. }
        | CodeProjectScaffoldCapability::SharedCapabilityStore
        | CodeProjectScaffoldCapability::SharedCapabilityHook
        | CodeProjectScaffoldCapability::SharedCapabilityBehaviorHook { .. }
        | CodeProjectScaffoldCapability::SharedCapabilityStoreSlice { .. }
        | CodeProjectScaffoldCapability::SharedCapabilityLogic
        | CodeProjectScaffoldCapability::SharedCapabilityApi
        | CodeProjectScaffoldCapability::SharedCapabilityTypes => "capabilities",
        _ => {
            return Err(StudioCoreError::InvalidProject(
                "the requested capability is not a shared owner",
            ));
        }
    };
    let owner_relative = architecture.shared.join(category).join(slug);
    let is_composite = matches!(
        request.capability,
        CodeProjectScaffoldCapability::SharedUi { .. }
            | CodeProjectScaffoldCapability::SharedWidget { .. }
            | CodeProjectScaffoldCapability::SharedCapability { .. }
    );
    if !is_composite {
        if category == "ui" || category == "widgets" {
            validate_existing_scaffold_ui(
                root,
                &owner_relative.join(architecture.ui_file_name(&name)),
            )?;
        } else {
            validate_existing_scaffold_directory(root, &owner_relative)?;
        }
        if category == "widgets"
            && !matches!(
                request.capability,
                CodeProjectScaffoldCapability::SharedWidgetConnector
            )
        {
            validate_existing_scaffold_ui(
                root,
                &owner_relative.join(architecture.connector_file_name(&name)),
            )?;
        }
        if matches!(
            request.capability,
            CodeProjectScaffoldCapability::SharedCapabilityTypes
        ) {
            let layers = existing_owner_layers(root, &owner_relative, &name, architecture);
            if !layers.has_runtime() {
                return Err(StudioCoreError::InvalidProject(
                    "create at least one runtime Hook, Store, Logic, or API before adding Types to a Shared Headless Capability",
                ));
            }
        }
    }

    let widget_roles = OwnerFileRoles {
        connector: CodeProjectScaffoldFileRole::SharedWidgetConnector,
        hook: CodeProjectScaffoldFileRole::SharedWidgetHook,
        store: CodeProjectScaffoldFileRole::SharedWidgetStore,
        logic: CodeProjectScaffoldFileRole::SharedWidgetLogic,
        api: CodeProjectScaffoldFileRole::SharedWidgetApi,
        types: CodeProjectScaffoldFileRole::SharedWidgetTypes,
    };
    let capability_roles = OwnerFileRoles {
        connector: CodeProjectScaffoldFileRole::SharedWidgetConnector,
        hook: CodeProjectScaffoldFileRole::SharedCapabilityHook,
        store: CodeProjectScaffoldFileRole::SharedCapabilityStore,
        logic: CodeProjectScaffoldFileRole::SharedCapabilityLogic,
        api: CodeProjectScaffoldFileRole::SharedCapabilityApi,
        types: CodeProjectScaffoldFileRole::SharedCapabilityTypes,
    };
    let mut plans = Vec::new();
    match &request.capability {
        CodeProjectScaffoldCapability::SharedUi { create_types } => {
            plans.push(scaffold_file_plan(
                owner_relative.join(architecture.ui_file_name(&name)),
                CodeProjectScaffoldFileRole::SharedUi,
                shared_primitive_ui_source(&name, *create_types, architecture),
            ));
            if *create_types {
                plans.push(scaffold_file_plan(
                    owner_relative.join(architecture.types_file_name(&name)),
                    CodeProjectScaffoldFileRole::SharedUiTypes,
                    shared_primitive_types_source(&name),
                ));
            }
        }
        CodeProjectScaffoldCapability::SharedUiTypes => plans.push(scaffold_file_plan(
            owner_relative.join(architecture.types_file_name(&name)),
            CodeProjectScaffoldFileRole::SharedUiTypes,
            shared_primitive_types_source(&name),
        )),
        CodeProjectScaffoldCapability::SharedWidget {
            create_connector,
            create_hook,
            create_store,
            create_logic,
            create_api,
            create_types,
        } => {
            if !create_connector {
                return Err(StudioCoreError::InvalidProject(
                    "every Shared Widget requires its matching Connector",
                ));
            }
            plans.push(scaffold_file_plan(
                owner_relative.join(architecture.ui_file_name(&name)),
                CodeProjectScaffoldFileRole::SharedWidgetUi,
                shared_widget_ui_source(&name),
            ));
            append_shared_owner_capability_plans(
                &mut plans,
                &owner_relative,
                &name,
                widget_roles,
                OwnerLayerSelection {
                    hook: *create_hook,
                    store: *create_store,
                    logic: *create_logic,
                    api: *create_api,
                    types: *create_types,
                },
                true,
                architecture,
            )?;
        }
        CodeProjectScaffoldCapability::SharedWidgetConnector => {
            let layers = existing_owner_layers(root, &owner_relative, &name, architecture);
            plans.push(scaffold_file_plan(
                owner_relative.join(architecture.connector_file_name(&name)),
                CodeProjectScaffoldFileRole::SharedWidgetConnector,
                canonical_shared_runtime_source_for_new_file(
                    root,
                    &owner_relative,
                    &name,
                    OwnerRuntimeLayer::Connector,
                    layers,
                    architecture,
                ),
            ));
        }
        CodeProjectScaffoldCapability::SharedWidgetHook => {
            let layers = existing_owner_layers(root, &owner_relative, &name, architecture);
            plans.push(scaffold_file_plan(
                owner_relative.join(architecture.hook_file_name(&name)),
                CodeProjectScaffoldFileRole::SharedWidgetHook,
                canonical_shared_runtime_source_for_new_file(
                    root,
                    &owner_relative,
                    &name,
                    OwnerRuntimeLayer::Hook,
                    layers,
                    architecture,
                ),
            ));
        }
        CodeProjectScaffoldCapability::SharedWidgetStore => {
            let layers = existing_owner_layers(root, &owner_relative, &name, architecture);
            plans.push(scaffold_file_plan(
                owner_relative.join(architecture.store_file_name(&name)),
                CodeProjectScaffoldFileRole::SharedWidgetStore,
                canonical_shared_runtime_source_for_new_file(
                    root,
                    &owner_relative,
                    &name,
                    OwnerRuntimeLayer::Store,
                    layers,
                    architecture,
                ),
            ));
        }
        CodeProjectScaffoldCapability::SharedWidgetLogic => {
            let layers = existing_owner_layers(root, &owner_relative, &name, architecture);
            plans.push(scaffold_file_plan(
                owner_relative.join(architecture.logic_file_name(&name)),
                CodeProjectScaffoldFileRole::SharedWidgetLogic,
                canonical_shared_runtime_source_for_new_file(
                    root,
                    &owner_relative,
                    &name,
                    OwnerRuntimeLayer::Logic,
                    layers,
                    architecture,
                ),
            ));
        }
        CodeProjectScaffoldCapability::SharedWidgetApi => {
            let layers = existing_owner_layers(root, &owner_relative, &name, architecture);
            plans.push(scaffold_file_plan(
                owner_relative.join(architecture.api_file_name(&name)),
                CodeProjectScaffoldFileRole::SharedWidgetApi,
                canonical_shared_runtime_source_for_new_file(
                    root,
                    &owner_relative,
                    &name,
                    OwnerRuntimeLayer::Api,
                    layers,
                    architecture,
                ),
            ));
        }
        CodeProjectScaffoldCapability::SharedWidgetTypes => plans.push(scaffold_file_plan(
            owner_relative.join(architecture.types_file_name(&name)),
            CodeProjectScaffoldFileRole::SharedWidgetTypes,
            shared_owner_types_source(&name),
        )),
        CodeProjectScaffoldCapability::SharedWidgetBehaviorHook { hook_name } => {
            validate_scoped_hook_name(hook_name, &name)?;
            let files = expand_owner_capability(
                root,
                architecture,
                &owner_relative,
                &name,
                ExpandedOwnerCapability::Hook,
                hook_name,
                CodeProjectScaffoldFileRole::SharedWidgetHook,
            )?;
            return shared_scaffold_response(
                root,
                name,
                &owner_relative,
                request.capability,
                files,
            );
        }
        CodeProjectScaffoldCapability::SharedWidgetStoreSlice { store_name } => {
            validate_scoped_store_name(store_name, &name)?;
            let files = expand_owner_capability(
                root,
                architecture,
                &owner_relative,
                &name,
                ExpandedOwnerCapability::Store,
                store_name,
                CodeProjectScaffoldFileRole::SharedWidgetStore,
            )?;
            return shared_scaffold_response(
                root,
                name,
                &owner_relative,
                request.capability,
                files,
            );
        }
        CodeProjectScaffoldCapability::SharedCapability {
            create_hook,
            create_store,
            create_logic,
            create_api,
            create_types,
        } => {
            if !create_hook && !create_store && !create_logic && !create_api {
                return Err(StudioCoreError::InvalidProject(
                    "a Shared Headless Capability requires at least one runtime layer",
                ));
            }
            append_shared_owner_capability_plans(
                &mut plans,
                &owner_relative,
                &name,
                capability_roles,
                OwnerLayerSelection {
                    hook: *create_hook,
                    store: *create_store,
                    logic: *create_logic,
                    api: *create_api,
                    types: *create_types,
                },
                false,
                architecture,
            )?;
        }
        CodeProjectScaffoldCapability::SharedCapabilityHook => {
            let layers = existing_owner_layers(root, &owner_relative, &name, architecture);
            plans.push(scaffold_file_plan(
                owner_relative.join(architecture.hook_file_name(&name)),
                CodeProjectScaffoldFileRole::SharedCapabilityHook,
                canonical_shared_runtime_source_for_new_file(
                    root,
                    &owner_relative,
                    &name,
                    OwnerRuntimeLayer::Hook,
                    layers,
                    architecture,
                ),
            ));
        }
        CodeProjectScaffoldCapability::SharedCapabilityStore => {
            let layers = existing_owner_layers(root, &owner_relative, &name, architecture);
            plans.push(scaffold_file_plan(
                owner_relative.join(architecture.store_file_name(&name)),
                CodeProjectScaffoldFileRole::SharedCapabilityStore,
                canonical_shared_runtime_source_for_new_file(
                    root,
                    &owner_relative,
                    &name,
                    OwnerRuntimeLayer::Store,
                    layers,
                    architecture,
                ),
            ));
        }
        CodeProjectScaffoldCapability::SharedCapabilityLogic => {
            let layers = existing_owner_layers(root, &owner_relative, &name, architecture);
            plans.push(scaffold_file_plan(
                owner_relative.join(architecture.logic_file_name(&name)),
                CodeProjectScaffoldFileRole::SharedCapabilityLogic,
                canonical_shared_runtime_source_for_new_file(
                    root,
                    &owner_relative,
                    &name,
                    OwnerRuntimeLayer::Logic,
                    layers,
                    architecture,
                ),
            ));
        }
        CodeProjectScaffoldCapability::SharedCapabilityApi => {
            let layers = existing_owner_layers(root, &owner_relative, &name, architecture);
            plans.push(scaffold_file_plan(
                owner_relative.join(architecture.api_file_name(&name)),
                CodeProjectScaffoldFileRole::SharedCapabilityApi,
                canonical_shared_runtime_source_for_new_file(
                    root,
                    &owner_relative,
                    &name,
                    OwnerRuntimeLayer::Api,
                    layers,
                    architecture,
                ),
            ));
        }
        CodeProjectScaffoldCapability::SharedCapabilityTypes => plans.push(scaffold_file_plan(
            owner_relative.join(architecture.types_file_name(&name)),
            CodeProjectScaffoldFileRole::SharedCapabilityTypes,
            shared_owner_types_source(&name),
        )),
        CodeProjectScaffoldCapability::SharedCapabilityBehaviorHook { hook_name } => {
            validate_scoped_hook_name(hook_name, &name)?;
            let files = expand_owner_capability(
                root,
                architecture,
                &owner_relative,
                &name,
                ExpandedOwnerCapability::Hook,
                hook_name,
                CodeProjectScaffoldFileRole::SharedCapabilityHook,
            )?;
            return shared_scaffold_response(
                root,
                name,
                &owner_relative,
                request.capability,
                files,
            );
        }
        CodeProjectScaffoldCapability::SharedCapabilityStoreSlice { store_name } => {
            validate_scoped_store_name(store_name, &name)?;
            let files = expand_owner_capability(
                root,
                architecture,
                &owner_relative,
                &name,
                ExpandedOwnerCapability::Store,
                store_name,
                CodeProjectScaffoldFileRole::SharedCapabilityStore,
            )?;
            return shared_scaffold_response(
                root,
                name,
                &owner_relative,
                request.capability,
                files,
            );
        }
        _ => {
            return Err(StudioCoreError::InvalidProject(
                "the requested capability is not valid inside the configured Shared root",
            ));
        }
    }
    let senior_update = if matches!(
        &request.capability,
        CodeProjectScaffoldCapability::SharedUiTypes
    ) {
        standalone_shared_primitive_types_update(root, &owner_relative, &name, architecture)?
    } else {
        standalone_shared_senior_update(
            root,
            &owner_relative,
            &name,
            &request.capability,
            architecture,
        )?
    };
    let files = create_scaffold_files(root, plans)?;
    apply_scaffold_source_update(&files, senior_update, "shared runtime gateway")?;
    shared_scaffold_response(root, name, &owner_relative, request.capability, files)
}

fn connector_source(name: &str, architecture: &CodeProjectArchitectureConfig) -> String {
    let ui_module = architecture.ui_module(name);
    format!(
        "import type {{ ComponentProps }} from 'react';\n\nimport {{ {name}UI }} from '{ui_module}';\n\nexport type {name}ConnectorProps = ComponentProps<typeof {name}UI>;\n\nexport function {name}Connector(props: {name}ConnectorProps) {{\n  return <{name}UI {{...props}} />;\n}}\n"
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

impl OwnerLayerSelection {
    fn has_runtime(self) -> bool {
        self.hook || self.store || self.logic || self.api
    }

    fn with_runtime_layer(mut self, layer: OwnerRuntimeLayer) -> Self {
        match layer {
            OwnerRuntimeLayer::Connector => {}
            OwnerRuntimeLayer::Hook => self.hook = true,
            OwnerRuntimeLayer::Store => self.store = true,
            OwnerRuntimeLayer::Logic => self.logic = true,
            OwnerRuntimeLayer::Api => self.api = true,
            OwnerRuntimeLayer::Types => self.types = true,
        }
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OwnerRuntimeLayer {
    Connector,
    Hook,
    Store,
    Logic,
    Api,
    Types,
}

#[derive(Debug)]
struct ScaffoldSourceUpdate {
    path: PathBuf,
    previous_source: String,
    next_source: String,
}

fn standalone_shared_runtime_layer(
    capability: &CodeProjectScaffoldCapability,
) -> Option<OwnerRuntimeLayer> {
    match capability {
        CodeProjectScaffoldCapability::SharedWidgetConnector => Some(OwnerRuntimeLayer::Connector),
        CodeProjectScaffoldCapability::SharedWidgetHook
        | CodeProjectScaffoldCapability::SharedCapabilityHook => Some(OwnerRuntimeLayer::Hook),
        CodeProjectScaffoldCapability::SharedWidgetStore
        | CodeProjectScaffoldCapability::SharedCapabilityStore => Some(OwnerRuntimeLayer::Store),
        CodeProjectScaffoldCapability::SharedWidgetLogic
        | CodeProjectScaffoldCapability::SharedCapabilityLogic => Some(OwnerRuntimeLayer::Logic),
        CodeProjectScaffoldCapability::SharedWidgetApi
        | CodeProjectScaffoldCapability::SharedCapabilityApi => Some(OwnerRuntimeLayer::Api),
        CodeProjectScaffoldCapability::SharedWidgetTypes
        | CodeProjectScaffoldCapability::SharedCapabilityTypes => Some(OwnerRuntimeLayer::Types),
        _ => None,
    }
}

fn standalone_progressive_runtime_layer(
    capability: &CodeProjectScaffoldCapability,
) -> Option<OwnerRuntimeLayer> {
    match capability {
        CodeProjectScaffoldCapability::FeatureConnector
        | CodeProjectScaffoldCapability::SlotConnector { .. }
        | CodeProjectScaffoldCapability::PartConnector { .. } => Some(OwnerRuntimeLayer::Connector),
        CodeProjectScaffoldCapability::FeatureHook
        | CodeProjectScaffoldCapability::SlotHook { .. }
        | CodeProjectScaffoldCapability::PartHook { .. } => Some(OwnerRuntimeLayer::Hook),
        CodeProjectScaffoldCapability::FeatureStore
        | CodeProjectScaffoldCapability::SlotStore { .. }
        | CodeProjectScaffoldCapability::PartStore { .. } => Some(OwnerRuntimeLayer::Store),
        CodeProjectScaffoldCapability::FeatureLogic
        | CodeProjectScaffoldCapability::SlotLogic { .. }
        | CodeProjectScaffoldCapability::PartLogic { .. } => Some(OwnerRuntimeLayer::Logic),
        CodeProjectScaffoldCapability::FeatureApi
        | CodeProjectScaffoldCapability::SlotApi { .. }
        | CodeProjectScaffoldCapability::PartApi { .. } => Some(OwnerRuntimeLayer::Api),
        _ => None,
    }
}

fn standalone_progressive_owner<'a>(
    feature_relative: &Path,
    feature_name: &'a str,
    capability: &'a CodeProjectScaffoldCapability,
    architecture: &CodeProjectArchitectureConfig,
) -> Result<Option<(PathBuf, &'a str)>, StudioCoreError> {
    match capability {
        CodeProjectScaffoldCapability::FeatureConnector
        | CodeProjectScaffoldCapability::FeatureHook
        | CodeProjectScaffoldCapability::FeatureStore
        | CodeProjectScaffoldCapability::FeatureLogic
        | CodeProjectScaffoldCapability::FeatureApi => {
            Ok(Some((feature_relative.to_path_buf(), feature_name)))
        }
        CodeProjectScaffoldCapability::SlotConnector { slot_name }
        | CodeProjectScaffoldCapability::SlotHook { slot_name }
        | CodeProjectScaffoldCapability::SlotStore { slot_name }
        | CodeProjectScaffoldCapability::SlotLogic { slot_name }
        | CodeProjectScaffoldCapability::SlotApi { slot_name } => Ok(Some((
            feature_relative
                .join(&architecture.slots_directory)
                .join(pascal_case_path_segment(slot_name)?),
            slot_name,
        ))),
        CodeProjectScaffoldCapability::PartConnector {
            slot_name,
            part_name,
        }
        | CodeProjectScaffoldCapability::PartHook {
            slot_name,
            part_name,
        }
        | CodeProjectScaffoldCapability::PartStore {
            slot_name,
            part_name,
        }
        | CodeProjectScaffoldCapability::PartLogic {
            slot_name,
            part_name,
        }
        | CodeProjectScaffoldCapability::PartApi {
            slot_name,
            part_name,
        } => Ok(Some((
            feature_relative
                .join(&architecture.slots_directory)
                .join(pascal_case_path_segment(slot_name)?)
                .join(&architecture.parts_directory)
                .join(pascal_case_path_segment(part_name)?),
            part_name,
        ))),
        _ => Ok(None),
    }
}

fn owner_runtime_layer_relative(
    root: &Path,
    owner_relative: &Path,
    owner_name: &str,
    layer: OwnerRuntimeLayer,
    architecture: &CodeProjectArchitectureConfig,
) -> Option<PathBuf> {
    let flat_name = match layer {
        OwnerRuntimeLayer::Connector => architecture.connector_file_name(owner_name),
        OwnerRuntimeLayer::Hook => architecture.hook_file_name(owner_name),
        OwnerRuntimeLayer::Store => architecture.store_file_name(owner_name),
        OwnerRuntimeLayer::Logic => architecture.logic_file_name(owner_name),
        OwnerRuntimeLayer::Api => architecture.api_file_name(owner_name),
        OwnerRuntimeLayer::Types => architecture.types_file_name(owner_name),
    };
    let flat = owner_relative.join(&flat_name);
    if root.join(&flat).is_file() {
        return Some(flat);
    }
    let expanded = match layer {
        OwnerRuntimeLayer::Hook => Some(
            owner_relative
                .join(&architecture.hooks_directory)
                .join(flat_name),
        ),
        OwnerRuntimeLayer::Store => Some(
            owner_relative
                .join(&architecture.stores_directory)
                .join(flat_name),
        ),
        OwnerRuntimeLayer::Connector
        | OwnerRuntimeLayer::Logic
        | OwnerRuntimeLayer::Api
        | OwnerRuntimeLayer::Types => None,
    };
    expanded.filter(|path| root.join(path).is_file())
}

fn runtime_layer_is_expanded(owner_relative: &Path, path: &Path) -> bool {
    path.parent().is_some_and(|parent| parent != owner_relative)
}

fn canonical_owner_runtime_source(
    root: &Path,
    owner_relative: &Path,
    owner_name: &str,
    layer: OwnerRuntimeLayer,
    layers: OwnerLayerSelection,
    layer_path: &Path,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    let mut source = match layer {
        OwnerRuntimeLayer::Connector => {
            shared_owner_connector_source(owner_name, layers, architecture)
        }
        OwnerRuntimeLayer::Hook => shared_owner_hook_source(owner_name, layers, architecture),
        OwnerRuntimeLayer::Store => shared_owner_store_source(owner_name, layers, architecture),
        OwnerRuntimeLayer::Logic => shared_owner_logic_source(owner_name, layers, architecture),
        OwnerRuntimeLayer::Api => shared_owner_api_source(owner_name, layers, architecture),
        OwnerRuntimeLayer::Types => shared_owner_types_source(owner_name),
    };
    if layer == OwnerRuntimeLayer::Connector {
        if owner_runtime_layer_relative(
            root,
            owner_relative,
            owner_name,
            OwnerRuntimeLayer::Hook,
            architecture,
        )
        .is_some_and(|path| runtime_layer_is_expanded(owner_relative, &path))
        {
            source = source.replace(
                &format!("from '{}'", architecture.hook_module(owner_name)),
                &format!(
                    "from './{}/{}'",
                    architecture.hooks_directory,
                    architecture
                        .hook_file_name(owner_name)
                        .trim_end_matches(".ts")
                ),
            );
        }
        if owner_runtime_layer_relative(
            root,
            owner_relative,
            owner_name,
            OwnerRuntimeLayer::Store,
            architecture,
        )
        .is_some_and(|path| runtime_layer_is_expanded(owner_relative, &path))
        {
            source = source.replace(
                &format!("from '{}'", architecture.store_module(owner_name)),
                &format!(
                    "from './{}/{}'",
                    architecture.stores_directory,
                    architecture
                        .store_file_name(owner_name)
                        .trim_end_matches(".ts")
                ),
            );
        }
    }
    if layer == OwnerRuntimeLayer::Hook
        && owner_runtime_layer_relative(
            root,
            owner_relative,
            owner_name,
            OwnerRuntimeLayer::Store,
            architecture,
        )
        .is_some_and(|path| runtime_layer_is_expanded(owner_relative, &path))
    {
        source = source.replace(
            &format!("from '{}'", architecture.store_module(owner_name)),
            &format!(
                "from './{}/{}'",
                architecture.stores_directory,
                architecture
                    .store_file_name(owner_name)
                    .trim_end_matches(".ts")
            ),
        );
    }
    if runtime_layer_is_expanded(owner_relative, layer_path) {
        source = relocate_gateway_source_one_level(&source);
    }
    source
}

fn canonical_shared_runtime_source_for_new_file(
    root: &Path,
    owner_relative: &Path,
    owner_name: &str,
    layer: OwnerRuntimeLayer,
    layers: OwnerLayerSelection,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    let relative = owner_relative.join(match layer {
        OwnerRuntimeLayer::Connector => architecture.connector_file_name(owner_name),
        OwnerRuntimeLayer::Hook => architecture.hook_file_name(owner_name),
        OwnerRuntimeLayer::Store => architecture.store_file_name(owner_name),
        OwnerRuntimeLayer::Logic => architecture.logic_file_name(owner_name),
        OwnerRuntimeLayer::Api => architecture.api_file_name(owner_name),
        OwnerRuntimeLayer::Types => architecture.types_file_name(owner_name),
    });
    canonical_owner_runtime_source(
        root,
        owner_relative,
        owner_name,
        layer,
        layers,
        &relative,
        architecture,
    )
}

fn safely_preserve_gateway_exports(
    current: &str,
    previous_canonical: &str,
    next_canonical: &str,
) -> Option<String> {
    if current == previous_canonical {
        return Some(next_canonical.to_owned());
    }
    let previous_body = previous_canonical.trim_end();
    let suffix = current.strip_prefix(previous_body)?;
    let safe = suffix.lines().all(|line| {
        let line = line.trim();
        line.is_empty()
            || (line.starts_with("export { ")
                && line.contains(" } from './")
                && (line.ends_with("';") || line.ends_with("\";")))
    });
    safe.then(|| format!("{}{}", next_canonical.trim_end(), suffix))
}

fn standalone_shared_primitive_types_update(
    root: &Path,
    owner_relative: &Path,
    owner_name: &str,
    architecture: &CodeProjectArchitectureConfig,
) -> Result<Option<ScaffoldSourceUpdate>, StudioCoreError> {
    let relative = owner_relative.join(architecture.ui_file_name(owner_name));
    let path = root.join(relative);
    let current =
        read_regular_utf8_file(&path, MAX_ARCHITECTURE_SOURCE_BYTES, "shared primitive UI")?;
    let previous_canonical = shared_primitive_ui_source(owner_name, false, architecture);
    let next_canonical = shared_primitive_ui_source(owner_name, true, architecture);
    if current == next_canonical {
        return Ok(None);
    }
    if current != previous_canonical {
        return Err(StudioCoreError::InvalidProject(
            "the Shared UI Primitive contains custom code; move its inline props contract into Types in one reviewed edit",
        ));
    }
    Ok(Some(ScaffoldSourceUpdate {
        path,
        previous_source: current,
        next_source: next_canonical,
    }))
}

fn standalone_shared_senior_update(
    root: &Path,
    owner_relative: &Path,
    owner_name: &str,
    capability: &CodeProjectScaffoldCapability,
    architecture: &CodeProjectArchitectureConfig,
) -> Result<Option<ScaffoldSourceUpdate>, StudioCoreError> {
    let Some(new_layer) = standalone_shared_runtime_layer(capability) else {
        return Ok(None);
    };
    let order = [
        OwnerRuntimeLayer::Connector,
        OwnerRuntimeLayer::Hook,
        OwnerRuntimeLayer::Store,
        OwnerRuntimeLayer::Logic,
        OwnerRuntimeLayer::Api,
        OwnerRuntimeLayer::Types,
    ];
    let Some(new_index) = order.iter().position(|candidate| *candidate == new_layer) else {
        return Ok(None);
    };
    let senior = if new_layer == OwnerRuntimeLayer::Types {
        owner_runtime_layer_relative(
            root,
            owner_relative,
            owner_name,
            OwnerRuntimeLayer::Api,
            architecture,
        )
        .map(|path| (OwnerRuntimeLayer::Api, path))
    } else {
        order[..new_index].iter().rev().find_map(|candidate| {
            owner_runtime_layer_relative(root, owner_relative, owner_name, *candidate, architecture)
                .map(|path| (*candidate, path))
        })
    };
    let Some((senior_layer, senior_relative)) = senior else {
        return Ok(None);
    };

    let previous_layers = existing_owner_layers(root, owner_relative, owner_name, architecture);
    let next_layers = previous_layers.with_runtime_layer(new_layer);
    let previous_canonical = canonical_owner_runtime_source(
        root,
        owner_relative,
        owner_name,
        senior_layer,
        previous_layers,
        &senior_relative,
        architecture,
    );
    let next_canonical = canonical_owner_runtime_source(
        root,
        owner_relative,
        owner_name,
        senior_layer,
        next_layers,
        &senior_relative,
        architecture,
    );
    if previous_canonical == next_canonical {
        return Ok(None);
    }
    let path = root.join(&senior_relative);
    let current = read_regular_utf8_file(
        &path,
        MAX_ARCHITECTURE_SOURCE_BYTES,
        "shared runtime gateway",
    )?;
    if current == next_canonical {
        return Ok(None);
    }
    let Some(next_source) =
        safely_preserve_gateway_exports(&current, &previous_canonical, &next_canonical)
    else {
        if senior_layer == OwnerRuntimeLayer::Connector {
            return Err(StudioCoreError::InvalidProject(
                "the Shared Widget Connector contains custom code; connect the new runtime boundary in one reviewed edit",
            ));
        }
        return Ok(None);
    };
    Ok(Some(ScaffoldSourceUpdate {
        path,
        previous_source: current,
        next_source,
    }))
}

fn canonical_progressive_runtime_source(
    root: &Path,
    owner_relative: &Path,
    owner_name: &str,
    layer: OwnerRuntimeLayer,
    layers: OwnerLayerSelection,
    layer_path: &Path,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    let mut source = match layer {
        OwnerRuntimeLayer::Connector => {
            progressive_connector_source(owner_name, layers, architecture)
        }
        OwnerRuntimeLayer::Hook => progressive_hook_source(owner_name, layers, architecture),
        OwnerRuntimeLayer::Store => progressive_store_source(owner_name, layers, architecture),
        OwnerRuntimeLayer::Logic => progressive_logic_source(owner_name, layers, architecture),
        OwnerRuntimeLayer::Api => progressive_api_source(owner_name),
        OwnerRuntimeLayer::Types => owner_types_source(owner_name),
    };
    if layer == OwnerRuntimeLayer::Connector {
        if owner_runtime_layer_relative(
            root,
            owner_relative,
            owner_name,
            OwnerRuntimeLayer::Hook,
            architecture,
        )
        .is_some_and(|path| runtime_layer_is_expanded(owner_relative, &path))
        {
            source = source.replace(
                &format!("from '{}'", architecture.hook_module(owner_name)),
                &format!(
                    "from './{}/{}'",
                    architecture.hooks_directory,
                    architecture
                        .hook_file_name(owner_name)
                        .trim_end_matches(".ts")
                ),
            );
        }
        if owner_runtime_layer_relative(
            root,
            owner_relative,
            owner_name,
            OwnerRuntimeLayer::Store,
            architecture,
        )
        .is_some_and(|path| runtime_layer_is_expanded(owner_relative, &path))
        {
            source = source.replace(
                &format!("from '{}'", architecture.store_module(owner_name)),
                &format!(
                    "from './{}/{}'",
                    architecture.stores_directory,
                    architecture
                        .store_file_name(owner_name)
                        .trim_end_matches(".ts")
                ),
            );
        }
    }
    if layer == OwnerRuntimeLayer::Hook
        && owner_runtime_layer_relative(
            root,
            owner_relative,
            owner_name,
            OwnerRuntimeLayer::Store,
            architecture,
        )
        .is_some_and(|path| runtime_layer_is_expanded(owner_relative, &path))
    {
        source = source.replace(
            &format!("from '{}'", architecture.store_module(owner_name)),
            &format!(
                "from './{}/{}'",
                architecture.stores_directory,
                architecture
                    .store_file_name(owner_name)
                    .trim_end_matches(".ts")
            ),
        );
    }
    if runtime_layer_is_expanded(owner_relative, layer_path) {
        source = relocate_gateway_source_one_level(&source);
    }
    source
}

fn canonical_progressive_runtime_source_for_new_file(
    root: &Path,
    owner_relative: &Path,
    owner_name: &str,
    layer: OwnerRuntimeLayer,
    layers: OwnerLayerSelection,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    let relative = owner_relative.join(match layer {
        OwnerRuntimeLayer::Connector => architecture.connector_file_name(owner_name),
        OwnerRuntimeLayer::Hook => architecture.hook_file_name(owner_name),
        OwnerRuntimeLayer::Store => architecture.store_file_name(owner_name),
        OwnerRuntimeLayer::Logic => architecture.logic_file_name(owner_name),
        OwnerRuntimeLayer::Api => architecture.api_file_name(owner_name),
        OwnerRuntimeLayer::Types => architecture.types_file_name(owner_name),
    });
    canonical_progressive_runtime_source(
        root,
        owner_relative,
        owner_name,
        layer,
        layers,
        &relative,
        architecture,
    )
}

fn standalone_progressive_senior_update(
    root: &Path,
    owner_relative: &Path,
    owner_name: &str,
    new_layer: OwnerRuntimeLayer,
    architecture: &CodeProjectArchitectureConfig,
) -> Result<Option<ScaffoldSourceUpdate>, StudioCoreError> {
    let order = [
        OwnerRuntimeLayer::Connector,
        OwnerRuntimeLayer::Hook,
        OwnerRuntimeLayer::Store,
        OwnerRuntimeLayer::Logic,
        OwnerRuntimeLayer::Api,
    ];
    let Some(new_index) = order.iter().position(|candidate| *candidate == new_layer) else {
        return Ok(None);
    };
    let Some((senior_layer, senior_relative)) =
        order[..new_index].iter().rev().find_map(|candidate| {
            owner_runtime_layer_relative(root, owner_relative, owner_name, *candidate, architecture)
                .map(|path| (*candidate, path))
        })
    else {
        return Ok(None);
    };

    let previous_layers = existing_owner_layers(root, owner_relative, owner_name, architecture);
    let next_layers = previous_layers.with_runtime_layer(new_layer);
    let previous_canonical = canonical_progressive_runtime_source(
        root,
        owner_relative,
        owner_name,
        senior_layer,
        previous_layers,
        &senior_relative,
        architecture,
    );
    let next_canonical = canonical_progressive_runtime_source(
        root,
        owner_relative,
        owner_name,
        senior_layer,
        next_layers,
        &senior_relative,
        architecture,
    );
    if previous_canonical == next_canonical {
        return Ok(None);
    }

    let path = root.join(&senior_relative);
    let current = read_regular_utf8_file(
        &path,
        MAX_ARCHITECTURE_SOURCE_BYTES,
        "owner runtime gateway",
    )?;
    if current == next_canonical {
        return Ok(None);
    }
    let Some(next_source) =
        safely_preserve_gateway_exports(&current, &previous_canonical, &next_canonical)
    else {
        if senior_layer == OwnerRuntimeLayer::Connector {
            return Err(StudioCoreError::InvalidProject(
                "the owner Connector contains custom code; connect the new runtime boundary in one reviewed edit",
            ));
        }
        // Preserve a custom Hook, Store, Logic, or API byte-for-byte, matching
        // the canonical planner. Architecture validation still rejects a
        // custom boundary if it jumps over the newly-created lower layer.
        return Ok(None);
    };
    Ok(Some(ScaffoldSourceUpdate {
        path,
        previous_source: current,
        next_source,
    }))
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

fn progressive_connector_source(
    name: &str,
    layers: OwnerLayerSelection,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    let (import, access) = if layers.hook {
        (
            format!(
                "import {{ use{name} }} from '{}';\n",
                architecture.hook_module(name)
            ),
            format!("const {{ ready, run }} = use{name}();"),
        )
    } else if layers.store {
        (
            format!(
                "import {{ use{name}Store }} from '{}';\n",
                architecture.store_module(name)
            ),
            format!(
                "const ready = use{name}Store((state) => state.ready);\n  const run = use{name}Store((state) => state.run);"
            ),
        )
    } else if layers.logic {
        (
            format!(
                "import {{ useCallback, useState }} from 'react';\n\nimport {{ run{name}Logic }} from '{}';\n",
                architecture.logic_module(name)
            ),
            format!(
                "const [ready, setReady] = useState(false);\n  const run = useCallback(async () => setReady(await run{name}Logic()), []);"
            ),
        )
    } else if layers.api {
        (
            format!(
                "import {{ useCallback, useState }} from 'react';\n\nimport {{ load{name}FromApi }} from '{}';\n",
                architecture.api_module(name)
            ),
            format!(
                "const [ready, setReady] = useState(false);\n  const run = useCallback(async () => setReady(await load{name}FromApi()), []);"
            ),
        )
    } else {
        return connector_source(name, architecture);
    };

    let ui_module = architecture.ui_module(name);

    format!(
        "{import}\nimport {{ {name}UI }} from '{ui_module}';\n\nexport function {name}Connector() {{\n  {access}\n\n  return <{name}UI ready={{ready}} onRun={{() => void run()}} />;\n}}\n"
    )
}

fn progressive_hook_source(
    name: &str,
    layers: OwnerLayerSelection,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    if layers.store {
        return format!(
            "import {{ use{name}Store }} from '{}';\n\nexport function use{name}() {{\n  const ready = use{name}Store((state) => state.ready);\n  const run = use{name}Store((state) => state.run);\n\n  return {{ ready, run }};\n}}\n",
            architecture.store_module(name)
        );
    }

    let (import, operation) = if layers.logic {
        (
            format!(
                "import {{ run{name}Logic }} from '{}';",
                architecture.logic_module(name)
            ),
            format!("run{name}Logic"),
        )
    } else if layers.api {
        (
            format!(
                "import {{ load{name}FromApi }} from '{}';",
                architecture.api_module(name)
            ),
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

fn progressive_store_source(
    name: &str,
    layers: OwnerLayerSelection,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    let (import, run_body) = if layers.logic {
        (
            format!(
                "import {{ run{name}Logic }} from '{}';\n",
                architecture.logic_module(name)
            ),
            format!("const ready = await run{name}Logic();\n    set({{ ready }});"),
        )
    } else if layers.api {
        (
            format!(
                "import {{ load{name}FromApi }} from '{}';\n",
                architecture.api_module(name)
            ),
            format!("const ready = await load{name}FromApi();\n    set({{ ready }});"),
        )
    } else {
        (String::new(), "set({ ready: true });".to_owned())
    };

    format!(
        "import {{ create }} from 'zustand';\n{import}\nexport interface {name}State {{\n  ready: boolean;\n  run: () => Promise<void>;\n}}\n\nexport const use{name}Store = create<{name}State>((set) => ({{\n  ready: false,\n  run: async () => {{\n    {run_body}\n  }},\n}}));\n"
    )
}

fn progressive_logic_source(
    name: &str,
    layers: OwnerLayerSelection,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    if layers.api {
        return format!(
            "import {{ load{name}FromApi }} from '{}';\n\nexport async function run{name}Logic(): Promise<boolean> {{\n  const ready = await load{name}FromApi();\n\n  // Keep {name} business rules, validation, and transformations here.\n  return ready;\n}}\n",
            architecture.api_module(name)
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

fn append_shared_owner_capability_plans(
    plans: &mut Vec<ScaffoldFilePlan>,
    relative: &Path,
    name: &str,
    roles: OwnerFileRoles,
    layers: OwnerLayerSelection,
    create_connector: bool,
    architecture: &CodeProjectArchitectureConfig,
) -> Result<(), StudioCoreError> {
    // Keep public plan order identical to the canonical TypeScript planner:
    // UI (owned by the caller), Types, API, Logic, Store, Hook, Connector.
    if layers.types {
        plans.push(scaffold_file_plan(
            relative.join(architecture.types_file_name(name)),
            roles.types,
            shared_owner_types_source(name),
        ));
    }
    if layers.api {
        plans.push(scaffold_file_plan(
            relative.join(architecture.api_file_name(name)),
            roles.api,
            shared_owner_api_source(name, layers, architecture),
        ));
    }
    if layers.logic {
        plans.push(scaffold_file_plan(
            relative.join(architecture.logic_file_name(name)),
            roles.logic,
            shared_owner_logic_source(name, layers, architecture),
        ));
    }
    if layers.store {
        plans.push(scaffold_file_plan(
            relative.join(architecture.store_file_name(name)),
            roles.store,
            shared_owner_store_source(name, layers, architecture),
        ));
    }
    if layers.hook {
        plans.push(scaffold_file_plan(
            relative.join(architecture.hook_file_name(name)),
            roles.hook,
            shared_owner_hook_source(name, layers, architecture),
        ));
    }
    if create_connector {
        plans.push(scaffold_file_plan(
            relative.join(architecture.connector_file_name(name)),
            roles.connector,
            shared_owner_connector_source(name, layers, architecture),
        ));
    }
    Ok(())
}

fn append_owner_capability_plans(
    plans: &mut Vec<ScaffoldFilePlan>,
    relative: &Path,
    name: &str,
    roles: OwnerFileRoles,
    layers: OwnerLayerSelection,
    create_connector: bool,
    legacy_hook_name: Option<&str>,
    architecture: &CodeProjectArchitectureConfig,
) -> Result<(), StudioCoreError> {
    if legacy_hook_name.is_some() && !layers.hook {
        return Err(StudioCoreError::InvalidProject(
            "a private Hook requires its canonical owner Hook gateway",
        ));
    }
    let expanded_hook = legacy_hook_name.is_some();
    if create_connector {
        let mut source = progressive_connector_source(name, layers, architecture);
        if expanded_hook {
            source = source.replace(
                &format!("from '{}'", architecture.hook_module(name)),
                &format!(
                    "from './{}/{}'",
                    architecture.hooks_directory,
                    architecture.hook_file_name(name).trim_end_matches(".ts")
                ),
            );
        }
        plans.push(scaffold_file_plan(
            relative.join(architecture.connector_file_name(name)),
            roles.connector,
            source,
        ));
    }
    if layers.hook {
        let source = progressive_hook_source(name, layers, architecture);
        let source = if let Some(hook_name) = legacy_hook_name {
            append_gateway_export(
                &relocate_gateway_source_one_level(&source),
                &format!("export {{ {hook_name} }} from './{hook_name}';"),
            )
        } else {
            source
        };
        plans.push(scaffold_file_plan(
            if expanded_hook {
                relative
                    .join(&architecture.hooks_directory)
                    .join(architecture.hook_file_name(name))
            } else {
                relative.join(architecture.hook_file_name(name))
            },
            roles.hook,
            source,
        ));
    }
    if layers.store {
        plans.push(scaffold_file_plan(
            relative.join(architecture.store_file_name(name)),
            roles.store,
            progressive_store_source(name, layers, architecture),
        ));
    }
    if layers.logic {
        plans.push(scaffold_file_plan(
            relative.join(architecture.logic_file_name(name)),
            roles.logic,
            progressive_logic_source(name, layers, architecture),
        ));
    }
    if layers.api {
        plans.push(scaffold_file_plan(
            relative.join(architecture.api_file_name(name)),
            roles.api,
            progressive_api_source(name),
        ));
    }
    if layers.types {
        plans.push(scaffold_file_plan(
            relative.join(architecture.types_file_name(name)),
            roles.types,
            owner_types_source(name),
        ));
    }
    if let Some(hook_name) = legacy_hook_name {
        validate_scoped_hook_name(hook_name, name)?;
        plans.push(scaffold_file_plan(
            relative
                .join(&architecture.hooks_directory)
                .join(format!("{hook_name}.ts")),
            roles.hook,
            hook_source(hook_name, name),
        ));
    }
    Ok(())
}

fn existing_owner_layers(
    root: &Path,
    relative: &Path,
    name: &str,
    architecture: &CodeProjectArchitectureConfig,
) -> OwnerLayerSelection {
    OwnerLayerSelection {
        hook: root
            .join(relative)
            .join(architecture.hook_file_name(name))
            .is_file()
            || root
                .join(relative)
                .join(&architecture.hooks_directory)
                .join(architecture.hook_file_name(name))
                .is_file(),
        store: root
            .join(relative)
            .join(architecture.store_file_name(name))
            .is_file()
            || root
                .join(relative)
                .join(&architecture.stores_directory)
                .join(architecture.store_file_name(name))
                .is_file(),
        logic: root
            .join(relative)
            .join(architecture.logic_file_name(name))
            .is_file(),
        api: root
            .join(relative)
            .join(architecture.api_file_name(name))
            .is_file(),
        types: root
            .join(relative)
            .join(architecture.types_file_name(name))
            .is_file(),
    }
}

fn hook_source(hook_name: &str, owner_name: &str) -> String {
    let prefix = format!("use{owner_name}");
    let behavior_name = hook_name.strip_prefix(&prefix).unwrap_or("Behavior");
    format!(
        "export function {hook_name}() {{\n  // Keep {owner_name} {behavior_name} React behavior here.\n  return {{}};\n}}\n"
    )
}

#[derive(Debug, Clone, Copy)]
enum ExpandedOwnerCapability {
    Hook,
    Store,
}

fn store_slice_source(store_name: &str, _owner_name: &str) -> String {
    let mut state_name = store_name.to_owned();
    if let Some(first) = state_name.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    format!(
        "import {{ create }} from 'zustand';\n\ninterface {state_name}State {{\n  ready: boolean;\n  setReady: (ready: boolean) => void;\n}}\n\nexport const use{state_name}Store = create<{state_name}State>((set) => ({{\n  ready: false,\n  setReady: (ready) => set({{ ready }}),\n}}));\n"
    )
}

#[derive(Debug)]
enum JavascriptModuleToken {
    Identifier(String),
    Punctuation(u8),
    StringLiteral {
        content_start: usize,
        content_end: usize,
        no_substitution: bool,
        quote: u8,
    },
}

#[derive(Debug)]
struct JavascriptModuleLex {
    tokens: Vec<JavascriptModuleToken>,
    complete: bool,
}

fn javascript_identifier_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'$')
}

fn javascript_identifier_continue(byte: u8) -> bool {
    javascript_identifier_start(byte) || byte.is_ascii_digit()
}

fn javascript_template_may_hide_module_reference(content: &str) -> bool {
    let bytes = content.as_bytes();
    for keyword in [b"import".as_slice(), b"require".as_slice()] {
        let mut start = 0_usize;
        while start + keyword.len() <= bytes.len() {
            let Some(offset) = bytes[start..]
                .windows(keyword.len())
                .position(|window| window == keyword)
            else {
                break;
            };
            let index = start + offset;
            let before = index.checked_sub(1).and_then(|value| bytes.get(value));
            let after = bytes.get(index + keyword.len());
            if !before.is_some_and(|byte| javascript_identifier_continue(*byte))
                && !after.is_some_and(|byte| javascript_identifier_continue(*byte))
            {
                return true;
            }
            start = index + keyword.len();
        }
    }
    false
}

fn javascript_closes_control_parenthesis(tokens: &[JavascriptModuleToken]) -> bool {
    if !matches!(
        tokens.last(),
        Some(JavascriptModuleToken::Punctuation(b')'))
    ) {
        return false;
    }
    let mut depth = 0_usize;
    for (index, token) in tokens.iter().enumerate().rev() {
        match token {
            JavascriptModuleToken::Punctuation(b')') => depth += 1,
            JavascriptModuleToken::Punctuation(b'(') => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return matches!(
                        index.checked_sub(1).and_then(|value| tokens.get(value)),
                        Some(JavascriptModuleToken::Identifier(keyword))
                            if matches!(
                                keyword.as_str(),
                                "if" | "while" | "for" | "with" | "switch" | "catch"
                            )
                    );
                }
            }
            _ => {}
        }
    }
    false
}

fn javascript_token_allows_regex(tokens: &[JavascriptModuleToken]) -> bool {
    if javascript_closes_control_parenthesis(tokens) {
        return true;
    }
    match tokens.last() {
        None => true,
        Some(JavascriptModuleToken::Punctuation(value)) => matches!(
            value,
            b'(' | b'['
                | b'{'
                | b','
                | b';'
                | b':'
                | b'='
                | b'!'
                | b'?'
                | b'&'
                | b'|'
                | b'+'
                | b'-'
                | b'*'
                | b'%'
                | b'^'
                | b'~'
                | b'<'
                | b'>'
        ),
        Some(JavascriptModuleToken::Identifier(value)) => matches!(
            value.as_str(),
            "return"
                | "throw"
                | "case"
                | "delete"
                | "void"
                | "typeof"
                | "instanceof"
                | "in"
                | "of"
                | "yield"
                | "await"
                | "else"
                | "do"
        ),
        Some(JavascriptModuleToken::StringLiteral { .. }) => false,
    }
}

fn javascript_module_tokens(source: &str) -> JavascriptModuleLex {
    let bytes = source.as_bytes();
    let mut tokens = Vec::new();
    let mut complete = true;
    let mut index = 0_usize;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte.is_ascii_whitespace() {
            index += 1;
            continue;
        }
        if byte == b'/' && bytes.get(index + 1) == Some(&b'/') {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if byte == b'/' && bytes.get(index + 1) == Some(&b'*') {
            index += 2;
            while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
                index += 1;
            }
            index = (index + 2).min(bytes.len());
            continue;
        }
        let jsx_delimiter = bytes.get(index + 1) == Some(&b'>')
            || index.checked_sub(1).and_then(|value| bytes.get(value)) == Some(&b'<');
        let ambiguous_after_brace = !jsx_delimiter
            && matches!(
                tokens.last(),
                Some(JavascriptModuleToken::Punctuation(b'}'))
            );
        if byte == b'/'
            && !jsx_delimiter
            && (javascript_token_allows_regex(&tokens) || ambiguous_after_brace)
        {
            if ambiguous_after_brace {
                complete = false;
            }
            index += 1;
            let mut escaped = false;
            let mut in_character_class = false;
            while index < bytes.len() {
                let current = bytes[index];
                if escaped {
                    escaped = false;
                } else if current == b'\\' {
                    escaped = true;
                } else if current == b'[' {
                    in_character_class = true;
                } else if current == b']' {
                    in_character_class = false;
                } else if current == b'/' && !in_character_class {
                    index += 1;
                    while index < bytes.len() && bytes[index].is_ascii_alphabetic() {
                        index += 1;
                    }
                    break;
                } else if current == b'\n' || current == b'\r' {
                    break;
                }
                index += 1;
            }
            continue;
        }
        if matches!(byte, b'\'' | b'"' | b'`') {
            let quote = byte;
            let content_start = index + 1;
            let mut content_end = content_start;
            let mut escaped = false;
            let mut no_substitution = true;
            index += 1;
            while index < bytes.len() {
                let current = bytes[index];
                if escaped {
                    escaped = false;
                    index += 1;
                    continue;
                }
                if current == b'\\' {
                    escaped = true;
                    index += 1;
                    continue;
                }
                if quote == b'`' && current == b'$' && bytes.get(index + 1) == Some(&b'{') {
                    no_substitution = false;
                }
                if current == quote {
                    content_end = index;
                    index += 1;
                    break;
                }
                index += 1;
            }
            if content_end >= content_start {
                if quote == b'`'
                    && !no_substitution
                    && javascript_template_may_hide_module_reference(
                        &source[content_start..content_end],
                    )
                {
                    complete = false;
                }
                tokens.push(JavascriptModuleToken::StringLiteral {
                    content_start,
                    content_end,
                    no_substitution: quote != b'`' || no_substitution,
                    quote,
                });
            }
            continue;
        }
        if javascript_identifier_start(byte) {
            let start = index;
            index += 1;
            while index < bytes.len() && javascript_identifier_continue(bytes[index]) {
                index += 1;
            }
            tokens.push(JavascriptModuleToken::Identifier(
                source[start..index].to_owned(),
            ));
            continue;
        }
        tokens.push(JavascriptModuleToken::Punctuation(byte));
        index += 1;
    }
    JavascriptModuleLex { tokens, complete }
}

fn is_javascript_module_string(tokens: &[JavascriptModuleToken], index: usize) -> bool {
    let JavascriptModuleToken::StringLiteral {
        no_substitution, ..
    } = &tokens[index]
    else {
        return false;
    };
    if !no_substitution {
        return false;
    }
    match index.checked_sub(1).and_then(|value| tokens.get(value)) {
        Some(JavascriptModuleToken::Identifier(keyword))
            if keyword == "from" || keyword == "import" =>
        {
            true
        }
        Some(JavascriptModuleToken::Punctuation(b'(')) => {
            let Some(JavascriptModuleToken::Identifier(keyword)) =
                index.checked_sub(2).and_then(|value| tokens.get(value))
            else {
                return false;
            };
            if keyword != "import" && keyword != "require" {
                return false;
            }
            !matches!(
                index.checked_sub(3).and_then(|value| tokens.get(value)),
                Some(JavascriptModuleToken::Punctuation(b'.'))
            )
        }
        _ => false,
    }
}

fn javascript_hex_value(byte: u8) -> Option<u32> {
    match byte {
        b'0'..=b'9' => Some(u32::from(byte - b'0')),
        b'a'..=b'f' => Some(u32::from(byte - b'a' + 10)),
        b'A'..=b'F' => Some(u32::from(byte - b'A' + 10)),
        _ => None,
    }
}

fn javascript_fixed_hex(bytes: &[u8], start: usize, digits: usize) -> Option<u32> {
    let end = start.checked_add(digits)?;
    let mut value = 0_u32;
    for byte in bytes.get(start..end)? {
        value = value
            .checked_mul(16)?
            .checked_add(javascript_hex_value(*byte)?)?;
    }
    Some(value)
}

fn decode_javascript_string_content(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut output = String::with_capacity(raw.len());
    let mut index = 0_usize;
    while index < bytes.len() {
        if bytes[index] != b'\\' {
            let character = raw.get(index..)?.chars().next()?;
            output.push(character);
            index = index.checked_add(character.len_utf8())?;
            continue;
        }

        index = index.checked_add(1)?;
        let escaped = *bytes.get(index)?;
        match escaped {
            b'b' => {
                output.push('\u{0008}');
                index += 1;
            }
            b'f' => {
                output.push('\u{000c}');
                index += 1;
            }
            b'n' => {
                output.push('\n');
                index += 1;
            }
            b'r' => {
                output.push('\r');
                index += 1;
            }
            b't' => {
                output.push('\t');
                index += 1;
            }
            b'v' => {
                output.push('\u{000b}');
                index += 1;
            }
            b'x' => {
                let value = javascript_fixed_hex(bytes, index + 1, 2)?;
                output.push(char::from_u32(value)?);
                index += 3;
            }
            b'u' if bytes.get(index + 1) == Some(&b'{') => {
                let digits_start = index + 2;
                let close = bytes
                    .get(digits_start..)?
                    .iter()
                    .position(|byte| *byte == b'}')?
                    .checked_add(digits_start)?;
                if close == digits_start || close.saturating_sub(digits_start) > 6 {
                    return None;
                }
                let mut value = 0_u32;
                for byte in bytes.get(digits_start..close)? {
                    value = value
                        .checked_mul(16)?
                        .checked_add(javascript_hex_value(*byte)?)?;
                }
                output.push(char::from_u32(value)?);
                index = close + 1;
            }
            b'u' => {
                let first = javascript_fixed_hex(bytes, index + 1, 4)?;
                index += 5;
                let value = if (0xd800..=0xdbff).contains(&first) {
                    if bytes.get(index) != Some(&b'\\') || bytes.get(index + 1) != Some(&b'u') {
                        return None;
                    }
                    let second = javascript_fixed_hex(bytes, index + 2, 4)?;
                    if !(0xdc00..=0xdfff).contains(&second) {
                        return None;
                    }
                    index += 6;
                    0x1_0000 + ((first - 0xd800) << 10) + (second - 0xdc00)
                } else {
                    if (0xdc00..=0xdfff).contains(&first) {
                        return None;
                    }
                    first
                };
                output.push(char::from_u32(value)?);
            }
            b'0'..=b'7' => {
                // TypeScript still parses legacy octal escapes in non-strict
                // JavaScript, so decode them for migration parity too.
                let mut value = u32::from(escaped - b'0');
                let mut digits = 1_usize;
                while digits < 3 {
                    let Some(next @ b'0'..=b'7') = bytes.get(index + digits).copied() else {
                        break;
                    };
                    let next_value = value * 8 + u32::from(next - b'0');
                    if next_value > 0xff {
                        break;
                    }
                    value = next_value;
                    digits += 1;
                }
                output.push(char::from_u32(value)?);
                index += digits;
            }
            b'\r' => {
                index += 1;
                if bytes.get(index) == Some(&b'\n') {
                    index += 1;
                }
            }
            b'\n' => index += 1,
            _ => {
                let character = raw.get(index..)?.chars().next()?;
                if matches!(character, '\u{2028}' | '\u{2029}') {
                    index += character.len_utf8();
                } else {
                    output.push(character);
                    index += character.len_utf8();
                }
            }
        }
    }
    Some(output)
}

fn encode_javascript_string_content(value: &str, quote: u8) -> String {
    let characters = value.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(value.len());
    for (index, character) in characters.iter().copied().enumerate() {
        match character {
            '\\' => output.push_str("\\\\"),
            '\'' if quote == b'\'' => output.push_str("\\'"),
            '"' if quote == b'"' => output.push_str("\\\""),
            '`' if quote == b'`' => output.push_str("\\`"),
            '$' if quote == b'`' && characters.get(index + 1) == Some(&'{') => {
                output.push_str("\\$");
            }
            '\u{0008}' => output.push_str("\\b"),
            '\u{000c}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            '\u{000b}' => output.push_str("\\v"),
            '\u{2028}' => output.push_str("\\u2028"),
            '\u{2029}' => output.push_str("\\u2029"),
            value if value.is_control() => {
                output.push_str(&format!("\\u{:04x}", u32::from(value)));
            }
            _ => output.push(character),
        }
    }
    output
}

fn transform_javascript_module_specifiers(
    source: &str,
    mut transform: impl FnMut(&str) -> Option<String>,
) -> String {
    let lex = javascript_module_tokens(source);
    if !lex.complete {
        return source.to_owned();
    }
    let tokens = lex.tokens;
    let mut replacements = Vec::<(usize, usize, String)>::new();
    for (index, token) in tokens.iter().enumerate() {
        let JavascriptModuleToken::StringLiteral {
            content_start,
            content_end,
            quote,
            ..
        } = token
        else {
            continue;
        };
        if !is_javascript_module_string(&tokens, index) {
            continue;
        }
        let raw = &source[*content_start..*content_end];
        let Some(decoded) = decode_javascript_string_content(raw) else {
            continue;
        };
        if let Some(next) = transform(&decoded) {
            replacements.push((
                *content_start,
                *content_end,
                encode_javascript_string_content(&next, *quote),
            ));
        }
    }
    let mut output = source.to_owned();
    for (start, end, next) in replacements.into_iter().rev() {
        output.replace_range(start..end, &next);
    }
    output
}

fn javascript_module_scan_is_complete(source: &str) -> bool {
    javascript_module_tokens(source).complete
}

fn relocate_gateway_source_one_level(source: &str) -> String {
    transform_javascript_module_specifiers(source, |specifier| {
        if specifier == "." {
            Some("..".to_owned())
        } else if specifier == ".." {
            Some("../..".to_owned())
        } else if let Some(relative) = specifier.strip_prefix("./") {
            Some(format!("../{relative}"))
        } else if specifier.starts_with("../") {
            Some(format!("../{specifier}"))
        } else {
            None
        }
    })
}

fn append_gateway_export(source: &str, export_line: &str) -> String {
    if source.lines().any(|line| line.trim() == export_line) {
        return source.to_owned();
    }
    format!("{}\n\n{export_line}\n", source.trim_end())
}

fn path_without_typescript_extension(path: &Path) -> PathBuf {
    let mut output = path.to_path_buf();
    output.set_extension("");
    output
}

fn relative_module_specifier(from_file: &Path, to_file: &Path) -> Result<String, StudioCoreError> {
    let from = from_file
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str().map(ToOwned::to_owned),
            _ => None,
        })
        .collect::<Vec<_>>();
    let target = path_without_typescript_extension(to_file)
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str().map(ToOwned::to_owned),
            _ => None,
        })
        .collect::<Vec<_>>();
    let common = from
        .iter()
        .zip(&target)
        .take_while(|(left, right)| left == right)
        .count();
    let mut parts = vec!["..".to_owned(); from.len().saturating_sub(common)];
    parts.extend(target.into_iter().skip(common));
    if parts.is_empty() {
        return Err(StudioCoreError::InvalidProject(
            "capability gateway import target is invalid",
        ));
    }
    let joined = parts.join("/");
    Ok(if joined.starts_with('.') {
        joined
    } else {
        format!("./{joined}")
    })
}

fn rewrite_exact_module_specifier(source: &str, old: &str, new: &str) -> String {
    transform_javascript_module_specifiers(source, |specifier| {
        if specifier == old {
            return Some(new.to_owned());
        }
        for extension in [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] {
            if specifier == format!("{old}{extension}") {
                return Some(format!("{new}{extension}"));
            }
        }
        None
    })
}

fn jsonc_as_json(source: &str) -> Result<String, StudioCoreError> {
    let characters = source.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(source.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    while index < characters.len() {
        let character = characters[index];
        if in_string {
            output.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if character == '"' {
            in_string = true;
            output.push(character);
            index += 1;
            continue;
        }
        if character == '/' && characters.get(index + 1) == Some(&'/') {
            index += 2;
            while index < characters.len() && characters[index] != '\n' {
                index += 1;
            }
            continue;
        }
        if character == '/' && characters.get(index + 1) == Some(&'*') {
            index += 2;
            let mut closed = false;
            while index < characters.len() {
                if characters[index] == '\n' {
                    output.push('\n');
                }
                if characters[index] == '*' && characters.get(index + 1) == Some(&'/') {
                    index += 2;
                    closed = true;
                    break;
                }
                index += 1;
            }
            if !closed {
                return Err(StudioCoreError::InvalidProject(
                    "tsconfig.json is not valid JSONC",
                ));
            }
            continue;
        }
        output.push(character);
        index += 1;
    }

    let characters = output.chars().collect::<Vec<_>>();
    let mut normalized = String::with_capacity(output.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    while index < characters.len() {
        let character = characters[index];
        if in_string {
            normalized.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if character == '"' {
            in_string = true;
            normalized.push(character);
            index += 1;
            continue;
        }
        if character == ',' {
            let mut next = index + 1;
            while characters
                .get(next)
                .is_some_and(|value| value.is_whitespace())
            {
                next += 1;
            }
            if matches!(characters.get(next), Some('}') | Some(']')) {
                index += 1;
                continue;
            }
        }
        normalized.push(character);
        index += 1;
    }
    Ok(normalized)
}

fn normalized_tsconfig_path(value: &str, allow_empty: bool) -> Result<String, StudioCoreError> {
    if value.contains(['\0', '\\']) || value.starts_with('/') || is_windows_drive_path(value) {
        return Err(StudioCoreError::InvalidProject(
            "tsconfig.json aliases must remain inside the project root",
        ));
    }
    let mut output = Vec::new();
    for segment in value.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            if output.pop().is_none() {
                return Err(StudioCoreError::InvalidProject(
                    "tsconfig.json aliases must not traverse outside the project",
                ));
            }
        } else {
            output.push(segment);
        }
    }
    let normalized = output.join("/");
    if !allow_empty && normalized.is_empty() {
        return Err(StudioCoreError::InvalidProject(
            "tsconfig.json aliases must be nonempty",
        ));
    }
    Ok(normalized)
}

fn parse_typescript_path_aliases(source: &str) -> Result<Vec<(String, String)>, StudioCoreError> {
    let normalized = jsonc_as_json(source)?;
    let root: Value = serde_json::from_str(&normalized)
        .map_err(|_| StudioCoreError::InvalidProject("tsconfig.json is not valid JSONC"))?;
    let root = root.as_object().ok_or(StudioCoreError::InvalidProject(
        "tsconfig.json must contain an object",
    ))?;
    if root.contains_key("extends") {
        return Err(StudioCoreError::InvalidProject(
            "tsconfig.json extends is unsupported for deterministic local aliases",
        ));
    }
    if let Some(references) = root.get("references") {
        if !references
            .as_array()
            .is_some_and(|references| references.is_empty())
        {
            return Err(StudioCoreError::InvalidProject(
                "tsconfig.json project references are unsupported for deterministic local aliases",
            ));
        }
    }
    let Some(compiler_options) = root.get("compilerOptions") else {
        return Ok(Vec::new());
    };
    let compiler_options = compiler_options
        .as_object()
        .ok_or(StudioCoreError::InvalidProject(
            "tsconfig.json compilerOptions must be an object",
        ))?;
    if compiler_options.contains_key("baseUrl") {
        return Err(StudioCoreError::InvalidProject(
            "tsconfig.json compilerOptions.baseUrl is unsupported for deterministic local aliases; omit it",
        ));
    }
    let Some(paths) = compiler_options.get("paths") else {
        return Ok(Vec::new());
    };
    let paths = paths.as_object().ok_or(StudioCoreError::InvalidProject(
        "tsconfig.json compilerOptions.paths must be an object",
    ))?;
    let mut aliases = Vec::with_capacity(paths.len());
    for (pattern, targets) in paths {
        let wildcard_count = pattern.matches('*').count();
        if pattern.is_empty()
            || pattern.contains(['\0', '\\'])
            || wildcard_count > 1
            || (wildcard_count == 1 && !pattern.ends_with('*'))
        {
            return Err(StudioCoreError::InvalidProject(
                "tsconfig.json path aliases must be deterministic",
            ));
        }
        let targets = targets.as_array().ok_or(StudioCoreError::InvalidProject(
            "tsconfig.json path aliases require string targets",
        ))?;
        let first_target =
            targets
                .first()
                .and_then(Value::as_str)
                .ok_or(StudioCoreError::InvalidProject(
                    "tsconfig.json path aliases require string targets",
                ))?;
        let wildcard = pattern.ends_with('*');
        if (wildcard && !pattern.ends_with("/*")) || (!wildcard && pattern.ends_with('/')) {
            return Err(StudioCoreError::InvalidProject(
                "tsconfig.json path aliases must be exact aliases or slash-delimited /* wildcards",
            ));
        }
        if first_target.contains('*') != wildcard
            || first_target.matches('*').count() > 1
            || (first_target.contains('*') && !first_target.ends_with('*'))
            || (wildcard && !first_target.ends_with("/*"))
        {
            return Err(StudioCoreError::InvalidProject(
                "tsconfig.json path aliases must use matching terminal wildcards",
            ));
        }
        let alias = pattern.strip_suffix('*').unwrap_or(pattern).to_owned();
        let raw_target = first_target.strip_suffix('*').unwrap_or(first_target);
        aliases.push((alias, normalized_tsconfig_path(raw_target, true)?));
    }
    Ok(aliases)
}

fn project_typescript_path_aliases(root: &Path) -> Result<Vec<(String, String)>, StudioCoreError> {
    let path = root.join("tsconfig.json");
    match fs::symlink_metadata(&path) {
        Ok(_) => parse_typescript_path_aliases(&read_regular_utf8_file_in_project(
            &path,
            MAX_TYPESCRIPT_CONFIG_BYTES,
            "TypeScript config",
            root,
        )?),
        Err(source) if source.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(source) => Err(source_io("inspect TypeScript config", &path, source)),
    }
}

fn typescript_module_alias_specifiers(
    path: &Path,
    architecture: &CodeProjectArchitectureConfig,
) -> Result<Vec<String>, StudioCoreError> {
    let normalized = path_to_forward_slashes(&path_without_typescript_extension(path))?;
    let mut specifiers = vec![normalized.clone()];
    if let Some(relative) = normalized.strip_prefix("src/") {
        specifiers.push(format!("@/{relative}"));
    }
    let features_root = format!("{}/", path_to_forward_slashes(&architecture.features)?);
    if let Some(relative) = normalized.strip_prefix(&features_root) {
        specifiers.push(format!("@features/{relative}"));
    }
    let shared_root = format!("{}/", path_to_forward_slashes(&architecture.shared)?);
    if let Some(relative) = normalized.strip_prefix(&shared_root) {
        specifiers.push(format!("@shared/{relative}"));
    }
    Ok(specifiers)
}

fn rewrite_declared_typescript_aliases(
    source: &str,
    old_path: &Path,
    new_path: &Path,
    new_relative_specifier: &str,
    aliases: &[(String, String)],
) -> Result<String, StudioCoreError> {
    let normalized_old = path_to_forward_slashes(old_path)?;
    let normalized_new = path_to_forward_slashes(new_path)?;
    let old_without_extension =
        path_to_forward_slashes(&path_without_typescript_extension(old_path))?;
    let new_without_extension =
        path_to_forward_slashes(&path_without_typescript_extension(new_path))?;
    let mut output = source.to_owned();
    for (prefix, target) in aliases {
        let target = target.trim_end_matches('/');
        let target_without_extension =
            path_to_forward_slashes(&path_without_typescript_extension(Path::new(target)))?;
        if prefix.ends_with('/') {
            for (previous_path, next_path, target_path) in [
                (normalized_old.as_str(), normalized_new.as_str(), target),
                (
                    old_without_extension.as_str(),
                    new_without_extension.as_str(),
                    target_without_extension.as_str(),
                ),
            ] {
                let target_prefix = format!("{target_path}/");
                if let Some(previous_rest) = previous_path.strip_prefix(&target_prefix) {
                    let previous = format!("{prefix}{previous_rest}");
                    let next = next_path
                        .strip_prefix(&target_prefix)
                        .map(|rest| format!("{prefix}{rest}"))
                        .unwrap_or_else(|| new_relative_specifier.to_owned());
                    output = rewrite_exact_module_specifier(&output, &previous, &next);
                }
            }
        }
    }
    Ok(output)
}

fn exact_typescript_alias_targets_path(
    path: &Path,
    aliases: &[(String, String)],
) -> Result<bool, StudioCoreError> {
    let normalized = path_to_forward_slashes(path)?;
    let without_extension = path_to_forward_slashes(&path_without_typescript_extension(path))?;
    for (prefix, raw_target) in aliases {
        if prefix.ends_with('/') {
            continue;
        }
        let target = raw_target.trim_end_matches('/');
        let target_without_extension =
            path_to_forward_slashes(&path_without_typescript_extension(Path::new(target)))?;
        if normalized == target || without_extension == target_without_extension {
            return Ok(true);
        }
    }
    Ok(false)
}

fn expand_owner_capability(
    root: &Path,
    architecture: &CodeProjectArchitectureConfig,
    owner_relative: &Path,
    owner_name: &str,
    capability: ExpandedOwnerCapability,
    helper_name: &str,
    role: CodeProjectScaffoldFileRole,
) -> Result<Vec<ScaffoldedCodeProjectFile>, StudioCoreError> {
    let (folder_name, flat_name, helper_file_name, helper_source, export_line) = match capability {
        ExpandedOwnerCapability::Hook => (
            architecture.hooks_directory.as_str(),
            architecture.hook_file_name(owner_name),
            format!("{helper_name}.ts"),
            hook_source(helper_name, owner_name),
            format!("export {{ {helper_name} }} from './{helper_name}';"),
        ),
        ExpandedOwnerCapability::Store => {
            let mut state_name = helper_name.to_owned();
            if let Some(first) = state_name.get_mut(0..1) {
                first.make_ascii_uppercase();
            }
            (
                architecture.stores_directory.as_str(),
                architecture.store_file_name(owner_name),
                format!("{helper_name}{}", architecture.store_suffix),
                store_slice_source(helper_name, owner_name),
                format!(
                    "export {{ use{state_name}Store }} from '{}';",
                    architecture.local_module_for_file_name(format!(
                        "{helper_name}{}",
                        architecture.store_suffix
                    ))
                ),
            )
        }
    };
    let flat_relative = owner_relative.join(&flat_name);
    let expanded_relative = owner_relative.join(folder_name).join(&flat_name);
    let helper_relative = owner_relative.join(folder_name).join(helper_file_name);
    let flat_path = root.join(&flat_relative);
    let expanded_path = root.join(&expanded_relative);
    let helper_path = root.join(&helper_relative);
    let flat_exists = flat_path.is_file();
    let expanded_exists = expanded_path.is_file();
    if flat_exists && expanded_exists {
        return Err(StudioCoreError::InvalidProject(
            "flat and expanded capability gateways cannot coexist",
        ));
    }
    if !flat_exists && !expanded_exists {
        return Err(StudioCoreError::InvalidProject(
            "create the canonical owner gateway before adding private behavior",
        ));
    }
    let gateway_path = if flat_exists {
        &flat_path
    } else {
        &expanded_path
    };
    let gateway_source = read_regular_utf8_file(
        gateway_path,
        MAX_ARCHITECTURE_SOURCE_BYTES,
        "capability gateway",
    )?;
    if flat_exists && !javascript_module_scan_is_complete(&gateway_source) {
        return Err(StudioCoreError::InvalidProject(
            "capability expansion cannot prove complete module rewrites across template substitutions or ambiguous regular expressions",
        ));
    }
    let relocated_source = if flat_exists {
        relocate_gateway_source_one_level(&gateway_source)
    } else {
        gateway_source.clone()
    };
    let next_gateway_source = append_gateway_export(&relocated_source, &export_line);

    let mut updated_sources = Vec::<(PathBuf, String, String)>::new();
    if flat_exists {
        let declared_aliases = project_typescript_path_aliases(root)?;
        if exact_typescript_alias_targets_path(&flat_relative, &declared_aliases)? {
            return Err(StudioCoreError::InvalidProject(
                "capability expansion cannot move a gateway targeted by an exact tsconfig alias; use a terminal-wildcard owner alias",
            ));
        }
        let mut scan = ProjectTreeScan::architecture(root, architecture);
        // This is a full-project importer rewrite, not an ownership-root
        // validation pass. Never cross into another nested Srijika project.
        scan.stop_at_nested_projects = true;
        // Match CLI/VS Code migration inventory: ignored dependency/output
        // names are never traversed even when the ignored entry is a symlink.
        // Every non-ignored symlink still fails the transaction before writes.
        scan.reject_ignored_symlinks = false;
        scan_directory(root, Path::new(""), 1, &mut scan)?;
        if scan.unsafe_entry.is_some() || scan.truncated {
            return Err(StudioCoreError::InvalidProject(
                "capability expansion requires a complete safe project source scan",
            ));
        }
        let migration_sources = scan
            .entries
            .into_iter()
            .filter(|entry| {
                entry.kind == ProjectTreeEntryKind::File
                    && is_migration_source_path(&entry.relative_path)
            })
            .collect::<Vec<_>>();
        if migration_sources.len() > MAX_ARCHITECTURE_SOURCE_FILES {
            return Err(StudioCoreError::InvalidProject(
                "capability expansion source scan exceeds the source file count limit",
            ));
        }
        let mut migration_bytes = 0_u64;
        for entry in migration_sources {
            let expected_bytes = entry.bytes.ok_or(StudioCoreError::InvalidProject(
                "capability expansion source must be a regular file",
            ))?;
            if expected_bytes > MAX_ARCHITECTURE_SOURCE_BYTES {
                return Err(StudioCoreError::InvalidProject(
                    "capability expansion source exceeds the per-file size limit",
                ));
            }
            migration_bytes = migration_bytes.checked_add(expected_bytes).ok_or(
                StudioCoreError::InvalidProject(
                    "capability expansion sources exceed the combined size limit",
                ),
            )?;
            if migration_bytes > MAX_ARCHITECTURE_SOURCES_BYTES {
                return Err(StudioCoreError::InvalidProject(
                    "capability expansion sources exceed the combined size limit",
                ));
            }
            let relative = PathBuf::from(&entry.relative_path);
            if relative == flat_relative {
                continue;
            }
            ensure_project_path_components_are_real(root, &relative, false)?;
            let path = root.join(&relative);
            let source = read_regular_utf8_file_in_project(
                &path,
                MAX_ARCHITECTURE_SOURCE_BYTES,
                "architecture source",
                root,
            )?;
            if source.len() as u64 != expected_bytes {
                return Err(StudioCoreError::ProjectChangedDuringRead);
            }
            if !javascript_module_scan_is_complete(&source) {
                return Err(StudioCoreError::InvalidProject(
                    "capability expansion cannot prove complete module rewrites across template substitutions or ambiguous regular expressions",
                ));
            }
            let old_specifier = relative_module_specifier(&relative, &flat_relative)?;
            let new_specifier = relative_module_specifier(&relative, &expanded_relative)?;
            let mut next_source =
                rewrite_exact_module_specifier(&source, &old_specifier, &new_specifier);
            for (old_alias, new_alias) in
                typescript_module_alias_specifiers(&flat_relative, architecture)?
                    .into_iter()
                    .zip(typescript_module_alias_specifiers(
                        &expanded_relative,
                        architecture,
                    )?)
            {
                next_source = rewrite_exact_module_specifier(&next_source, &old_alias, &new_alias);
            }
            next_source = rewrite_declared_typescript_aliases(
                &next_source,
                &flat_relative,
                &expanded_relative,
                &new_specifier,
                &declared_aliases,
            )?;
            if next_source != source {
                updated_sources.push((path, source, next_source));
            }
        }
    }

    let created_directories = ensure_safe_project_directory(
        root,
        helper_relative.parent().unwrap_or_else(|| Path::new("")),
    )?;
    if let Err(error) = refuse_existing_project_file(&helper_path) {
        remove_created_directories(&created_directories);
        return Err(error);
    }
    if flat_exists {
        if let Err(error) = refuse_existing_project_file(&expanded_path) {
            remove_created_directories(&created_directories);
            return Err(error);
        }
    }

    let mut helper_created = false;
    let mut expanded_created = false;
    let mut updated_count = 0_usize;
    let apply = (|| {
        atomic_create_text(root, &helper_path, &helper_source)?;
        helper_created = true;
        if flat_exists {
            atomic_create_text(root, &expanded_path, &next_gateway_source)?;
            expanded_created = true;
            for (path, _, next_source) in &updated_sources {
                atomic_write_text(path, next_source)?;
                updated_count += 1;
            }
            fs::remove_file(&flat_path).map_err(|source| {
                source_io("remove migrated capability gateway", &flat_path, source)
            })?;
        } else {
            atomic_write_text(&expanded_path, &next_gateway_source)?;
        }
        Ok::<(), StudioCoreError>(())
    })();
    if let Err(error) = apply {
        for (path, source, _) in updated_sources.iter().take(updated_count).rev() {
            let _ = atomic_write_text(path, source);
        }
        if expanded_created {
            let _ = fs::remove_file(&expanded_path);
        }
        if helper_created {
            let _ = fs::remove_file(&helper_path);
        }
        remove_created_directories(&created_directories);
        return Err(error);
    }

    let helper_relative_string = path_to_forward_slashes(&helper_relative)?;
    Ok(vec![ScaffoldedCodeProjectFile {
        path: helper_path.to_string_lossy().into_owned(),
        relative_path: helper_relative_string,
        role,
        bytes: helper_source.len() as u64,
        hash: source_hash(&helper_source),
    }])
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

fn shared_primitive_ui_source(
    name: &str,
    has_types: bool,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    let props_contract = if has_types {
        let types_module = architecture.types_module(name);
        format!(
            "import type {{ {name}UIProps }} from '{types_module}';\n\nexport type {{ {name}UIProps }} from '{types_module}';\n\n"
        )
    } else {
        format!("export interface {name}UIProps {{\n  className?: string;\n}}\n\n")
    };
    format!(
        "{props_contract}export function {name}UI(props: {name}UIProps) {{\n  return (\n    <section className={{props.className}} data-srijika-owner=\"{name}\">\n      <h2>{name}</h2>\n    </section>\n  );\n}}\n"
    )
}

fn shared_primitive_types_source(name: &str) -> String {
    format!("export interface {name}UIProps {{\n  className?: string;\n}}\n")
}

fn shared_widget_ui_source(name: &str) -> String {
    format!(
        "export interface {name}UIProps {{\n  className?: string;\n}}\n\nexport function {name}UI(props: {name}UIProps) {{\n  return (\n    <section className={{props.className}} data-srijika-owner=\"{name}\">\n      <h2>{name}</h2>\n    </section>\n  );\n}}\n"
    )
}

fn shared_owner_types_source(name: &str) -> String {
    format!("export interface {name}Result {{\n  ok: boolean;\n}}\n")
}

fn shared_owner_api_source(
    name: &str,
    layers: OwnerLayerSelection,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    let stem = lower_camel_owner_name(name).expect("validated owner name");
    let type_import = if layers.types {
        format!(
            "import type {{ {name}Result }} from '{}';\n\n",
            architecture.types_module(name)
        )
    } else {
        String::new()
    };
    let result_type = if layers.types {
        format!("{name}Result")
    } else {
        "{ ok: boolean }".to_owned()
    };
    format!(
        "{type_import}export const {stem}Api = {{\n  async load(): Promise<{result_type}> {{\n    throw new Error('Connect {name} API transport.');\n  }},\n}};\n"
    )
}

fn shared_owner_logic_source(
    name: &str,
    layers: OwnerLayerSelection,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    let stem = lower_camel_owner_name(name).expect("validated owner name");
    if layers.api {
        return format!(
            "import {{ {stem}Api }} from '{}';\n\nexport const {stem}Logic = {{\n  load: () => {stem}Api.load(),\n}};\n",
            architecture.api_module(name)
        );
    }
    format!("export const {stem}Logic = {{\n  load: async () => ({{ ok: true }}),\n}};\n")
}

fn shared_owner_store_source(
    name: &str,
    layers: OwnerLayerSelection,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    let stem = lower_camel_owner_name(name).expect("validated owner name");
    let target = if layers.logic {
        Some((format!("{stem}Logic"), architecture.logic_module(name)))
    } else if layers.api {
        Some((format!("{stem}Api"), architecture.api_module(name)))
    } else {
        None
    };
    let junior_import = target
        .as_ref()
        .map(|(symbol, specifier)| format!("import {{ {symbol} }} from '{specifier}';\n"))
        .unwrap_or_default();
    let load = target
        .as_ref()
        .map(|(symbol, _)| format!("await {symbol}.load();"))
        .unwrap_or_else(|| "// Add an owner action when state needs one.".to_owned());
    format!(
        "import {{ create }} from 'zustand';\n{junior_import}\ninterface {name}State {{\n  ready: boolean;\n  load: () => Promise<void>;\n}}\n\nexport const use{name}Store = create<{name}State>((set) => ({{\n  ready: false,\n  load: async () => {{\n    {load}\n    set({{ ready: true }});\n  }},\n}}));\n"
    )
}

fn shared_owner_hook_source(
    name: &str,
    layers: OwnerLayerSelection,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    let stem = lower_camel_owner_name(name).expect("validated owner name");
    if layers.store {
        return format!(
            "import {{ use{name}Store }} from '{}';\n\nexport function use{name}() {{\n  return use{name}Store();\n}}\n",
            architecture.store_module(name)
        );
    }
    if layers.logic || layers.api {
        let suffix = if layers.logic { "Logic" } else { "Api" };
        let module = if layers.logic {
            architecture.logic_module(name)
        } else {
            architecture.api_module(name)
        };
        return format!(
            "import {{ {stem}{suffix} }} from '{module}';\n\nexport function use{name}() {{\n  return {{ load: {stem}{suffix}.load }};\n}}\n"
        );
    }
    format!("export function use{name}() {{\n  return {{}};\n}}\n")
}

fn shared_owner_connector_source(
    name: &str,
    layers: OwnerLayerSelection,
    architecture: &CodeProjectArchitectureConfig,
) -> String {
    let stem = lower_camel_owner_name(name).expect("validated owner name");
    let ui_import = format!(
        "import {{ {name}UI }} from '{}';\n",
        architecture.ui_module(name)
    );
    if layers.hook {
        return format!(
            "{ui_import}import {{ use{name} }} from '{}';\n\nexport function {name}Connector() {{\n  const model = use{name}();\n  void model;\n  return <{name}UI />;\n}}\n",
            architecture.hook_module(name)
        );
    }
    if layers.store {
        return format!(
            "{ui_import}import {{ use{name}Store }} from '{}';\n\nexport function {name}Connector() {{\n  const model = use{name}Store();\n  void model;\n  return <{name}UI />;\n}}\n",
            architecture.store_module(name)
        );
    }
    if layers.logic || layers.api {
        let suffix = if layers.logic { "Logic" } else { "Api" };
        let module = if layers.logic {
            architecture.logic_module(name)
        } else {
            architecture.api_module(name)
        };
        return format!(
            "{ui_import}import {{ {stem}{suffix} }} from '{module}';\n\nexport function {name}Connector() {{\n  void {stem}{suffix};\n  return <{name}UI />;\n}}\n"
        );
    }
    format!("{ui_import}\nexport function {name}Connector() {{\n  return <{name}UI />;\n}}\n")
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

fn apply_scaffold_source_update(
    files: &[ScaffoldedCodeProjectFile],
    update: Option<ScaffoldSourceUpdate>,
    description: &'static str,
) -> Result<(), StudioCoreError> {
    let Some(update) = update else {
        return Ok(());
    };
    let current =
        match read_regular_utf8_file(&update.path, MAX_ARCHITECTURE_SOURCE_BYTES, description) {
            Ok(source) => source,
            Err(error) => {
                for file in files {
                    let _ = fs::remove_file(&file.path);
                }
                return Err(error);
            }
        };
    if current != update.previous_source {
        for file in files {
            let _ = fs::remove_file(&file.path);
        }
        return Err(StudioCoreError::ProjectChangedDuringRead);
    }
    if let Err(error) = atomic_write_text(&update.path, &update.next_source) {
        for file in files {
            let _ = fs::remove_file(&file.path);
        }
        return Err(error);
    }
    Ok(())
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
    let relative_path = Path::new(LIVE_PREVIEW_BRIDGE_RELATIVE_PATH);
    let path = project_root.join(relative_path);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(source) => return Err(source_io("inspect live preview bridge", &path, source)),
    };
    ensure_project_path_components_are_real(project_root, relative_path, false)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Ok(false);
    }
    if metadata.len() > MAX_TSX_SOURCE_BYTES {
        return Ok(false);
    }

    let canonical_path = fs::canonicalize(&path)
        .map_err(|source| source_io("resolve live preview bridge", &path, source))?;
    ensure_project_containment(project_root, &canonical_path)?;
    let source = read_regular_utf8_file_in_project(
        &path,
        MAX_TSX_SOURCE_BYTES,
        "live preview bridge",
        project_root,
    )?;
    if source.contains("// @srijika-config-driven-preview-v2")
        && source.contains("const LIVE_PREVIEW_VERSION = 1;")
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
        path::Path,
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
        DevServerState, DocumentValidationError, IGNORED_PROJECT_DIRECTORIES,
        LoadCodeProjectArchitectureSourcesRequest, LoadCodeProjectPreviewStylesRequest,
        LoadTsxSourceRequest, LoadUiDocumentRequest, MAX_ARCHITECTURE_SCAN_DEPTH,
        MAX_ARCHITECTURE_SCAN_DIRECTORIES, MAX_ARCHITECTURE_SCAN_ENTRIES,
        MAX_ARCHITECTURE_SOURCE_BYTES, MAX_ARCHITECTURE_SOURCE_FILES, MAX_PROJECT_ENTRY_SEGMENTS,
        MAX_PROJECT_TREE_DEPTH, MAX_PROJECT_TREE_ENTRIES, MAX_TOOL_OUTPUT_BYTES,
        MAX_TYPESCRIPT_CONFIG_BYTES, MIN_DEV_SERVER_PORT, ManagedDevServer,
        OpenCodeProjectAppRequest, OpenCodeProjectRequest, OpenInVsCodeRequest,
        ProjectDependencyState, ProjectRuntimeRecord, ProjectRuntimeStatusRequest,
        ProjectTaskRequest, ProjectTreeScan, SaveTsxSourceRequest, SaveUiDocumentRequest,
        ScaffoldCodeProjectStructureRequest, ScanCodeProjectRequest, StartCodeProjectRequest,
        StudioCore, StudioCoreError, configured_architecture, pnpm_dev_arguments, pnpm_executable,
        project_runtime_is_busy, scan_directory, upgrade_legacy_live_preview_bridge,
        validate_ui_document_envelope,
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
        assert!(upgraded.contains("// @srijika-config-driven-preview-v2"));
        assert!(upgraded.contains("const LIVE_PREVIEW_VERSION = 1;"));
        assert!(upgraded.contains("srijika:preview-runtime-state"));
        assert!(upgraded.contains(
            "import projectConfig from '../../srijika.config.json' with { type: 'json' };"
        ));
        assert!(upgraded.contains("import(/* @vite-ignore */ connectorModuleUrl(uiSource))"));
        assert_eq!(upgraded.matches("/^[A-Za-z]:/.test(").count(), 2);
        assert!(!upgrade_legacy_live_preview_bridge(project).expect("keep current bridge"));

        let previous_v1 = upgraded
            .replace(
                "// @srijika-config-driven-preview-v2",
                "// @srijika-config-driven-preview-v1",
            )
            .replace(" ||\n    suffix.endsWith('.d.tsx')", "");
        fs::write(&bridge, previous_v1).expect("write generated v1 bridge");
        assert!(upgrade_legacy_live_preview_bridge(project).expect("upgrade generated v1 bridge"));
        assert!(
            fs::read_to_string(&bridge)
                .expect("read v2 bridge")
                .contains("// @srijika-config-driven-preview-v2")
        );

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
    fn creates_opens_loads_and_saves_a_project_with_a_configured_ui_suffix() {
        let directory = tempdir().expect("temporary directory");
        let project_path = directory.path().join("configured-ui-project");
        let source_relative = "application/modules/home/Home.view.tsx";
        let original = "export function HomeUI() { return <main>Configured</main>; }\n";
        let config = format!(
            r#"{{"sourceOfTruth":"tsx","entry":"{source_relative}","architecture":{{"profile":"feature-slot-part-v1","featuresRoot":"application/modules","sharedRoot":"application/common","uiSuffix":".view.tsx","connectorSuffix":".gateway.tsx"}}}}"#
        );
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
                        contents: config,
                    },
                ],
            })
            .expect("create configured UI project");

        let opened = core
            .open_code_project(OpenCodeProjectRequest {
                path: project_path.to_string_lossy().into_owned(),
            })
            .expect("open configured UI project");
        assert_eq!(opened.entry_source_path, created.entry_source_path);
        assert_eq!(opened.source, original);

        let updated = "export function HomeUI() { return <main>Saved</main>; }\n";
        core.save_tsx_source(SaveTsxSourceRequest {
            path: created.entry_source_path.clone(),
            source: updated.to_owned(),
            expected_hash: Some(opened.hash),
        })
        .expect("save configured UI source");
        assert_eq!(
            core.load_tsx_source(LoadTsxSourceRequest {
                path: created.entry_source_path,
            })
            .expect("reload configured UI source")
            .source,
            updated
        );

        fs::create_dir_all(project_path.join("src/pages")).expect("create pages directory");
        let page = core
            .create_code_project_ui_source(CreateCodeProjectUiSourceRequest {
                project_path: project_path.to_string_lossy().into_owned(),
                relative_path: "src/pages/Dashboard.view.tsx".to_owned(),
                kind: CodeProjectUiSourceKind::Page,
                component_name: "Dashboard".to_owned(),
                create_connector: true,
            })
            .expect("create configured-suffix page pair");
        assert_eq!(page.relative_path, "src/pages/Dashboard.view.tsx");
        assert!(
            page.connector_path
                .as_deref()
                .is_some_and(|path| path.ends_with("src/pages/Dashboard.gateway.tsx"))
        );
        assert!(
            fs::read_to_string(project_path.join("src/pages/Dashboard.gateway.tsx"))
                .expect("read configured Connector")
                .contains("from './Dashboard.view'")
        );
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
                CodeProjectScaffoldCapability::FeatureHook,
                CodeProjectScaffoldFileRole::FeatureHook,
                "src/features/home/useHome.ts",
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
        assert!(!project.join("src/features/home/useHome.ts").exists());
        assert!(project.join("src/features/home/hooks/useHome.ts").is_file());
        let store_slice = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Home".to_owned(),
                capability: CodeProjectScaffoldCapability::FeatureStoreSlice {
                    store_name: "homeFilters".to_owned(),
                },
            })
            .expect("expand feature store");
        assert_eq!(
            store_slice.files[0].relative_path,
            "src/features/home/stores/homeFilters.store.ts"
        );
        assert!(!project.join("src/features/home/home.store.ts").exists());
        assert!(
            project
                .join("src/features/home/stores/home.store.ts")
                .is_file()
        );
        assert!(
            fs::read_to_string(project.join("src/features/home/hooks/useHome.ts"))
                .expect("read expanded Hook gateway")
                .contains("from '../stores/home.store'")
        );

        let connector = fs::read_to_string(project.join("src/features/home/Home.connector.tsx"))
            .expect("read feature connector");
        assert!(connector.contains("from './hooks/useHome'"));
        assert!(connector.contains("const { ready, run } = useHome();"));
        let store = fs::read_to_string(project.join("src/features/home/stores/home.store.ts"))
            .expect("read feature store");
        assert!(store.contains("import { create } from 'zustand';"));
        assert!(store.contains("export const useHomeStore"));

        let slot_capability = CodeProjectScaffoldCapability::Slot {
            slot_name: "Navigation".to_owned(),
            create_connector: true,
            create_hook: true,
            create_store: true,
            create_logic: false,
            create_api: false,
            create_types: false,
            hook_name: None,
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
                    CodeProjectScaffoldFileRole::SlotHook,
                    "src/features/home/slots/navigation/useNavigation.ts",
                ),
                (
                    CodeProjectScaffoldFileRole::SlotStore,
                    "src/features/home/slots/navigation/navigation.store.ts",
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
                "createHook": true,
                "createStore": true,
                "createLogic": false,
                "createApi": false,
                "createTypes": false,
                "hookName": null,
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
    fn scaffolds_strict_shared_ui_widget_and_headless_capability_owners() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("shared-structure-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        let primitive = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Button".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedUi { create_types: true },
            })
            .expect("create shared UI primitive");
        assert_eq!(primitive.feature_path, "src/shared/ui/button");
        assert_eq!(
            primitive
                .files
                .iter()
                .map(|file| (file.role, file.relative_path.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (
                    CodeProjectScaffoldFileRole::SharedUi,
                    "src/shared/ui/button/Button.ui.tsx",
                ),
                (
                    CodeProjectScaffoldFileRole::SharedUiTypes,
                    "src/shared/ui/button/button.types.ts",
                ),
            ]
        );
        let primitive_source =
            fs::read_to_string(project.join("src/shared/ui/button/Button.ui.tsx"))
                .expect("read primitive");
        assert!(primitive_source.contains("import type { ButtonUIProps }"));
        assert!(primitive_source.contains("export type { ButtonUIProps }"));
        assert!(!primitive_source.contains("Connector"));
        assert_eq!(
            fs::read_to_string(project.join("src/shared/ui/button/button.types.ts"))
                .expect("read primitive types"),
            "export interface ButtonUIProps {\n  className?: string;\n}\n"
        );

        let widget = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "NotificationBell".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedWidget {
                    create_connector: true,
                    create_hook: true,
                    create_store: true,
                    create_logic: true,
                    create_api: true,
                    create_types: true,
                },
            })
            .expect("create shared widget");
        assert_eq!(widget.feature_path, "src/shared/widgets/notification-bell");
        assert_eq!(widget.files.len(), 7);
        assert!(
            project
                .join("src/shared/widgets/notification-bell/NotificationBell.connector.tsx")
                .is_file()
        );

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "NotificationBell".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedWidgetBehaviorHook {
                hook_name: "useNotificationBellPolling".to_owned(),
            },
        })
        .expect("expand shared widget Hook");
        assert!(
            project
                .join("src/shared/widgets/notification-bell/hooks/useNotificationBell.ts")
                .is_file()
        );
        assert!(
            fs::read_to_string(
                project
                    .join("src/shared/widgets/notification-bell/NotificationBell.connector.tsx",),
            )
            .expect("read rewired widget Connector")
            .contains("from './hooks/useNotificationBell'")
        );

        let headless = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Auth".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedCapability {
                    create_hook: true,
                    create_store: true,
                    create_logic: true,
                    create_api: true,
                    create_types: true,
                },
            })
            .expect("create headless shared capability");
        assert_eq!(headless.feature_path, "src/shared/capabilities/auth");
        assert_eq!(headless.files.len(), 5);
        assert!(
            !project
                .join("src/shared/capabilities/auth/Auth.ui.tsx")
                .exists()
        );
        assert!(
            project
                .join("src/shared/capabilities/auth/useAuth.ts")
                .is_file()
        );

        let invalid = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path,
                feature_name: "Telemetry".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedCapability {
                    create_hook: false,
                    create_store: false,
                    create_logic: false,
                    create_api: false,
                    create_types: true,
                },
            })
            .expect_err("types-only headless capability must fail");
        assert_eq!(invalid.code(), "invalid_project");
        assert!(!project.join("src/shared/capabilities/telemetry").exists());
    }

    #[test]
    fn shared_native_sources_match_the_canonical_planner_byte_for_byte() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("shared-source-parity-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Badge".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedUi {
                create_types: false,
            },
        })
        .expect("create inline-contract Shared UI Primitive");
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Badge".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedUiTypes,
        })
        .expect("move the primitive contract into standalone Types");
        assert_eq!(
            fs::read_to_string(project.join("src/shared/ui/badge/Badge.ui.tsx"))
                .expect("read typed primitive UI"),
            "import type { BadgeUIProps } from './badge.types';\n\nexport type { BadgeUIProps } from './badge.types';\n\nexport function BadgeUI(props: BadgeUIProps) {\n  return (\n    <section className={props.className} data-srijika-owner=\"Badge\">\n      <h2>Badge</h2>\n    </section>\n  );\n}\n"
        );

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "CustomBadge".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedUi {
                create_types: false,
            },
        })
        .expect("create custom primitive fixture");
        let custom_primitive = project.join("src/shared/ui/custom-badge");
        fs::write(
            custom_primitive.join("CustomBadge.ui.tsx"),
            "export function CustomBadgeUI() { return <span />; }\n",
        )
        .expect("customize primitive UI");
        let custom_primitive_error = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "CustomBadge".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedUiTypes,
            })
            .expect_err("custom primitive UI contract migration must require review");
        assert_eq!(custom_primitive_error.code(), "invalid_project");
        assert!(!custom_primitive.join("customBadge.types.ts").exists());

        let widget_plan = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "ProfileCard".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedWidget {
                    create_connector: true,
                    create_hook: true,
                    create_store: true,
                    create_logic: true,
                    create_api: true,
                    create_types: true,
                },
            })
            .expect("create canonical Shared Widget");
        assert_eq!(
            widget_plan
                .files
                .iter()
                .map(|file| file.role)
                .collect::<Vec<_>>(),
            vec![
                CodeProjectScaffoldFileRole::SharedWidgetUi,
                CodeProjectScaffoldFileRole::SharedWidgetTypes,
                CodeProjectScaffoldFileRole::SharedWidgetApi,
                CodeProjectScaffoldFileRole::SharedWidgetLogic,
                CodeProjectScaffoldFileRole::SharedWidgetStore,
                CodeProjectScaffoldFileRole::SharedWidgetHook,
                CodeProjectScaffoldFileRole::SharedWidgetConnector,
            ]
        );
        let widget = project.join("src/shared/widgets/profile-card");
        let expected_ui = "export interface ProfileCardUIProps {\n  className?: string;\n}\n\nexport function ProfileCardUI(props: ProfileCardUIProps) {\n  return (\n    <section className={props.className} data-srijika-owner=\"ProfileCard\">\n      <h2>ProfileCard</h2>\n    </section>\n  );\n}\n";
        let expected_connector = "import { ProfileCardUI } from './ProfileCard.ui';\nimport { useProfileCard } from './useProfileCard';\n\nexport function ProfileCardConnector() {\n  const model = useProfileCard();\n  void model;\n  return <ProfileCardUI />;\n}\n";
        let expected_hook = "import { useProfileCardStore } from './profileCard.store';\n\nexport function useProfileCard() {\n  return useProfileCardStore();\n}\n";
        let expected_store = "import { create } from 'zustand';\nimport { profileCardLogic } from './profileCard.logic';\n\ninterface ProfileCardState {\n  ready: boolean;\n  load: () => Promise<void>;\n}\n\nexport const useProfileCardStore = create<ProfileCardState>((set) => ({\n  ready: false,\n  load: async () => {\n    await profileCardLogic.load();\n    set({ ready: true });\n  },\n}));\n";
        let expected_logic = "import { profileCardApi } from './profileCard.api';\n\nexport const profileCardLogic = {\n  load: () => profileCardApi.load(),\n};\n";
        let expected_api = "import type { ProfileCardResult } from './profileCard.types';\n\nexport const profileCardApi = {\n  async load(): Promise<ProfileCardResult> {\n    throw new Error('Connect ProfileCard API transport.');\n  },\n};\n";
        let expected_types = "export interface ProfileCardResult {\n  ok: boolean;\n}\n";
        for (file_name, expected) in [
            ("ProfileCard.ui.tsx", expected_ui),
            ("ProfileCard.connector.tsx", expected_connector),
            ("useProfileCard.ts", expected_hook),
            ("profileCard.store.ts", expected_store),
            ("profileCard.logic.ts", expected_logic),
            ("profileCard.api.ts", expected_api),
            ("profileCard.types.ts", expected_types),
        ] {
            assert_eq!(
                fs::read_to_string(widget.join(file_name)).expect("read Shared Widget layer"),
                expected,
                "{file_name} must match the canonical TypeScript planner"
            );
        }

        let headless_plan = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path,
                feature_name: "AuthSession".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedCapability {
                    create_hook: true,
                    create_store: true,
                    create_logic: true,
                    create_api: true,
                    create_types: true,
                },
            })
            .expect("create canonical Shared Headless Capability");
        assert_eq!(
            headless_plan
                .files
                .iter()
                .map(|file| file.role)
                .collect::<Vec<_>>(),
            vec![
                CodeProjectScaffoldFileRole::SharedCapabilityTypes,
                CodeProjectScaffoldFileRole::SharedCapabilityApi,
                CodeProjectScaffoldFileRole::SharedCapabilityLogic,
                CodeProjectScaffoldFileRole::SharedCapabilityStore,
                CodeProjectScaffoldFileRole::SharedCapabilityHook,
            ]
        );
        let headless = project.join("src/shared/capabilities/auth-session");
        for (file_name, widget_expected) in [
            ("useAuthSession.ts", expected_hook),
            ("authSession.store.ts", expected_store),
            ("authSession.logic.ts", expected_logic),
            ("authSession.api.ts", expected_api),
            ("authSession.types.ts", expected_types),
        ] {
            let expected = widget_expected
                .replace("ProfileCard", "AuthSession")
                .replace("profileCard", "authSession");
            assert_eq!(
                fs::read_to_string(headless.join(file_name)).expect("read Shared Headless layer"),
                expected,
                "{file_name} must match the canonical TypeScript planner"
            );
        }
        assert!(!headless.join("AuthSession.ui.tsx").exists());
        assert!(!headless.join("AuthSession.connector.tsx").exists());
    }

    #[test]
    fn structure_scaffolding_uses_configured_feature_and_shared_roots() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("configured-architecture-roots");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        fs::write(
            project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Home.ui.tsx","architecture":{"profile":"feature-slot-part-v1","featuresRoot":"application/domain/features","sharedRoot":"application/domain/shared"}}"#,
        )
        .expect("write configured architecture roots");
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        let feature = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Dashboard".to_owned(),
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
            .expect("create Feature in configured root");
        assert_eq!(
            feature.feature_path,
            "application/domain/features/dashboard"
        );
        assert!(
            project
                .join("application/domain/features/dashboard/Dashboard.ui.tsx")
                .is_file()
        );

        let slot = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Dashboard".to_owned(),
                capability: CodeProjectScaffoldCapability::Slot {
                    slot_name: "Summary".to_owned(),
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
            .expect("create Slot below configured Feature root");
        assert!(slot.files.iter().all(|file| {
            file.relative_path
                .starts_with("application/domain/features/dashboard/slots/summary/")
        }));

        let widget = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "StatusCard".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedWidget {
                    create_connector: true,
                    create_hook: true,
                    create_store: false,
                    create_logic: false,
                    create_api: false,
                    create_types: false,
                },
            })
            .expect("create Widget in configured Shared root");
        assert_eq!(
            widget.feature_path,
            "application/domain/shared/widgets/status-card"
        );
        assert!(
            project
                .join("application/domain/shared/widgets/status-card/StatusCard.connector.tsx")
                .is_file()
        );

        let headless = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path,
                feature_name: "Session".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedCapability {
                    create_hook: false,
                    create_store: false,
                    create_logic: false,
                    create_api: true,
                    create_types: true,
                },
            })
            .expect("create Headless Capability in configured Shared root");
        assert_eq!(
            headless.feature_path,
            "application/domain/shared/capabilities/session"
        );
        assert!(
            !project
                .join("application/domain/shared/capabilities/session/Session.ui.tsx")
                .exists()
        );
        assert!(!project.join("src/features/dashboard").exists());
        assert!(!project.join("src/shared/widgets/status-card").exists());
    }

    #[test]
    fn structure_scaffolding_honors_every_configured_directory_and_suffix() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("fully-configured-architecture");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        fs::rename(
            project.join("src/Home.ui.tsx"),
            project.join("src/Home.view.tsx"),
        )
        .expect("rename configured entry source");
        fs::write(
            project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Home.view.tsx","architecture":{"profile":"feature-slot-part-v1","featuresRoot":"application/modules","sharedRoot":"application/common","slotsDirectory":"regions","partsDirectory":"fragments","hooksDirectory":"effects","storesDirectory":"state","uiSuffix":".view.tsx","connectorSuffix":".gateway.tsx","storeSuffix":".state.ts","logicSuffix":".rules.ts","apiSuffix":".transport.ts","typesSuffix":".contract.ts"}}"#,
        )
        .expect("write complete architecture config");
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        let feature = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
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
            .expect("create fully configured Feature");
        let feature_paths = feature
            .files
            .iter()
            .map(|file| file.relative_path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            feature_paths,
            vec![
                "application/modules/dashboard/Dashboard.view.tsx",
                "application/modules/dashboard/Dashboard.gateway.tsx",
                "application/modules/dashboard/useDashboard.ts",
                "application/modules/dashboard/dashboard.state.ts",
                "application/modules/dashboard/dashboard.rules.ts",
                "application/modules/dashboard/dashboard.transport.ts",
                "application/modules/dashboard/dashboard.contract.ts",
            ]
        );
        assert!(
            fs::read_to_string(project.join("application/modules/dashboard/Dashboard.gateway.tsx"))
                .expect("read configured Connector")
                .contains("from './Dashboard.view'")
        );
        assert!(
            fs::read_to_string(project.join("application/modules/dashboard/useDashboard.ts"))
                .expect("read configured Hook")
                .contains("from './dashboard.state'")
        );
        assert!(
            fs::read_to_string(project.join("application/modules/dashboard/dashboard.state.ts"))
                .expect("read configured Store")
                .contains("from './dashboard.rules'")
        );
        assert!(
            fs::read_to_string(project.join("application/modules/dashboard/dashboard.rules.ts"))
                .expect("read configured Logic")
                .contains("from './dashboard.transport'")
        );
        assert!(
            project
                .join("application/modules/dashboard/dashboard.contract.ts")
                .is_file()
        );

        let slot = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Dashboard".to_owned(),
                capability: CodeProjectScaffoldCapability::Slot {
                    slot_name: "Summary".to_owned(),
                    create_connector: true,
                    create_hook: false,
                    create_store: false,
                    create_logic: false,
                    create_api: false,
                    create_types: false,
                    hook_name: None,
                    part_name: Some("MetricCard".to_owned()),
                    create_part_connector: true,
                },
            })
            .expect("create configured Slot and Part");
        assert!(slot.files.iter().any(|file| {
            file.relative_path == "application/modules/dashboard/regions/summary/Summary.view.tsx"
        }));
        assert!(slot.files.iter().any(|file| {
            file.relative_path == "application/modules/dashboard/regions/summary/fragments/metric-card/MetricCard.gateway.tsx"
        }));

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Dashboard".to_owned(),
            capability: CodeProjectScaffoldCapability::FeatureBehaviorHook {
                hook_name: "useDashboardSearch".to_owned(),
            },
        })
        .expect("expand configured Hook directory");
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Dashboard".to_owned(),
            capability: CodeProjectScaffoldCapability::FeatureStoreSlice {
                store_name: "dashboardFilters".to_owned(),
            },
        })
        .expect("expand configured Store directory");
        assert!(
            project
                .join("application/modules/dashboard/effects/useDashboard.ts")
                .is_file()
        );
        assert!(
            project
                .join("application/modules/dashboard/effects/useDashboardSearch.ts")
                .is_file()
        );
        assert!(
            project
                .join("application/modules/dashboard/state/dashboard.state.ts")
                .is_file()
        );
        assert!(
            project
                .join("application/modules/dashboard/state/dashboardFilters.state.ts")
                .is_file()
        );
        assert!(
            fs::read_to_string(project.join("application/modules/dashboard/Dashboard.gateway.tsx"))
                .expect("read rewired Connector")
                .contains("from './effects/useDashboard'")
        );
        assert!(
            fs::read_to_string(
                project.join("application/modules/dashboard/effects/useDashboard.ts")
            )
            .expect("read rewired Hook")
            .contains("from '../state/dashboard.state'")
        );

        let widget = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "StatusCard".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedWidget {
                    create_connector: true,
                    create_hook: true,
                    create_store: true,
                    create_logic: true,
                    create_api: true,
                    create_types: true,
                },
            })
            .expect("create fully configured Shared Widget");
        assert_eq!(
            widget
                .files
                .iter()
                .map(|file| file.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec![
                "application/common/widgets/status-card/StatusCard.view.tsx",
                "application/common/widgets/status-card/statusCard.contract.ts",
                "application/common/widgets/status-card/statusCard.transport.ts",
                "application/common/widgets/status-card/statusCard.rules.ts",
                "application/common/widgets/status-card/statusCard.state.ts",
                "application/common/widgets/status-card/useStatusCard.ts",
                "application/common/widgets/status-card/StatusCard.gateway.tsx",
            ]
        );
        let scan = core
            .scan_code_project(ScanCodeProjectRequest { path: project_path })
            .expect("scan configured project");
        let configured_ui = scan
            .entries
            .iter()
            .find(|entry| entry.relative_path == "application/modules/dashboard/Dashboard.view.tsx")
            .expect("configured UI entry");
        assert!(configured_ui.is_ui_source);
    }

    #[test]
    fn configured_architecture_requires_the_exact_supported_profile() {
        for (source, expected) in [
            (
                r#"{"architecture":{"featuresRoot":"application/features"}}"#,
                "architecture.profile is required",
            ),
            (
                r#"{"architecture":{"profile":"feature-slot-part-v2"}}"#,
                "architecture profile is unsupported",
            ),
        ] {
            let config: Value = serde_json::from_str(source).expect("parse project config fixture");
            let error = configured_architecture(
                config
                    .as_object()
                    .expect("project config fixture must be an object"),
            )
            .expect_err("invalid architecture profile must fail closed");
            assert!(error.to_string().contains(expected), "{error}");
        }
    }

    #[test]
    fn configured_architecture_rejects_invalid_directories_and_suffixes_before_writing() {
        let invalid_architectures = [
            r#"{"profile":"feature-slot-part-v1","slotsDirectory":"nested/slots"}"#,
            r#"{"profile":"feature-slot-part-v1","slotsDirectory":"owners","partsDirectory":"owners"}"#,
            r#"{"profile":"feature-slot-part-v1","slotsDirectory":"owners","partsDirectory":"Owners"}"#,
            r#"{"profile":"feature-slot-part-v1","featuresRoot":"src/Owners","sharedRoot":"src/owners"}"#,
            r#"{"profile":"feature-slot-part-v1","hooksDirectory":"C:/hooks"}"#,
            r#"{"profile":"feature-slot-part-v1","hooksDirectory":"C:hooks"}"#,
            r#"{"profile":"feature-slot-part-v1","featuresRoot":"C:features"}"#,
            r#"{"profile":"feature-slot-part-v1","uiSuffix":"ui.tsx"}"#,
            r#"{"profile":"feature-slot-part-v1","storeSuffix":"nested/.state.ts"}"#,
            r#"{"profile":"feature-slot-part-v1","typesSuffix":".d.ts"}"#,
            r#"{"profile":"feature-slot-part-v1","uiSuffix":".d.tsx"}"#,
            r#"{"profile":"feature-slot-part-v1","storeSuffix":".data.ts","logicSuffix":".data.ts"}"#,
            r#"{"profile":"feature-slot-part-v1","uiSuffix":".View.tsx","connectorSuffix":".view.tsx"}"#,
            r#"{"profile":"feature-slot-part-v1","storeSuffix":".cache.state.ts","logicSuffix":".state.ts"}"#,
            r#"{"profile":"feature-slot-part-v1","uiSuffix":".view.tsx","connectorSuffix":".connector.view.tsx"}"#,
            r#"{"profile":"feature-slot-part-v1","uiSuffix":".View.tsx","connectorSuffix":".connector.view.tsx"}"#,
        ];
        for (index, architecture) in invalid_architectures.into_iter().enumerate() {
            let directory = tempdir().expect("temporary directory");
            let project = directory
                .path()
                .join(format!("invalid-architecture-{index}"));
            fs::create_dir(&project).expect("create project");
            write_code_project(&project, false, false);
            fs::write(
                project.join("srijika.config.json"),
                format!(
                    r#"{{"sourceOfTruth":"tsx","entry":"src/Home.ui.tsx","architecture":{architecture}}}"#
                ),
            )
            .expect("write invalid architecture config");
            let error = StudioCore::default()
                .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                    project_path: project.to_string_lossy().into_owned(),
                    feature_name: "Dashboard".to_owned(),
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
                .expect_err("invalid architecture must fail before writing");
            assert_eq!(error.code(), "invalid_project");
            assert!(!project.join("src/features/dashboard").exists());
        }
    }

    #[test]
    fn configured_architecture_roots_reject_traversal_before_writing() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("invalid-architecture-root");
        let outside = directory.path().join("outside");
        fs::create_dir(&project).expect("create project");
        fs::create_dir(&outside).expect("create outside");
        write_code_project(&project, false, false);
        fs::write(
            project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Home.ui.tsx","architecture":{"profile":"feature-slot-part-v1","featuresRoot":"../outside","sharedRoot":"src/shared"}}"#,
        )
        .expect("write unsafe architecture root");

        let error = StudioCore::default()
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project.to_string_lossy().into_owned(),
                feature_name: "Dashboard".to_owned(),
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
            .expect_err("traversing architecture root must fail");
        assert_eq!(error.code(), "invalid_project");
        assert!(outside.read_dir().expect("read outside").next().is_none());

        fs::write(
            project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Home.ui.tsx","architecture":{"profile":"feature-slot-part-v1","featuresRoot":"application//features","sharedRoot":"src/shared"}}"#,
        )
        .expect("write non-normalized architecture root");
        let error = StudioCore::default()
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project.to_string_lossy().into_owned(),
                feature_name: "Dashboard".to_owned(),
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
            .expect_err("architecture roots with empty path segments must fail");
        assert_eq!(error.code(), "invalid_project");
        assert!(!project.join("application").exists());

        fs::write(
            project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Home.ui.tsx","architecture":{"profile":"feature-slot-part-v1","featuresRoot":"a/b/c/d/e/f/g/h/i/j/k","sharedRoot":"src/shared"}}"#,
        )
        .expect("write overly deep architecture root");
        let error = StudioCore::default()
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project.to_string_lossy().into_owned(),
                feature_name: "Dashboard".to_owned(),
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
            .expect_err("an architecture root that cannot fit a Part must fail early");
        assert_eq!(error.code(), "invalid_project");
        assert!(!project.join("a").exists());
    }

    #[cfg(unix)]
    #[test]
    fn configured_architecture_roots_reject_symlinked_ancestors_before_writing() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("symlinked-architecture-root");
        let outside = directory.path().join("outside");
        fs::create_dir(&project).expect("create project");
        fs::create_dir(&outside).expect("create outside");
        write_code_project(&project, false, false);
        fs::write(
            project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Home.ui.tsx","architecture":{"profile":"feature-slot-part-v1","featuresRoot":"workspace/features","sharedRoot":"workspace/shared"}}"#,
        )
        .expect("write symlinked architecture config");
        symlink(&outside, project.join("workspace")).expect("create architecture root symlink");

        let error = StudioCore::default()
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project.to_string_lossy().into_owned(),
                feature_name: "Button".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedUi {
                    create_types: false,
                },
            })
            .expect_err("symlinked configured Shared root must fail");
        assert_eq!(error.code(), "invalid_project");
        assert!(outside.read_dir().expect("read outside").next().is_none());
    }

    #[test]
    fn shared_standalone_layers_preserve_required_boundaries_and_rewire_the_runtime_chain() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("shared-progressive-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "StatusCard".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedWidget {
                create_connector: true,
                create_hook: false,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
            },
        })
        .expect("create minimal shared widget");
        let widget = project.join("src/shared/widgets/status-card");

        for capability in [
            CodeProjectScaffoldCapability::SharedWidgetApi,
            CodeProjectScaffoldCapability::SharedWidgetLogic,
            CodeProjectScaffoldCapability::SharedWidgetStore,
            CodeProjectScaffoldCapability::SharedWidgetHook,
        ] {
            core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "StatusCard".to_owned(),
                capability,
            })
            .expect("add and rewire standalone shared widget layer");
        }
        assert!(
            fs::read_to_string(widget.join("StatusCard.connector.tsx"))
                .expect("read rewired connector")
                .contains("from './useStatusCard'")
        );
        assert!(
            fs::read_to_string(widget.join("useStatusCard.ts"))
                .expect("read rewired hook")
                .contains("from './statusCard.store'")
        );
        assert!(
            fs::read_to_string(widget.join("statusCard.store.ts"))
                .expect("read rewired store")
                .contains("from './statusCard.logic'")
        );
        assert!(
            fs::read_to_string(widget.join("statusCard.logic.ts"))
                .expect("read rewired logic")
                .contains("from './statusCard.api'")
        );

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "BrokenCard".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedWidget {
                create_connector: true,
                create_hook: false,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
            },
        })
        .expect("create second shared widget");
        let broken = project.join("src/shared/widgets/broken-card");
        fs::remove_file(broken.join("BrokenCard.connector.tsx"))
            .expect("remove required connector");
        let missing_connector = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "BrokenCard".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedWidgetApi,
            })
            .expect_err("optional widget layer must require its Connector");
        assert_eq!(missing_connector.code(), "not_found");
        assert!(!broken.join("brokenCard.api.ts").exists());

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "CustomCard".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedWidget {
                create_connector: true,
                create_hook: false,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
            },
        })
        .expect("create custom-code fixture");
        let custom = project.join("src/shared/widgets/custom-card");
        fs::write(
            custom.join("CustomCard.connector.tsx"),
            "export function CustomCardConnector() { return null; }\n",
        )
        .expect("customize connector");
        let custom_error = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "CustomCard".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedWidgetHook,
            })
            .expect_err("custom connector must not be silently replaced");
        assert_eq!(custom_error.code(), "invalid_project");
        assert!(!custom.join("useCustomCard.ts").exists());

        fs::create_dir_all(project.join("src/shared/capabilities/types-only"))
            .expect("create malformed headless owner fixture");
        let types_only = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "TypesOnly".to_owned(),
                capability: CodeProjectScaffoldCapability::SharedCapabilityTypes,
            })
            .expect_err("headless Types require a runtime boundary");
        assert_eq!(types_only.code(), "invalid_project");
        assert!(
            !project
                .join("src/shared/capabilities/types-only/typesOnly.types.ts")
                .exists()
        );

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Session".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedCapability {
                create_hook: false,
                create_store: false,
                create_logic: false,
                create_api: true,
                create_types: false,
            },
        })
        .expect("create API-backed headless capability");
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Session".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedCapabilityTypes,
        })
        .expect("add Types after a valid headless runtime boundary");
        assert_eq!(
            fs::read_to_string(project.join("src/shared/capabilities/session/session.api.ts"))
                .expect("read typed standalone API"),
            "import type { SessionResult } from './session.types';\n\nexport const sessionApi = {\n  async load(): Promise<SessionResult> {\n    throw new Error('Connect Session API transport.');\n  },\n};\n"
        );

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "ReverseFlow".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedCapability {
                create_hook: true,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
            },
        })
        .expect("create Hook-first headless capability");
        for capability in [
            CodeProjectScaffoldCapability::SharedCapabilityStore,
            CodeProjectScaffoldCapability::SharedCapabilityLogic,
            CodeProjectScaffoldCapability::SharedCapabilityApi,
            CodeProjectScaffoldCapability::SharedCapabilityTypes,
        ] {
            core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "ReverseFlow".to_owned(),
                capability,
            })
            .expect("add and rewire reverse-order headless layer");
        }
        let reverse = project.join("src/shared/capabilities/reverse-flow");
        assert_eq!(
            fs::read_to_string(reverse.join("useReverseFlow.ts")).expect("read reverse Hook"),
            "import { useReverseFlowStore } from './reverseFlow.store';\n\nexport function useReverseFlow() {\n  return useReverseFlowStore();\n}\n"
        );
        assert_eq!(
            fs::read_to_string(reverse.join("reverseFlow.store.ts")).expect("read reverse Store"),
            "import { create } from 'zustand';\nimport { reverseFlowLogic } from './reverseFlow.logic';\n\ninterface ReverseFlowState {\n  ready: boolean;\n  load: () => Promise<void>;\n}\n\nexport const useReverseFlowStore = create<ReverseFlowState>((set) => ({\n  ready: false,\n  load: async () => {\n    await reverseFlowLogic.load();\n    set({ ready: true });\n  },\n}));\n"
        );
        assert_eq!(
            fs::read_to_string(reverse.join("reverseFlow.logic.ts")).expect("read reverse Logic"),
            "import { reverseFlowApi } from './reverseFlow.api';\n\nexport const reverseFlowLogic = {\n  load: () => reverseFlowApi.load(),\n};\n"
        );
        assert_eq!(
            fs::read_to_string(reverse.join("reverseFlow.api.ts")).expect("read reverse API"),
            "import type { ReverseFlowResult } from './reverseFlow.types';\n\nexport const reverseFlowApi = {\n  async load(): Promise<ReverseFlowResult> {\n    throw new Error('Connect ReverseFlow API transport.');\n  },\n};\n"
        );
    }

    #[test]
    fn expanded_owner_gateways_rewrite_relative_and_canonical_alias_imports() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("gateway-alias-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "AliasCard".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedWidget {
                create_connector: true,
                create_hook: true,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
            },
        })
        .expect("create shared alias fixture");
        for (file_name, specifier) in [
            ("shared-at.ts", "@/shared/widgets/alias-card/useAliasCard"),
            ("shared-scope.ts", "@shared/widgets/alias-card/useAliasCard"),
            (
                "shared-src.ts",
                "src/shared/widgets/alias-card/useAliasCard.ts",
            ),
            (
                "shared-escaped.ts",
                r#"@/shared/widgets/alias-card/useAliasC\u0061rd"#,
            ),
        ] {
            fs::write(
                project.join("src").join(file_name),
                format!("import {{ useAliasCard }} from '{specifier}';\nvoid useAliasCard;\n"),
            )
            .expect("write shared alias consumer");
        }
        let control_regex_consumer = project.join("src/shared-control-regex.ts");
        fs::write(
            &control_regex_consumer,
            "import { useAliasCard } from '@/shared/widgets/alias-card/useAliasCard';\nif (ready) /import\\('\\@\\/shared\\/widgets\\/alias-card\\/useAliasCard'\\)/.test(value);\nvoid useAliasCard;\n",
        )
        .expect("write control-statement regex consumer");
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "AliasCard".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedWidgetBehaviorHook {
                hook_name: "useAliasCardPolling".to_owned(),
            },
        })
        .expect("expand shared aliased Hook gateway");
        for file_name in [
            "shared-at.ts",
            "shared-scope.ts",
            "shared-src.ts",
            "shared-escaped.ts",
        ] {
            assert!(
                fs::read_to_string(project.join("src").join(file_name))
                    .expect("read rewritten shared alias")
                    .contains("/hooks/useAliasCard")
            );
        }
        let control_regex_source =
            fs::read_to_string(control_regex_consumer).expect("read control regex consumer");
        assert!(
            control_regex_source.contains("from '@/shared/widgets/alias-card/hooks/useAliasCard'")
        );
        assert!(
            control_regex_source
                .contains("/import\\('\\@\\/shared\\/widgets\\/alias-card\\/useAliasCard'\\)/")
        );

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "AliasFeature".to_owned(),
            capability: CodeProjectScaffoldCapability::Feature {
                create_connector: true,
                create_hook: true,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
                hook_name: None,
            },
        })
        .expect("create feature alias fixture");
        fs::write(
            project.join("src/feature-alias.ts"),
            "import { useAliasFeature } from '@features/alias-feature/useAliasFeature';\nvoid useAliasFeature;\n",
        )
        .expect("write feature alias consumer");
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "AliasFeature".to_owned(),
            capability: CodeProjectScaffoldCapability::FeatureBehaviorHook {
                hook_name: "useAliasFeaturePolling".to_owned(),
            },
        })
        .expect("expand feature aliased Hook gateway");
        assert!(
            fs::read_to_string(project.join("src/feature-alias.ts"))
                .expect("read rewritten feature alias")
                .contains("@features/alias-feature/hooks/useAliasFeature")
        );

        fs::write(
            project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Home.ui.tsx","architecture":{"profile":"feature-slot-part-v1","featuresRoot":"application/domain/features","sharedRoot":"application/domain/shared"}}"#,
        )
        .expect("write configured alias roots");
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "ConfiguredCard".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedWidget {
                create_connector: true,
                create_hook: true,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
            },
        })
        .expect("create configured Shared alias fixture");
        fs::write(
            project.join("src/configured-shared-alias.ts"),
            "import { useConfiguredCard } from '@shared/widgets/configured-card/useConfiguredCard';\nvoid useConfiguredCard;\n",
        )
        .expect("write configured Shared alias consumer");
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "ConfiguredCard".to_owned(),
            capability: CodeProjectScaffoldCapability::SharedWidgetBehaviorHook {
                hook_name: "useConfiguredCardPolling".to_owned(),
            },
        })
        .expect("expand configured Shared Hook gateway");
        assert!(
            fs::read_to_string(project.join("src/configured-shared-alias.ts"))
                .expect("read configured Shared alias")
                .contains("@shared/widgets/configured-card/hooks/useConfiguredCard")
        );

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "ConfiguredFeature".to_owned(),
            capability: CodeProjectScaffoldCapability::Feature {
                create_connector: true,
                create_hook: true,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
                hook_name: None,
            },
        })
        .expect("create configured Feature alias fixture");
        fs::write(
            project.join("src/configured-feature-alias.ts"),
            "import { useConfiguredFeature } from '@features/configured-feature/useConfiguredFeature';\nvoid useConfiguredFeature;\n",
        )
        .expect("write configured Feature alias consumer");
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path,
            feature_name: "ConfiguredFeature".to_owned(),
            capability: CodeProjectScaffoldCapability::FeatureBehaviorHook {
                hook_name: "useConfiguredFeaturePolling".to_owned(),
            },
        })
        .expect("expand configured Feature Hook gateway");
        assert!(
            fs::read_to_string(project.join("src/configured-feature-alias.ts"))
                .expect("read configured Feature alias")
                .contains("@features/configured-feature/hooks/useConfiguredFeature")
        );
    }

    #[test]
    fn expanded_owner_gateways_rewrite_declared_wildcard_aliases_and_reject_exact_aliases() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("declared-alias-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "DeclaredFeature".to_owned(),
            capability: CodeProjectScaffoldCapability::Feature {
                create_connector: true,
                create_hook: true,
                create_store: true,
                create_logic: false,
                create_api: false,
                create_types: false,
                hook_name: None,
            },
        })
        .expect("create declared-alias Feature");
        fs::write(
            project.join("tsconfig.json"),
            r#"{
  // Terminal wildcards remain stable when a gateway moves.
  "compilerOptions": {
    "paths": { "@app/*": ["src/*"], },
  },
}"#,
        )
        .expect("write JSONC wildcard alias");
        fs::write(
            project.join("src/features/declared-feature/useDeclaredFeature.ts"),
            "const untouched = './declaredFeature.store.js';\n// import(`./declaredFeature.store.js`) must stay a comment.\nexport async function useDeclaredFeature() {\n  return import(`./declaredFeature.store.js`);\n}\n",
        )
        .expect("write custom flat Hook gateway");
        let wildcard_consumer = project.join("src/declared-alias-consumer.ts");
        fs::write(
            &wildcard_consumer,
            "import { useDeclaredFeature } from '@app/features/declared-feature/useDeclaredFeature';\nimport { useDeclaredFeature as typed } from \"@app/features/declared-feature/useDeclaredFeature.ts\";\nconst lazy = import(`@app/features/declared-feature/useDeclaredFeature.js`);\nconst untouched = '@app/features/declared-feature/useDeclaredFeature';\n// import('@app/features/declared-feature/useDeclaredFeature') must stay a comment.\nvoid useDeclaredFeature; void typed; void lazy; void untouched;\n",
        )
        .expect("write wildcard alias consumers");
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "DeclaredFeature".to_owned(),
            capability: CodeProjectScaffoldCapability::FeatureBehaviorHook {
                hook_name: "useDeclaredFeaturePolling".to_owned(),
            },
        })
        .expect("expand wildcard-aliased gateway");
        let wildcard_source =
            fs::read_to_string(&wildcard_consumer).expect("read wildcard alias consumer");
        assert!(
            wildcard_source.contains("'@app/features/declared-feature/hooks/useDeclaredFeature'")
        );
        assert!(
            wildcard_source
                .contains("\"@app/features/declared-feature/hooks/useDeclaredFeature.ts\"")
        );
        assert!(
            wildcard_source
                .contains("`@app/features/declared-feature/hooks/useDeclaredFeature.js`")
        );
        assert!(
            wildcard_source
                .contains("const untouched = '@app/features/declared-feature/useDeclaredFeature';")
        );
        assert!(wildcard_source.contains(
            "// import('@app/features/declared-feature/useDeclaredFeature') must stay a comment."
        ));
        let relocated_gateway = fs::read_to_string(
            project.join("src/features/declared-feature/hooks/useDeclaredFeature.ts"),
        )
        .expect("read relocated Hook gateway");
        assert!(relocated_gateway.contains("import(`../declaredFeature.store.js`)"));
        assert!(relocated_gateway.contains("const untouched = './declaredFeature.store.js';"));
        assert!(
            relocated_gateway
                .contains("// import(`./declaredFeature.store.js`) must stay a comment.")
        );

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "ExactFeature".to_owned(),
            capability: CodeProjectScaffoldCapability::Feature {
                create_connector: true,
                create_hook: true,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
                hook_name: None,
            },
        })
        .expect("create exact-alias Feature");
        fs::write(
            project.join("tsconfig.json"),
            r##"{"compilerOptions":{"paths":{"#exact":["src/features/exact-feature/useExactFeature.ts"]}}}"##,
        )
        .expect("write exact alias");
        let exact_consumer = project.join("src/exact-alias-consumer.ts");
        let exact_source = "import { useExactFeature } from '#exact';\nvoid useExactFeature;\n";
        fs::write(&exact_consumer, exact_source).expect("write exact alias consumer");
        let error = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path,
                feature_name: "ExactFeature".to_owned(),
                capability: CodeProjectScaffoldCapability::FeatureBehaviorHook {
                    hook_name: "useExactFeaturePolling".to_owned(),
                },
            })
            .expect_err("exact alias migration must fail before mutation");
        assert_eq!(error.code(), "invalid_project");
        assert!(error.to_string().contains("terminal-wildcard"));
        assert!(
            project
                .join("src/features/exact-feature/useExactFeature.ts")
                .is_file()
        );
        assert!(
            !project
                .join("src/features/exact-feature/hooks/useExactFeature.ts")
                .exists()
        );
        assert!(
            !project
                .join("src/features/exact-feature/hooks/useExactFeaturePolling.ts")
                .exists()
        );
        assert_eq!(
            fs::read_to_string(exact_consumer).expect("read unchanged exact alias consumer"),
            exact_source
        );
    }

    #[test]
    fn module_rewrites_touch_only_static_module_reference_literals() {
        let source = r#"import value from './old';
import type { Model } from "./old.ts";
export { value as renamed } from './old.js';
import './old.jsx';
const dynamic = import(`./old.mjs`);
const required = require("./old.cjs");
import escapedUnicode from './\u006fld';
const escapedHex = require("./\x6fld.ts");
const escapedOctal = require('./\157ld.js');
const untouched = './old';
const object = { from: './old' };
// import('./old') must remain a comment.
const pattern = /from '.\/old'/;
if (ready) /import\('\.\/old'\)/.test(value);
"#;
        let rewritten = super::rewrite_exact_module_specifier(source, "./old", "./next");
        for expected in [
            "from './next'",
            "from \"./next.ts\"",
            "from './next.js'",
            "import './next.jsx'",
            "import(`./next.mjs`)",
            "require(\"./next.cjs\")",
            "from './next'",
            "require(\"./next.ts\")",
            "require('./next.js')",
        ] {
            assert!(
                rewritten.contains(expected),
                "missing {expected}: {rewritten}"
            );
        }
        for untouched in [
            "const untouched = './old';",
            "const object = { from: './old' };",
            "// import('./old') must remain a comment.",
            "const pattern = /from '.\\/old'/;",
            "if (ready) /import\\('\\.\\/old'\\)/.test(value);",
        ] {
            assert!(
                rewritten.contains(untouched),
                "changed unrelated source {untouched}: {rewritten}"
            );
        }
        assert_eq!(rewritten.matches("from './next';").count(), 2);
        let relocated = super::relocate_gateway_source_one_level(
            "const store = import(`./\\u0068ome.store.ts`);\n",
        );
        assert_eq!(relocated, "const store = import(`../home.store.ts`);\n");

        let hidden_template = "const value = `loaded: ${import('./old')}`;\n";
        assert!(!super::javascript_module_scan_is_complete(hidden_template));
        assert_eq!(
            super::rewrite_exact_module_specifier(hidden_template, "./old", "./next"),
            hidden_template
        );
        let ordinary_template = "const value = `loaded: ${count}`;\nimport value from './old';\n";
        assert!(super::javascript_module_scan_is_complete(ordinary_template));
        assert!(
            super::rewrite_exact_module_specifier(ordinary_template, "./old", "./next")
                .contains("from './next'")
        );
        let ambiguous_block_regex = "if (ready) {} /import\\('\\.\\/old'\\)/.test(value);\n";
        assert!(!super::javascript_module_scan_is_complete(
            ambiguous_block_regex
        ));
        assert_eq!(
            super::rewrite_exact_module_specifier(ambiguous_block_regex, "./old", "./next"),
            ambiguous_block_regex
        );
    }

    #[test]
    fn typescript_alias_parser_rejects_inherited_base_urls_and_project_references() {
        for (source, expected) in [
            (
                r#"{"extends":"./tsconfig.base.json","compilerOptions":{}}"#,
                "extends is unsupported",
            ),
            (
                r#"{"compilerOptions":{"baseUrl":"src"}}"#,
                "baseUrl is unsupported",
            ),
            (
                r#"{"compilerOptions":{"baseUrl":"."}}"#,
                "baseUrl is unsupported",
            ),
            (
                r#"{"references":[{"path":"../shared"}],"compilerOptions":{}}"#,
                "project references are unsupported",
            ),
            (
                r#"{"compilerOptions":{"paths":{"@feature*":["src/features/*"]}}}"#,
                "exact aliases or slash-delimited",
            ),
            (
                r#"{"compilerOptions":{"paths":{"@feature/":["src/features/Home.ts"]}}}"#,
                "exact aliases or slash-delimited",
            ),
            (
                r#"{"compilerOptions":{"paths":{"@feature/*":["src/features*"]}}}"#,
                "matching terminal wildcards",
            ),
        ] {
            let error = super::parse_typescript_path_aliases(source)
                .expect_err("nonlocal alias configuration must fail closed");
            assert!(error.to_string().contains(expected), "{error}");
        }
        assert!(
            super::parse_typescript_path_aliases(
                r#"{"references":[],"compilerOptions":{"paths":{"@app/*":["src/*"]}}}"#,
            )
            .is_ok()
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
                    create_hook: true,
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
                    CodeProjectScaffoldFileRole::FeatureHook,
                    "src/features/admin-panel/hooks/useAdminPanel.ts",
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
                CodeProjectScaffoldCapability::PartHook {
                    slot_name: "UserNavigation".to_owned(),
                    part_name: "AccountMenu".to_owned(),
                },
                CodeProjectScaffoldFileRole::PartHook,
                "src/features/admin-panel/slots/user-navigation/parts/account-menu/useAccountMenu.ts",
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
    fn reverse_order_standalone_layers_rewire_feature_slot_and_part_seniors() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("reverse-progressive-owner-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Dashboard".to_owned(),
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
        .expect("create minimal Feature");
        for capability in [
            CodeProjectScaffoldCapability::FeatureApi,
            CodeProjectScaffoldCapability::FeatureLogic,
            CodeProjectScaffoldCapability::FeatureStore,
            CodeProjectScaffoldCapability::FeatureHook,
        ] {
            core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Dashboard".to_owned(),
                capability,
            })
            .expect("insert reverse-order Feature layer");
        }

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Dashboard".to_owned(),
            capability: CodeProjectScaffoldCapability::Slot {
                slot_name: "Navigation".to_owned(),
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
        .expect("create minimal Slot");
        for capability in [
            CodeProjectScaffoldCapability::SlotApi {
                slot_name: "Navigation".to_owned(),
            },
            CodeProjectScaffoldCapability::SlotLogic {
                slot_name: "Navigation".to_owned(),
            },
            CodeProjectScaffoldCapability::SlotStore {
                slot_name: "Navigation".to_owned(),
            },
            CodeProjectScaffoldCapability::SlotHook {
                slot_name: "Navigation".to_owned(),
            },
        ] {
            core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Dashboard".to_owned(),
                capability,
            })
            .expect("insert reverse-order Slot layer");
        }

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Dashboard".to_owned(),
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
        .expect("create minimal Part");
        for capability in [
            CodeProjectScaffoldCapability::PartApi {
                slot_name: "Navigation".to_owned(),
                part_name: "UserMenu".to_owned(),
            },
            CodeProjectScaffoldCapability::PartLogic {
                slot_name: "Navigation".to_owned(),
                part_name: "UserMenu".to_owned(),
            },
            CodeProjectScaffoldCapability::PartStore {
                slot_name: "Navigation".to_owned(),
                part_name: "UserMenu".to_owned(),
            },
            CodeProjectScaffoldCapability::PartHook {
                slot_name: "Navigation".to_owned(),
                part_name: "UserMenu".to_owned(),
            },
        ] {
            core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "Dashboard".to_owned(),
                capability,
            })
            .expect("insert reverse-order Part layer");
        }

        for (root, name, stem) in [
            (
                project.join("src/features/dashboard"),
                "Dashboard",
                "dashboard",
            ),
            (
                project.join("src/features/dashboard/slots/navigation"),
                "Navigation",
                "navigation",
            ),
            (
                project.join("src/features/dashboard/slots/navigation/parts/user-menu"),
                "UserMenu",
                "userMenu",
            ),
        ] {
            assert!(
                fs::read_to_string(root.join(format!("{name}.connector.tsx")))
                    .expect("read rewired Connector")
                    .contains(&format!("from './use{name}'"))
            );
            assert!(
                fs::read_to_string(root.join(format!("use{name}.ts")))
                    .expect("read rewired Hook")
                    .contains(&format!("from './{stem}.store'"))
            );
            assert!(
                fs::read_to_string(root.join(format!("{stem}.store.ts")))
                    .expect("read rewired Store")
                    .contains(&format!("from './{stem}.logic'"))
            );
            assert!(
                fs::read_to_string(root.join(format!("{stem}.logic.ts")))
                    .expect("read rewired Logic")
                    .contains(&format!("from './{stem}.api'"))
            );
        }
    }

    #[test]
    fn custom_connector_blocks_reverse_layer_insertion_without_partial_files() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("custom-connector-reverse-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Dashboard".to_owned(),
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
        .expect("create minimal Feature");
        let root = project.join("src/features/dashboard");
        let connector = root.join("Dashboard.connector.tsx");
        let custom = "export function DashboardConnector() { return null; }\n";
        fs::write(&connector, custom).expect("customize Connector");

        let error = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path,
                feature_name: "Dashboard".to_owned(),
                capability: CodeProjectScaffoldCapability::FeatureStore,
            })
            .expect_err("custom Connector insertion must require review");
        assert_eq!(error.code(), "invalid_project");
        assert_eq!(
            fs::read_to_string(connector).expect("read preserved Connector"),
            custom
        );
        assert!(!root.join("dashboard.store.ts").exists());
    }

    #[cfg(unix)]
    #[test]
    fn capability_expansion_aborts_before_mutation_when_the_rewrite_scan_is_unsafe() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("unsafe-expansion-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Dashboard".to_owned(),
            capability: CodeProjectScaffoldCapability::Feature {
                create_connector: true,
                create_hook: true,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
                hook_name: None,
            },
        })
        .expect("create flat Hook owner");
        let owner = project.join("src/features/dashboard");
        let flat_hook = owner.join("useDashboard.ts");
        let connector = owner.join("Dashboard.connector.tsx");
        let flat_source = fs::read_to_string(&flat_hook).expect("read flat Hook");
        let connector_source = fs::read_to_string(&connector).expect("read Connector");
        let outside = directory.path().join("outside.ts");
        fs::write(&outside, "export const outside = true;\n").expect("write outside source");
        symlink(&outside, project.join("src/features/unsafe-import.ts"))
            .expect("create unsafe rewrite-scan symlink");

        let error = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path,
                feature_name: "Dashboard".to_owned(),
                capability: CodeProjectScaffoldCapability::FeatureBehaviorHook {
                    hook_name: "useDashboardSearch".to_owned(),
                },
            })
            .expect_err("unsafe importer scan must abort capability expansion");
        assert_eq!(error.code(), "invalid_project");
        assert!(flat_hook.is_file());
        assert!(!owner.join("hooks/useDashboard.ts").exists());
        assert!(!owner.join("hooks/useDashboardSearch.ts").exists());
        assert_eq!(fs::read_to_string(flat_hook).unwrap(), flat_source);
        assert_eq!(fs::read_to_string(connector).unwrap(), connector_source);

        fs::remove_file(project.join("src/features/unsafe-import.ts"))
            .expect("remove non-ignored unsafe symlink");
        symlink(directory.path(), project.join("node_modules"))
            .expect("create ignored dependency symlink");
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project.to_string_lossy().into_owned(),
            feature_name: "Dashboard".to_owned(),
            capability: CodeProjectScaffoldCapability::FeatureBehaviorHook {
                hook_name: "useDashboardSearch".to_owned(),
            },
        })
        .expect("ignored-name symlink must not block importer migration");
        assert!(owner.join("hooks/useDashboard.ts").is_file());
        assert!(owner.join("hooks/useDashboardSearch.ts").is_file());
    }

    #[test]
    fn capability_expansion_aborts_before_mutation_when_a_template_hides_an_import() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("template-expansion-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Dashboard".to_owned(),
            capability: CodeProjectScaffoldCapability::Feature {
                create_connector: true,
                create_hook: true,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
                hook_name: None,
            },
        })
        .expect("create flat Hook owner");
        let owner = project.join("src/features/dashboard");
        let flat_hook = owner.join("useDashboard.ts");
        let connector = owner.join("Dashboard.connector.tsx");
        let flat_source = fs::read_to_string(&flat_hook).expect("read flat Hook");
        let connector_source = fs::read_to_string(&connector).expect("read Connector");
        fs::write(
            project.join("src/template-consumer.ts"),
            "const loaded = `module: ${import('./features/dashboard/useDashboard')}`;\nvoid loaded;\n",
        )
        .expect("write hidden static import fixture");

        let error = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path,
                feature_name: "Dashboard".to_owned(),
                capability: CodeProjectScaffoldCapability::FeatureBehaviorHook {
                    hook_name: "useDashboardSearch".to_owned(),
                },
            })
            .expect_err("hidden template import must abort capability expansion");
        assert_eq!(error.code(), "invalid_project");
        assert!(error.to_string().contains("complete module rewrites"));
        assert_eq!(fs::read_to_string(&flat_hook).unwrap(), flat_source);
        assert_eq!(fs::read_to_string(&connector).unwrap(), connector_source);
        assert!(!owner.join("hooks/useDashboard.ts").exists());
        assert!(!owner.join("hooks/useDashboardSearch.ts").exists());
    }

    #[test]
    fn capability_expansion_aborts_before_mutation_when_the_rewrite_scan_exceeds_its_budget() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("over-budget-expansion-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "Dashboard".to_owned(),
            capability: CodeProjectScaffoldCapability::Feature {
                create_connector: true,
                create_hook: true,
                create_store: false,
                create_logic: false,
                create_api: false,
                create_types: false,
                hook_name: None,
            },
        })
        .expect("create flat Hook owner");
        let owner = project.join("src/features/dashboard");
        let flat_hook = owner.join("useDashboard.ts");
        let connector = owner.join("Dashboard.connector.tsx");
        let flat_source = fs::read_to_string(&flat_hook).expect("read flat Hook");
        let connector_source = fs::read_to_string(&connector).expect("read Connector");
        let audit_sources = project.join("src/rewrite-audit");
        fs::create_dir_all(&audit_sources).expect("create rewrite audit directory");
        for index in 0..=MAX_ARCHITECTURE_SOURCE_FILES {
            fs::write(
                audit_sources.join(format!("source-{index:05}.ts")),
                "export {};\n",
            )
            .expect("write rewrite audit source");
        }

        let error = core
            .scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path,
                feature_name: "Dashboard".to_owned(),
                capability: CodeProjectScaffoldCapability::FeatureBehaviorHook {
                    hook_name: "useDashboardSearch".to_owned(),
                },
            })
            .expect_err("over-budget importer scan must abort capability expansion");
        assert_eq!(error.code(), "invalid_project");
        assert!(error.to_string().contains("source file count limit"));
        assert!(flat_hook.is_file());
        assert!(!owner.join("hooks/useDashboard.ts").exists());
        assert!(!owner.join("hooks/useDashboardSearch.ts").exists());
        assert_eq!(fs::read_to_string(flat_hook).unwrap(), flat_source);
        assert_eq!(fs::read_to_string(connector).unwrap(), connector_source);
    }

    #[test]
    fn reverse_order_rewiring_honors_configured_suffixes_and_expanded_store_paths() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("configured-reverse-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        fs::rename(
            project.join("src/Home.ui.tsx"),
            project.join("src/Home.view.tsx"),
        )
        .expect("rename configured entry source");
        fs::write(
            project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Home.view.tsx","architecture":{"profile":"feature-slot-part-v1","featuresRoot":"application/modules","sharedRoot":"application/common","slotsDirectory":"regions","partsDirectory":"fragments","hooksDirectory":"effects","storesDirectory":"state","uiSuffix":".view.tsx","connectorSuffix":".gateway.tsx","storeSuffix":".state.ts","logicSuffix":".rules.ts","apiSuffix":".transport.ts","typesSuffix":".contract.ts"}}"#,
        )
        .expect("write configured architecture");
        let core = StudioCore::default();
        let project_path = project.to_string_lossy().into_owned();

        for feature_name in ["AuditFlow", "ExpandedFlow"] {
            core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: feature_name.to_owned(),
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
            .expect("create configured minimal Feature");
        }

        for capability in [
            CodeProjectScaffoldCapability::FeatureApi,
            CodeProjectScaffoldCapability::FeatureLogic,
            CodeProjectScaffoldCapability::FeatureStore,
            CodeProjectScaffoldCapability::FeatureHook,
        ] {
            core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
                project_path: project_path.clone(),
                feature_name: "AuditFlow".to_owned(),
                capability,
            })
            .expect("insert configured reverse-order layer");
        }
        let audit = project.join("application/modules/audit-flow");
        assert!(
            fs::read_to_string(audit.join("AuditFlow.gateway.tsx"))
                .expect("read configured Connector")
                .contains("from './useAuditFlow'")
        );
        assert!(
            fs::read_to_string(audit.join("useAuditFlow.ts"))
                .expect("read configured Hook")
                .contains("from './auditFlow.state'")
        );
        assert!(
            fs::read_to_string(audit.join("auditFlow.state.ts"))
                .expect("read configured Store")
                .contains("from './auditFlow.rules'")
        );
        assert!(
            fs::read_to_string(audit.join("auditFlow.rules.ts"))
                .expect("read configured Logic")
                .contains("from './auditFlow.transport'")
        );

        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "ExpandedFlow".to_owned(),
            capability: CodeProjectScaffoldCapability::FeatureStore,
        })
        .expect("add configured flat Store");
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path: project_path.clone(),
            feature_name: "ExpandedFlow".to_owned(),
            capability: CodeProjectScaffoldCapability::FeatureStoreSlice {
                store_name: "expandedFlowFilters".to_owned(),
            },
        })
        .expect("expand configured Store");
        core.scaffold_code_project_structure(ScaffoldCodeProjectStructureRequest {
            project_path,
            feature_name: "ExpandedFlow".to_owned(),
            capability: CodeProjectScaffoldCapability::FeatureHook,
        })
        .expect("insert Hook above expanded Store");
        let expanded = project.join("application/modules/expanded-flow");
        assert!(
            fs::read_to_string(expanded.join("ExpandedFlow.gateway.tsx"))
                .expect("read rewired configured Connector")
                .contains("from './useExpandedFlow'")
        );
        assert!(
            fs::read_to_string(expanded.join("useExpandedFlow.ts"))
                .expect("read Hook above expanded Store")
                .contains("from './state/expandedFlow.state'")
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
            (
                json!({
                    "kind": "partStoreSlice",
                    "slotName": "Summary",
                    "partName": "MetricCard",
                    "storeName": "metricCardFilters"
                }),
                CodeProjectScaffoldCapability::PartStoreSlice {
                    slot_name: "Summary".to_owned(),
                    part_name: "MetricCard".to_owned(),
                    store_name: "metricCardFilters".to_owned(),
                },
            ),
            (
                json!({
                    "kind": "sharedWidgetBehaviorHook",
                    "hookName": "useProfileCardPolling"
                }),
                CodeProjectScaffoldCapability::SharedWidgetBehaviorHook {
                    hook_name: "useProfileCardPolling".to_owned(),
                },
            ),
            (
                json!({ "kind": "sharedCapabilityTypes" }),
                CodeProjectScaffoldCapability::SharedCapabilityTypes,
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

        fs::write(
            project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"C:Home.ui.tsx"}"#,
        )
        .expect("write Windows drive-relative config");
        let drive_relative = core
            .open_code_project(OpenCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect_err("Windows drive-relative entry must fail on every platform");
        assert_eq!(drive_relative.code(), "invalid_project");

        fs::create_dir_all(project.join("src")).expect("create normalized entry directory");
        fs::write(
            project.join("src/Home.ui.tsx"),
            "export function HomeUI() { return <main />; }\n",
        )
        .expect("write normalized entry");
        for malformed_entry in ["src//Home.ui.tsx", r"src\Home.ui.tsx"] {
            fs::write(
                project.join("srijika.config.json"),
                json!({"sourceOfTruth": "tsx", "entry": malformed_entry}).to_string(),
            )
            .expect("write non-normalized entry config");
            let error = core
                .open_code_project(OpenCodeProjectRequest {
                    path: project.to_string_lossy().into_owned(),
                })
                .expect_err("non-normalized entry must fail before opening a file");
            assert_eq!(error.code(), "invalid_project", "{malformed_entry}");
        }

        let deep_entry = format!(
            "{}/Home.ui.tsx",
            vec!["level"; MAX_PROJECT_ENTRY_SEGMENTS].join("/")
        );
        let deep_path = project.join(&deep_entry);
        fs::create_dir_all(deep_path.parent().expect("deep entry parent"))
            .expect("create real over-depth entry");
        fs::write(
            &deep_path,
            "export function HomeUI() { return <main />; }\n",
        )
        .expect("write real over-depth entry");
        fs::write(
            project.join("srijika.config.json"),
            json!({"sourceOfTruth": "tsx", "entry": deep_entry}).to_string(),
        )
        .expect("write over-depth entry config");
        let over_depth = core
            .open_code_project(OpenCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect_err("33-segment existing entry must fail closed");
        assert_eq!(over_depth.code(), "invalid_project");
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
    fn loads_architecture_sources_deterministically_while_ignoring_generated_directories() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("architecture-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        fs::create_dir_all(project.join("src/features/home/nested"))
            .expect("create nested source directory");
        fs::write(
            project.join("src/features/home/nested/srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"View.tsx"}"#,
        )
        .expect("write governed-root nested config marker");
        fs::create_dir_all(project.join("src/shared/capabilities/session"))
            .expect("create shared source directory");
        fs::write(
            project.join("src/features/home/a.ts"),
            "export const a = 1;\n",
        )
        .expect("write TS source");
        fs::write(
            project.join("src/features/home/nested/View.tsx"),
            "export function View() { return <section />; }\n",
        )
        .expect("write TSX source");
        fs::write(
            project.join("src/features/home/nested/module.mts"),
            "export {};\n",
        )
        .expect("write MTS source");
        fs::write(
            project.join("src/shared/capabilities/session/module.cts"),
            "export {};\n",
        )
        .expect("write CTS source");
        fs::write(
            project.join("src/features/home/runtime.js"),
            "export const runtime = true;\n",
        )
        .expect("write JS source");
        fs::write(
            project.join("src/features/home/nested/View.jsx"),
            "export function JsView() { return <section />; }\n",
        )
        .expect("write JSX source");
        fs::write(
            project.join("src/shared/capabilities/session/runtime.mjs"),
            "export {};\n",
        )
        .expect("write MJS source");
        fs::write(
            project.join("src/shared/capabilities/session/runtime.cjs"),
            "module.exports = {};\n",
        )
        .expect("write CJS source");
        fs::write(
            project.join("src/features/home/ambient.d.ts"),
            "declare const ambient: true;\n",
        )
        .expect("write declaration file");
        fs::write(
            project.join("src/features/home/ambient.d.tsx"),
            "export const governedTsx = true;\n",
        )
        .expect("write declaration TSX source");
        fs::write(
            project.join("src/Home.ui.tsx"),
            "export function HomeUI() { void fetch('/entry-runtime'); return <main />; }\n",
        )
        .expect("write authoritative entry outside ownership roots");
        let tsconfig_source = r#"{"compilerOptions":{"paths":{"@/*":["src/*"]}}}"#;
        fs::write(project.join("tsconfig.json"), tsconfig_source).expect("write TypeScript config");
        fs::write(
            project.join("src/features/home/nested/notes.css"),
            ".ignored {}\n",
        )
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
        for ignored in IGNORED_PROJECT_DIRECTORIES {
            let ignored_directory = project.join("src/features/home").join(ignored);
            fs::create_dir(&ignored_directory).expect("create ignored directory");
            fs::write(ignored_directory.join("hidden.ts"), "hidden\n")
                .expect("write ignored source");
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
        assert_eq!(first.tsconfig_source.as_deref(), Some(tsconfig_source));
        assert!(paths.contains(&"src/Home.ui.tsx".to_owned()));
        assert!(first.sources.iter().any(|source| {
            source.relative_path == "src/Home.ui.tsx" && source.source.contains("fetch(")
        }));
        assert!(paths.contains(&"src/features/home/a.ts".to_owned()));
        assert!(paths.contains(&"src/features/home/nested/View.tsx".to_owned()));
        assert!(paths.contains(&"src/features/home/nested/module.mts".to_owned()));
        assert!(paths.contains(&"src/shared/capabilities/session/module.cts".to_owned()));
        assert!(paths.contains(&"src/features/home/runtime.js".to_owned()));
        assert!(paths.contains(&"src/features/home/nested/View.jsx".to_owned()));
        assert!(paths.contains(&"src/shared/capabilities/session/runtime.mjs".to_owned()));
        assert!(paths.contains(&"src/shared/capabilities/session/runtime.cjs".to_owned()));
        assert!(!paths.contains(&"src/features/home/ambient.d.ts".to_owned()));
        assert!(!paths.contains(&"src/features/home/ambient.d.tsx".to_owned()));
        assert!(!paths.iter().any(|path| {
            IGNORED_PROJECT_DIRECTORIES
                .iter()
                .any(|ignored| path.split('/').any(|segment| segment == *ignored))
        }));
        assert!(!paths.iter().any(|path| path.contains("zz-nested-project")));
        assert!(!paths.iter().any(|path| path.ends_with("notes.css")));
        assert!(first.sources.iter().all(|source| {
            source.bytes == source.source.len() as u64 && source.hash.starts_with("fnv1a64:")
        }));
        assert!(!first.truncated);
    }

    #[test]
    fn architecture_source_reader_rejects_per_file_and_combined_limit_overflow() {
        let directory = tempdir().expect("temporary directory");
        let oversized_project = directory.path().join("oversized-architecture-project");
        fs::create_dir(&oversized_project).expect("create oversized project");
        write_code_project(&oversized_project, false, false);
        fs::create_dir_all(oversized_project.join("src/features/home"))
            .expect("create feature directory");
        fs::write(
            oversized_project.join("src/features/home/Oversized.ts"),
            vec![b'x'; MAX_ARCHITECTURE_SOURCE_BYTES as usize + 1],
        )
        .expect("write oversized architecture source");

        let oversized = StudioCore::default()
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: oversized_project.to_string_lossy().into_owned(),
            })
            .expect_err("oversized architecture source must fail closed");
        assert_eq!(oversized.code(), "invalid_project");
        assert!(oversized.to_string().contains("per-file size limit"));

        let combined_project = directory.path().join("combined-architecture-project");
        fs::create_dir(&combined_project).expect("create combined project");
        write_code_project(&combined_project, false, false);
        fs::create_dir_all(combined_project.join("src/features/home"))
            .expect("create feature directory");
        let bounded_source = vec![b'x'; MAX_ARCHITECTURE_SOURCE_BYTES as usize];
        for index in 0..7 {
            fs::write(
                combined_project.join(format!("src/features/home/blob-{index:02}.ts")),
                &bounded_source,
            )
            .expect("write bounded architecture source");
        }
        let combined = StudioCore::default()
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: combined_project.to_string_lossy().into_owned(),
            })
            .expect_err("combined architecture source overflow must fail closed");
        assert_eq!(combined.code(), "invalid_project");
        assert!(combined.to_string().contains("combined size limit"));

        let oversized_tsconfig_project = directory.path().join("oversized-tsconfig-project");
        fs::create_dir(&oversized_tsconfig_project).expect("create oversized tsconfig project");
        write_code_project(&oversized_tsconfig_project, false, false);
        fs::write(
            oversized_tsconfig_project.join("tsconfig.json"),
            vec![b' '; MAX_TYPESCRIPT_CONFIG_BYTES as usize + 1],
        )
        .expect("write oversized TypeScript config");
        let oversized_tsconfig = StudioCore::default()
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: oversized_tsconfig_project.to_string_lossy().into_owned(),
            })
            .expect_err("oversized TypeScript config must fail closed");
        assert_eq!(oversized_tsconfig.code(), "invalid_project");
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

        let real_parent = directory.path().join("real-parent");
        let child_project = real_parent.join("child-project");
        fs::create_dir_all(&child_project).expect("create project below real parent");
        write_code_project(&child_project, false, false);
        let linked_parent = directory.path().join("linked-parent");
        symlink(&real_parent, &linked_parent).expect("create ancestor directory symlink");
        let ancestor_link = core
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: linked_parent
                    .join("child-project")
                    .to_string_lossy()
                    .into_owned(),
            })
            .expect_err("project root with a symlink ancestor must fail");
        assert_eq!(ancestor_link.code(), "invalid_project");

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

        let linked_tsconfig_project = directory.path().join("linked-tsconfig-project");
        fs::create_dir(&linked_tsconfig_project).expect("create linked tsconfig project");
        write_code_project(&linked_tsconfig_project, false, false);
        let outside_tsconfig = directory.path().join("outside-tsconfig.json");
        fs::write(&outside_tsconfig, r#"{"compilerOptions":{}}"#)
            .expect("write outside TypeScript config");
        symlink(
            &outside_tsconfig,
            linked_tsconfig_project.join("tsconfig.json"),
        )
        .expect("create TypeScript config symlink");
        let linked_tsconfig = core
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: linked_tsconfig_project.to_string_lossy().into_owned(),
            })
            .expect_err("symlinked TypeScript config must fail closed");
        assert_eq!(linked_tsconfig.code(), "invalid_project");

        let linked_source_project = directory.path().join("linked-source-project");
        fs::create_dir(&linked_source_project).expect("create linked source project");
        write_code_project(&linked_source_project, false, false);
        fs::create_dir_all(linked_source_project.join("src/features/home"))
            .expect("create feature directory");
        let outside_source = directory.path().join("outside.ts");
        fs::write(&outside_source, "export const outside = true;\n").expect("write outside source");
        symlink(
            &outside_source,
            linked_source_project.join("src/features/home/Escape.ts"),
        )
        .expect("create architecture source symlink");

        let linked_source = core
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: linked_source_project.to_string_lossy().into_owned(),
            })
            .expect_err("symlinked architecture source must fail closed");
        assert_eq!(linked_source.code(), "invalid_project");
        assert!(linked_source.to_string().contains("symbolic links"));

        let unrelated_link_project = directory.path().join("unrelated-link-project");
        fs::create_dir(&unrelated_link_project).expect("create unrelated-link project");
        write_code_project(&unrelated_link_project, false, false);
        symlink(
            &outside_source,
            unrelated_link_project.join("src/Unrelated.ts"),
        )
        .expect("create unrelated source symlink");
        core.load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
            path: unrelated_link_project.to_string_lossy().into_owned(),
        })
        .expect("symlink outside configured ownership roots must be ignored");

        let ignored_link_project = directory.path().join("ignored-link-project");
        fs::create_dir(&ignored_link_project).expect("create ignored-link project");
        write_code_project(&ignored_link_project, false, false);
        fs::create_dir_all(ignored_link_project.join("src/features/home"))
            .expect("create ownership root");
        symlink(
            directory.path(),
            ignored_link_project.join("src/features/home/node_modules"),
        )
        .expect("create ignored-name symlink inside ownership root");
        let ignored_link = core
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: ignored_link_project.to_string_lossy().into_owned(),
            })
            .expect_err("ignored-name symlink inside ownership root must fail closed");
        assert_eq!(ignored_link.code(), "invalid_project");

        let internal_ancestor_project = directory.path().join("internal-ancestor-project");
        fs::create_dir(&internal_ancestor_project).expect("create internal-ancestor project");
        write_code_project(&internal_ancestor_project, false, false);
        fs::create_dir_all(internal_ancestor_project.join("real-application/modules"))
            .expect("create real configured root");
        symlink(
            internal_ancestor_project.join("real-application"),
            internal_ancestor_project.join("application"),
        )
        .expect("create internal configured-root ancestor symlink");
        fs::write(
            internal_ancestor_project.join("srijika.config.json"),
            r#"{"sourceOfTruth":"tsx","entry":"src/Home.ui.tsx","architecture":{"profile":"feature-slot-part-v1","featuresRoot":"application/modules","sharedRoot":"src/shared"}}"#,
        )
        .expect("write configured root config");
        let internal_ancestor = core
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: internal_ancestor_project.to_string_lossy().into_owned(),
            })
            .expect_err("internal configured-root symlink ancestor must fail");
        assert_eq!(internal_ancestor.code(), "invalid_project");
    }

    #[test]
    fn architecture_source_reader_rejects_non_utf8_source_instead_of_omitting_it() {
        let directory = tempdir().expect("temporary directory");
        let project = directory.path().join("non-utf8-architecture-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        fs::create_dir_all(project.join("src/features/home")).expect("create feature directory");
        fs::write(
            project.join("src/features/home/Broken.ts"),
            [0xff, 0xfe, 0xfd],
        )
        .expect("write non-UTF-8 source");

        let error = StudioCore::default()
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect_err("non-UTF-8 architecture source must fail closed");
        assert_eq!(error.code(), "persistence_error");
    }

    #[cfg(unix)]
    #[test]
    fn unix_file_stability_identity_includes_size_and_change_timestamps() {
        use std::os::unix::fs::MetadataExt;

        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("stable.ts");
        fs::write(&path, "a").expect("write first source");
        let before = fs::metadata(&path).expect("inspect first source");
        fs::write(&path, "changed in place").expect("mutate same inode");
        let after = fs::metadata(&path).expect("inspect changed source");
        assert_eq!(before.dev(), after.dev());
        assert_eq!(before.ino(), after.ino());
        assert!(!super::same_file_identity(&before, &after));

        let scanned_directory = directory.path().join("scanned");
        let replaced_directory = directory.path().join("scanned-old");
        fs::create_dir(&scanned_directory).expect("create scanned directory");
        let directory_before = fs::metadata(&scanned_directory).expect("inspect scanned directory");
        fs::rename(&scanned_directory, &replaced_directory)
            .expect("move original scanned directory");
        fs::create_dir(&scanned_directory).expect("replace scanned directory");
        let directory_after = fs::metadata(&scanned_directory).expect("inspect replacement");
        assert!(!super::same_file_identity(
            &directory_before,
            &directory_after
        ));
    }

    #[test]
    fn architecture_source_reader_uses_the_independent_contract_budgets() {
        let architecture = configured_architecture(
            json!({"sourceOfTruth": "tsx", "entry": "src/Home.ui.tsx"})
                .as_object()
                .expect("config object"),
        )
        .expect("default architecture");
        let budget = ProjectTreeScan::architecture(Path::new("/project"), &architecture);
        assert_eq!(budget.max_entries, MAX_ARCHITECTURE_SCAN_ENTRIES);
        assert_eq!(
            budget.max_directories,
            Some(MAX_ARCHITECTURE_SCAN_DIRECTORIES)
        );
        assert_eq!(budget.max_depth, MAX_ARCHITECTURE_SCAN_DEPTH);
        assert_eq!(budget.max_metadata_bytes, None);
        assert_eq!(budget.max_hash_bytes, None);

        let mut missing_root_budget =
            ProjectTreeScan::architecture(Path::new("/project"), &architecture);
        missing_root_budget.max_directories = Some(1);
        missing_root_budget.record_directory_visit();
        assert!(!missing_root_budget.truncated);
        missing_root_budget.record_directory_visit();
        assert!(missing_root_budget.truncated);

        let directory = tempdir().expect("temporary directory");
        let ignored_entry_root = directory.path().join("ignored-entry-budget");
        fs::create_dir(&ignored_entry_root).expect("create ignored-entry budget root");
        fs::create_dir(ignored_entry_root.join(".next")).expect("create ignored entry");
        fs::write(ignored_entry_root.join("visible.ts"), "export {};\n")
            .expect("write visible source");
        let mut ignored_entry_budget =
            ProjectTreeScan::architecture(&ignored_entry_root, &architecture);
        ignored_entry_budget.max_entries = 1;
        scan_directory(
            &ignored_entry_root,
            Path::new("src/features"),
            1,
            &mut ignored_entry_budget,
        )
        .expect("scan physical entries");
        assert_eq!(ignored_entry_budget.scanned_entries, 2);
        assert!(ignored_entry_budget.truncated);

        let exact_entry_root = directory.path().join("exact-entry-budget");
        fs::create_dir(&exact_entry_root).expect("create exact-entry budget root");
        let mut exact_entry_budget =
            ProjectTreeScan::architecture(&exact_entry_root, &architecture);
        exact_entry_budget.scanned_entries = exact_entry_budget.max_entries;
        scan_directory(
            &exact_entry_root,
            Path::new("src/features/empty"),
            1,
            &mut exact_entry_budget,
        )
        .expect("scan empty directory at exact physical-entry boundary");
        assert!(!exact_entry_budget.truncated);
        fs::write(exact_entry_root.join("overflow.ts"), "export {};\n")
            .expect("write first over-budget physical entry");
        scan_directory(
            &exact_entry_root,
            Path::new("src/features/overflow"),
            1,
            &mut exact_entry_budget,
        )
        .expect("scan over-budget directory");
        assert!(exact_entry_budget.truncated);

        let project = directory.path().join("independent-budget-project");
        fs::create_dir(&project).expect("create project");
        write_code_project(&project, false, false);
        let feature = project.join("src/features/home");
        fs::create_dir_all(&feature).expect("create feature directory");
        for index in 0..5_000 {
            fs::write(feature.join(format!("note-{index:05}.txt")), "not source\n")
                .expect("write non-source entry");
        }
        let loaded = StudioCore::default()
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("architecture reader must not inherit the Explorer 4096-entry cap");
        assert_eq!(
            loaded
                .sources
                .iter()
                .map(|source| source.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["src/Home.ui.tsx"]
        );

        let deep_project = directory.path().join("architecture-depth-project");
        fs::create_dir(&deep_project).expect("create deep project");
        write_code_project(&deep_project, false, false);
        let mut nested = deep_project.join("src/features");
        for index in 0..MAX_ARCHITECTURE_SCAN_DEPTH.saturating_sub(1) {
            nested = nested.join(format!("level-{index:02}"));
        }
        fs::create_dir_all(&nested).expect("create architecture-depth tree");
        fs::write(nested.join("boundary.ts"), "export {};\n").expect("write boundary source");
        let boundary = StudioCore::default()
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: deep_project.to_string_lossy().into_owned(),
            })
            .expect("architecture root plus 31 descendants must fit depth 32");
        assert!(
            boundary
                .sources
                .iter()
                .any(|source| source.relative_path.ends_with("/boundary.ts"))
        );

        let overflow = nested.join("too-deep");
        fs::create_dir(&overflow).expect("create over-depth directory");
        fs::write(overflow.join("hidden.ts"), "export {};\n").expect("write deep source");
        let depth_error = StudioCore::default()
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: deep_project.to_string_lossy().into_owned(),
            })
            .expect_err("architecture depth overflow must fail closed");
        assert_eq!(depth_error.code(), "invalid_project");
        assert!(depth_error.to_string().contains("complete-project"));

        let source_count_project = directory.path().join("architecture-source-count-project");
        fs::create_dir(&source_count_project).expect("create source-count project");
        write_code_project(&source_count_project, false, false);
        let source_count_feature = source_count_project.join("src/features/home");
        fs::create_dir_all(&source_count_feature).expect("create source-count Feature");
        for index in 0..=MAX_ARCHITECTURE_SOURCE_FILES {
            fs::write(
                source_count_feature.join(format!("source-{index:05}.ts")),
                "export {};\n",
            )
            .expect("write counted architecture source");
        }
        let count_error = StudioCore::default()
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: source_count_project.to_string_lossy().into_owned(),
            })
            .expect_err("architecture source count overflow must fail closed");
        assert_eq!(count_error.code(), "invalid_project");
        assert!(count_error.to_string().contains("source file count limit"));
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
        let architecture = StudioCore::default()
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("unrelated deep tree must not affect ownership architecture scan");
        assert_eq!(architecture.sources.len(), 1);
        assert_eq!(architecture.sources[0].relative_path, "src/Home.ui.tsx");
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
        assert!(scan.entries.is_empty());
        let repeated = StudioCore::default()
            .scan_code_project(ScanCodeProjectRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("repeat bounded wide scan");
        assert!(repeated.truncated);
        assert_eq!(scan.entries, repeated.entries);
        let architecture = StudioCore::default()
            .load_code_project_architecture_sources(LoadCodeProjectArchitectureSourcesRequest {
                path: project.to_string_lossy().into_owned(),
            })
            .expect("unrelated wide tree must not affect ownership architecture scan");
        assert_eq!(architecture.sources.len(), 1);
        assert_eq!(architecture.sources[0].relative_path, "src/Home.ui.tsx");
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
