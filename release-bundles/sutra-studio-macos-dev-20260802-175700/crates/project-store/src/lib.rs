#![forbid(unsafe_code)]

use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde::{Serialize, de::DeserializeOwned};
use tempfile::Builder;
use thiserror::Error;

/// Default upper bound for a persisted Sutra JSON document.
///
/// The limit protects the desktop process from accidentally reading an
/// unbounded file while remaining generous for the UI MVP.
pub const DEFAULT_MAX_JSON_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct JsonProjectStore {
    max_json_bytes: u64,
}

impl Default for JsonProjectStore {
    fn default() -> Self {
        Self {
            max_json_bytes: DEFAULT_MAX_JSON_BYTES,
        }
    }
}

impl JsonProjectStore {
    pub fn with_max_json_bytes(max_json_bytes: u64) -> Result<Self, StoreError> {
        if max_json_bytes == 0 {
            return Err(StoreError::InvalidSizeLimit);
        }

        Ok(Self { max_json_bytes })
    }

    pub fn max_json_bytes(&self) -> u64 {
        self.max_json_bytes
    }

    /// Loads and deserializes a size-bounded JSON file.
    ///
    /// The file length is checked both before and while reading so a file that
    /// grows concurrently cannot bypass the configured limit.
    pub fn load<T>(&self, path: impl AsRef<Path>) -> Result<LoadedJson<T>, StoreError>
    where
        T: DeserializeOwned,
    {
        let path = path.as_ref();
        let metadata = fs::metadata(path).map_err(|source| StoreError::Io {
            operation: "inspect JSON file",
            path: path.to_path_buf(),
            source,
        })?;

        if !metadata.is_file() {
            return Err(StoreError::NotAFile(path.to_path_buf()));
        }

        self.ensure_size(path, metadata.len())?;

        let file = File::open(path).map_err(|source| StoreError::Io {
            operation: "open JSON file",
            path: path.to_path_buf(),
            source,
        })?;
        let initial_capacity = metadata
            .len()
            .min(self.max_json_bytes)
            .min(usize::MAX as u64) as usize;
        let mut bytes = Vec::with_capacity(initial_capacity);
        file.take(self.max_json_bytes.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|source| StoreError::Io {
                operation: "read JSON file",
                path: path.to_path_buf(),
                source,
            })?;
        self.ensure_size(path, bytes.len() as u64)?;

        let value = serde_json::from_slice(&bytes).map_err(|source| StoreError::Deserialize {
            path: path.to_path_buf(),
            source,
        })?;

        Ok(LoadedJson {
            value,
            bytes: bytes.len() as u64,
        })
    }

    /// Serializes JSON and atomically replaces the destination.
    ///
    /// The temporary file is created in the destination directory, flushed,
    /// and fsynced before an atomic rename. This guarantees readers see either
    /// the previous complete document or the new complete document, never a
    /// partially-written JSON payload.
    pub fn save<T>(&self, path: impl AsRef<Path>, value: &T) -> Result<SaveReceipt, StoreError>
    where
        T: Serialize + ?Sized,
    {
        let path = path.as_ref();
        let file_name = path
            .file_name()
            .filter(|name| !name.is_empty())
            .ok_or_else(|| StoreError::MissingFileName(path.to_path_buf()))?;
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));

        let parent_metadata = fs::metadata(parent).map_err(|source| StoreError::Io {
            operation: "inspect destination directory",
            path: parent.to_path_buf(),
            source,
        })?;
        if !parent_metadata.is_dir() {
            return Err(StoreError::NotADirectory(parent.to_path_buf()));
        }

        let replaced = match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_dir() => {
                return Err(StoreError::NotAFile(path.to_path_buf()));
            }
            Ok(_) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(source) => {
                return Err(StoreError::Io {
                    operation: "inspect destination file",
                    path: path.to_path_buf(),
                    source,
                });
            }
        };

        let mut bytes = serde_json::to_vec_pretty(value).map_err(StoreError::Serialize)?;
        bytes.push(b'\n');
        self.ensure_size(path, bytes.len() as u64)?;

        let prefix = format!(".{}.", file_name.to_string_lossy());
        let mut temporary = Builder::new()
            .prefix(&prefix)
            .suffix(".sutra.tmp")
            .tempfile_in(parent)
            .map_err(|source| StoreError::Io {
                operation: "create temporary JSON file",
                path: parent.to_path_buf(),
                source,
            })?;

        if replaced {
            let permissions = fs::metadata(path)
                .map_err(|source| StoreError::Io {
                    operation: "inspect destination permissions",
                    path: path.to_path_buf(),
                    source,
                })?
                .permissions();
            temporary
                .as_file()
                .set_permissions(permissions)
                .map_err(|source| StoreError::Io {
                    operation: "preserve destination permissions",
                    path: temporary.path().to_path_buf(),
                    source,
                })?;
        }

        temporary
            .as_file_mut()
            .write_all(&bytes)
            .and_then(|_| temporary.as_file_mut().flush())
            .map_err(|source| StoreError::Io {
                operation: "write temporary JSON file",
                path: temporary.path().to_path_buf(),
                source,
            })?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|source| StoreError::Io {
                operation: "sync temporary JSON file",
                path: temporary.path().to_path_buf(),
                source,
            })?;

        temporary.persist(path).map_err(|error| StoreError::Io {
            operation: "replace destination JSON file",
            path: path.to_path_buf(),
            source: error.error,
        })?;

        sync_parent_directory(parent)?;

        Ok(SaveReceipt {
            bytes: bytes.len() as u64,
            replaced,
        })
    }

    fn ensure_size(&self, path: &Path, actual: u64) -> Result<(), StoreError> {
        if actual > self.max_json_bytes {
            return Err(StoreError::TooLarge {
                path: path.to_path_buf(),
                max: self.max_json_bytes,
                actual,
            });
        }

        Ok(())
    }
}

#[cfg(unix)]
fn sync_parent_directory(parent: &Path) -> Result<(), StoreError> {
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|source| StoreError::Io {
            operation: "sync destination directory",
            path: parent.to_path_buf(),
            source,
        })
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) -> Result<(), StoreError> {
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedJson<T> {
    pub value: T,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SaveReceipt {
    pub bytes: u64,
    pub replaced: bool,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("JSON size limit must be greater than zero")]
    InvalidSizeLimit,
    #[error("path does not identify a file name: {0}")]
    MissingFileName(PathBuf),
    #[error("path is not a regular file: {0}")]
    NotAFile(PathBuf),
    #[error("path is not a directory: {0}")]
    NotADirectory(PathBuf),
    #[error("JSON file {path} is {actual} bytes; maximum allowed is {max} bytes")]
    TooLarge {
        path: PathBuf,
        max: u64,
        actual: u64,
    },
    #[error("could not serialize JSON: {0}")]
    Serialize(#[source] serde_json::Error),
    #[error("could not deserialize JSON from {path}: {source}")]
    Deserialize {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("could not {operation} at {path}: {source}")]
    Io {
        operation: &'static str,
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde::{Serialize, Serializer, ser::Error as _};
    use serde_json::{Value, json};
    use tempfile::tempdir;

    use super::{JsonProjectStore, StoreError};

    #[test]
    fn atomically_round_trips_pretty_json() {
        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("home.sutra.json");
        let store = JsonProjectStore::default();
        let document = json!({"formatVersion": 1, "name": "Home"});

        let first = store.save(&path, &document).expect("first save");
        assert!(!first.replaced);

        let bytes = fs::read(&path).expect("saved bytes");
        assert_eq!(bytes.last(), Some(&b'\n'));
        assert!(
            String::from_utf8(bytes)
                .expect("utf8")
                .contains("\n  \"name\"")
        );

        let loaded = store.load::<Value>(&path).expect("load");
        assert_eq!(loaded.value, document);
        assert_eq!(loaded.bytes, first.bytes);

        let second = store
            .save(&path, &json!({"formatVersion": 1, "name": "Changed"}))
            .expect("replacement save");
        assert!(second.replaced);
        assert_eq!(
            store.load::<Value>(&path).expect("replacement load").value,
            json!({"formatVersion": 1, "name": "Changed"})
        );

        let leftovers = fs::read_dir(directory.path())
            .expect("directory listing")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".sutra.tmp"))
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn serialization_failure_preserves_the_previous_file() {
        struct FailingValue;

        impl Serialize for FailingValue {
            fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                Err(S::Error::custom("intentional serialization failure"))
            }
        }

        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("home.sutra.json");
        fs::write(&path, b"{\"stable\":true}\n").expect("seed file");

        let error = JsonProjectStore::default()
            .save(&path, &FailingValue)
            .expect_err("save must fail");
        assert!(matches!(error, StoreError::Serialize(_)));
        assert_eq!(
            fs::read(&path).expect("preserved file"),
            b"{\"stable\":true}\n"
        );
    }

    #[test]
    fn rejects_invalid_and_oversized_json() {
        let directory = tempdir().expect("temporary directory");
        let invalid_path = directory.path().join("invalid.json");
        fs::write(&invalid_path, b"{not-json}").expect("invalid fixture");
        let store = JsonProjectStore::with_max_json_bytes(32).expect("store");

        assert!(matches!(
            store.load::<Value>(&invalid_path),
            Err(StoreError::Deserialize { .. })
        ));

        let oversized_path = directory.path().join("oversized.json");
        fs::write(&oversized_path, vec![b'x'; 33]).expect("oversized fixture");
        assert!(matches!(
            store.load::<Value>(&oversized_path),
            Err(StoreError::TooLarge {
                max: 32,
                actual: 33,
                ..
            })
        ));
        assert!(matches!(
            store.save(
                &oversized_path,
                &json!({"value": "abcdefghijklmnopqrstuvwxyz"})
            ),
            Err(StoreError::TooLarge { max: 32, .. })
        ));
    }

    #[test]
    fn refuses_zero_byte_limit() {
        assert!(matches!(
            JsonProjectStore::with_max_json_bytes(0),
            Err(StoreError::InvalidSizeLimit)
        ));
    }
}
