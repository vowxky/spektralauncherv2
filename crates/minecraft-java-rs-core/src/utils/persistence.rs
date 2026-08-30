use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Serialize;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn backup_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_owned();
    value.push(".bak");
    PathBuf::from(value)
}

fn temp_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_owned();
    value.push(format!(
        ".{}.{}.tmp",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    PathBuf::from(value)
}

pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let temp = temp_path(path);
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(data)?;
        file.flush()?;
        file.sync_all()?;
        drop(file);

        let mut delay = 40u64;
        for attempt in 0..=8 {
            if path.exists() {
                match std::fs::remove_file(path) {
                    Ok(()) => {}
                    Err(_) if attempt < 8 => {
                        std::thread::sleep(Duration::from_millis(delay));
                        delay = (delay * 2).min(1_000);
                        continue;
                    }
                    Err(error) => return Err(error),
                }
            }
            match std::fs::rename(&temp, path) {
                Ok(()) => return Ok(()),
                Err(_) if attempt < 8 => {
                    std::thread::sleep(Duration::from_millis(delay));
                    delay = (delay * 2).min(1_000);
                }
                Err(error) => return Err(error),
            }
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "atomic write failed",
        ))
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

pub fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let mut data = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    data.push(b'\n');

    if let Ok(existing) = std::fs::read(path) {
        if serde_json::from_slice::<serde_json::Value>(&existing).is_ok() {
            write_atomic(&backup_path(path), &existing).map_err(|error| error.to_string())?;
        }
    }

    write_atomic(path, &data).map_err(|error| error.to_string())
}

pub fn load_json<T>(path: &Path) -> Result<T, String>
where
    T: DeserializeOwned + Serialize,
{
    let mut primary_error = None;
    if let Ok(mut file) = std::fs::File::open(path) {
        let mut data = Vec::new();
        match file.read_to_end(&mut data) {
            Ok(_) => match serde_json::from_slice::<T>(&data) {
                Ok(value) => return Ok(value),
                Err(error) => primary_error = Some(error.to_string()),
            },
            Err(error) => primary_error = Some(error.to_string()),
        }
    }

    let backup = backup_path(path);
    if let Ok(data) = std::fs::read(&backup) {
        if let Ok(value) = serde_json::from_slice::<T>(&data) {
            write_atomic(path, &data).map_err(|error| error.to_string())?;
            return Ok(value);
        }
    }

    Err(primary_error.unwrap_or_else(|| format!("missing JSON file: {}", path.display())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct TestData {
        value: u32,
    }

    #[test]
    fn restores_last_valid_json_from_backup() {
        let root = std::env::temp_dir().join(format!(
            "spektra-persistence-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let path = root.join("data.json");
        save_json(&path, &TestData { value: 1 }).unwrap();
        save_json(&path, &TestData { value: 2 }).unwrap();
        std::fs::write(&path, b"{broken").unwrap();

        let restored: TestData = load_json(&path).unwrap();
        assert_eq!(restored, TestData { value: 1 });
        let _ = std::fs::remove_dir_all(root);
    }
}
