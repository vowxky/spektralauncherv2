use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
const MAX_LOG_FILES: u32 = 4;

#[derive(Serialize, Clone)]
pub struct InstanceLog {
    pub instance: String,
    pub r#type: String,
    pub message: String,
    pub timestamp: String,
}

pub fn log_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("spektra")
        .join("logs")
}

fn log_file_name(instance_id: &str) -> String {
    let safe: String = instance_id
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let safe = if safe.is_empty() { "instance".to_string() } else { safe };
    format!("{}.log", safe)
}

fn log_file_path(instance_id: &str) -> PathBuf {
    log_dir().join(log_file_name(instance_id))
}

fn timestamp_now() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
}

/// Rotate a log file once it exceeds MAX_LOG_BYTES: shift `.log.1` → `.log.2`,
/// etc. and rename the current file to `.log.1`.
fn rotate_if_needed(path: &PathBuf) {
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if meta.len() < MAX_LOG_BYTES {
        return;
    }
    for i in (1..=MAX_LOG_FILES).rev() {
        let from = path.with_extension(format!("log.{}", i));
        let to = path.with_extension(format!("log.{}", i + 1));
        if to.exists() {
            let _ = fs::remove_file(&to);
        }
        if from.exists() {
            let _ = fs::rename(&from, &to);
        }
    }
    let _ = fs::rename(path, path.with_extension("log.1"));
}

pub fn write_to_file(instance_id: &str, log_type: &str, message: &str) {
    let dir = log_dir();
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = log_file_path(instance_id);
    rotate_if_needed(&path);
    let line = format!(
        "[{}] [{}] {}\n",
        timestamp_now(),
        log_type.to_uppercase(),
        message
    );
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
    }
}

pub fn read_log_tail(instance_id: &str, lines: usize) -> Vec<String> {
    let content = fs::read_to_string(log_file_path(instance_id)).unwrap_or_default();
    let count = lines.max(1).min(2000);
    content
        .lines()
        .rev()
        .take(count)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(ToString::to_string)
        .collect()
}

pub fn clear_logs(instance_id: &str) {
    let path = log_file_path(instance_id);
    let _ = fs::remove_file(&path);
    for i in 1..=MAX_LOG_FILES {
        let rotated = path.with_extension(format!("log.{}", i));
        if rotated.exists() {
            let _ = fs::remove_file(&rotated);
        }
    }
}

pub fn emit_log(app: &AppHandle, instance_id: &str, log_type: &str, message: &str) {
    let ts = timestamp_now();
    println!("[{}] {}", ts, message);
    write_to_file(instance_id, log_type, message);
    app.emit(
        "instance-logger",
        InstanceLog {
            instance: instance_id.to_string(),
            r#type: log_type.to_string(),
            message: message.to_string(),
            timestamp: ts,
        },
    )
    .ok();
}

pub fn emit_java_log(app: &AppHandle, version: u32, message: &str) {
    let ts = timestamp_now();
    println!("[{}] [JAVA {}] {}", ts, version, message);
    write_to_file(&format!("java-{}", version), "log", message);
    app.emit(
        "java-log",
        serde_json::json!({ "version": version, "message": message, "timestamp": ts }),
    )
    .ok();
}

#[macro_export]
macro_rules! ilog {
    ($app:expr, $instance_id:expr, $($arg:tt)*) => {{
        let msg = format!($($arg)*);
        $crate::logger::emit_log($app, $instance_id, "log", &msg);
    }};
}

#[macro_export]
macro_rules! ilog_err {
    ($app:expr, $instance_id:expr, $($arg:tt)*) => {{
        let msg = format!($($arg)*);
        $crate::logger::emit_log($app, $instance_id, "error", &msg);
    }};
}