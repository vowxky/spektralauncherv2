#![allow(dead_code)]

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;
use std::{fs, path::{Component, Path, PathBuf}};
use tauri::Emitter;
use tauri::{command, AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::core::instance_manager::Instance;
use crate::discord;
use crate::ilog;
use crate::ilog_err;
use crate::state::AppState;
use sha1::{Digest, Sha1};

use minecraft_java_rs_core::{
    launcher::{
        events::LaunchEvent,
        options::{JavaOptions, LaunchOptions, LoaderConfig, MemoryConfig, ScreenConfig},
        Launcher,
    },
    models::{loader::LoaderType, minecraft::Authenticator},
    net::downloader::{DownloadItem, Downloader},
    utils::persistence::{load_json, save_json, write_atomic},
};
use tokio::sync::mpsc;

const VERIFY_URL: &str = "http://gs00s44ogw8cc0wc4s4kwwc0.51.222.106.204.sslip.io/";
const LAUNCHER_ID: &str = "spektra";
const API_URL: &str = "https://fitzxel-cl-api.vercel.app/v2";

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .build()
        .unwrap_or_default()
}

fn build_client_with_timeout(secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .timeout(Duration::from_secs(secs))
        .build()
        .unwrap_or_default()
}

fn emit_launch_error(app: &AppHandle, log_id: &str, instance_id: &str, msg: &str) {
    ilog_err!(app, log_id, "LAUNCH ERROR: {}", msg);
    app.emit("minecraft-error", serde_json::json!({ "instanceId": instance_id, "message": msg })).ok();
    app.emit("minecraft-status", serde_json::json!({ "instanceId": instance_id, "status": format!("Error: {}", msg), "indeterminate": false })).ok();
    // Popup nativo del OS — siempre visible aunque el frontend esté congelado en 95%
    let title = "Error al iniciar Minecraft".to_string();
    let body = msg.to_string();
    // dialog().message().show() usa callback, no bloquea el runtime de Tauri
    app.dialog().message(body).title(title).show(|_| {});
}

fn emit_progress_error(app: &AppHandle, instance_id: &str, msg: &str) {
    app.emit("minecraft-error", serde_json::json!({ "instanceId": instance_id, "message": msg })).ok();
    app.emit("minecraft-status", serde_json::json!({ "instanceId": instance_id, "status": format!("Error: {}", msg) })).ok();
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceRuntimeSettings {
    memory_mode: Option<String>,
    min_ram_mb: Option<u32>,
    max_ram_mb: Option<u32>,
    java_mode: Option<String>,
    java_path: Option<String>,
    resolution_mode: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    fullscreen: Option<bool>,
    extra_jvm_args: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SyncManifest {
    #[serde(default)]
    schema_version: u32,
    files: HashMap<String, String>,
    overrides_hash: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct RemoteHashes {
    sha1: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RemoteInstanceFile {
    path: String,
    #[serde(default)]
    hashes: RemoteHashes,
    #[serde(default)]
    downloads: Vec<String>,
    size: Option<u64>,
}

fn manifest_path(instance_dir: &PathBuf) -> PathBuf {
    instance_dir.join(".mstack-manifest.json")
}

fn load_manifest(instance_dir: &PathBuf) -> SyncManifest {
    load_json(&manifest_path(instance_dir)).unwrap_or_default()
}

fn save_manifest(instance_dir: &PathBuf, manifest: &SyncManifest) -> Result<(), String> {
    save_json(&manifest_path(instance_dir), manifest)
}

fn sha1_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn sha1_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn safe_instance_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("Ruta de archivo no válida: {}", relative));
    }
    Ok(root.join(path))
}

#[command]
pub async fn get_instances() -> Result<Vec<Value>, String> {
    let url = format!("{}/{}/instances", API_URL, LAUNCHER_ID);
    let client = build_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Vec<Value>>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(resp)
}

#[command]
pub async fn verify_account(name: String) -> Result<bool, String> {
    let client = build_client();
    let data: Value = client
        .get(VERIFY_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let names = data["names"]
        .as_array()
        .ok_or_else(|| "Invalid verification response".to_string())?;
    Ok(names.iter().any(|n| n.as_str() == Some(name.as_str())))
}

#[command]
pub async fn get_instance(
    id: Option<String>,
    slug: Option<String>,
) -> Result<Value, String> {
    let query = if let Some(i) = id {
        format!("id={}", i)
    } else if let Some(s) = slug {
        format!("slug={}", s)
    } else {
        return Err("No instance specified".into());
    };
    let url = format!("{}/{}/instance?{}", API_URL, LAUNCHER_ID, query);
    let client = build_client();
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if response.status() == 404 {
        return Err("404: Instance not found".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "Error {}: failed to get instance",
            response.status()
        ));
    }
    let data = response.json::<Value>().await.map_err(|e| e.to_string())?;
    Ok(data)
}

#[command]
pub fn discord_set_idle() {
    discord::set_idle();
}

#[command]
pub fn discord_set_home() {
    discord::set_home();
}

#[command]
pub fn discord_set_login() {
    discord::set_login();
}

#[command]
pub fn discord_set_settings() {
    discord::set_settings();
}

#[command]
pub fn discord_set_browsing() {
    discord::set_browsing();
}

#[command]
pub fn discord_set_downloading(name: String, progress: Option<u8>) {
    discord::set_downloading(&name, progress);
}

#[command]
pub fn discord_set_installing(name: String) {
    discord::set_installing(&name);
}

#[command]
pub fn discord_set_playing(name: String, loader: Option<String>) {
    discord::set_playing(&name, loader.as_deref());
}

#[command]
pub fn uninstall_instance(instance_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let instance_path = {
        let manager = state.instances.lock().unwrap();
        manager
            .instances
            .iter()
            .find(|i| i.id == instance_id)
            .map(|i| i.path.clone())
    };
    if let Some(path) = instance_path {
        if path.exists() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("Error removing instance folder: {}", e))?;
        }
    }
    {
        let mut manager = state.instances.lock().unwrap();
        manager.instances.retain(|i| i.id != instance_id);
    }
    Ok(())
}

#[command]
pub async fn install_instance_files(
    app: AppHandle,
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let instance = {
        let manager = state.instances.lock().unwrap();
        manager
            .instances
            .iter()
            .find(|i| i.id == instance_id)
            .cloned()
            .ok_or_else(|| format!("Instance '{}' not found", instance_id))?
    };
    let log_id = format!("{}-{}", instance.id, instance.slug.as_deref().unwrap_or(""));
    let instance_dir = instance.path.clone();
    fs::create_dir_all(&instance_dir).map_err(|error| error.to_string())?;

    let url = format!("{}/instance/{}/files", API_URL, instance_id);
    let client = build_client_with_timeout(300);
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("Error descargando el manifiesto: {}", error))?
        .error_for_status()
        .map_err(|error| format!("El servidor rechazó el manifiesto: {}", error))?;
    let manifest_text = response
        .text()
        .await
        .map_err(|error| format!("Error leyendo el manifiesto: {}", error))?;
    let files: Vec<RemoteInstanceFile> = serde_json::from_str(&manifest_text)
        .map_err(|error| format!("El manifiesto de archivos contiene JSON inválido: {}", error))?;
    ilog!(&app, &log_id, "Total remote files: {}", files.len());
    let total = files.len();
    let overrides = files
        .iter()
        .find(|file| file.path == "overrides.zip")
        .cloned();
    let regular_files: Vec<RemoteInstanceFile> = files
        .into_iter()
        .filter(|file| file.path != "overrides.zip")
        .collect();

    let mut manifest = load_manifest(&instance_dir);
    let remote_paths: HashSet<String> = regular_files
        .iter()
        .map(|file| file.path.clone())
        .collect();
    let to_delete: Vec<String> = manifest
        .files
        .keys()
        .filter(|p| !remote_paths.contains(*p))
        .cloned()
        .collect();
    let mut pending = Vec::new();
    let mut new_hashes = HashMap::new();
    for file in &regular_files {
        let local_path = safe_instance_path(&instance_dir, &file.path)?;
        let expected_hash = file.hashes.sha1.as_ref().map(|hash| hash.to_lowercase());
        let expected_size = file.size.unwrap_or(0);
        let size_matches = local_path
            .metadata()
            .map(|metadata| expected_size == 0 || metadata.len() == expected_size)
            .unwrap_or(false);
        let existing_hash = if local_path.exists()
            && size_matches
            && expected_hash.is_some()
        {
            sha1_file(&local_path).ok()
        } else {
            None
        };
        let valid = local_path.exists()
            && size_matches
            && match &expected_hash {
                Some(hash) => existing_hash.as_ref() == Some(hash),
                None => true,
            };

        if valid {
            new_hashes.insert(
                file.path.clone(),
                expected_hash
                    .or(existing_hash)
                    .unwrap_or_else(|| manifest.files.get(&file.path).cloned().unwrap_or_default()),
            );
            continue;
        }

        let download_url = file
            .downloads
            .first()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("{} no tiene una URL de descarga", file.path))?;
        let parent = local_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| instance_dir.clone());
        pending.push(DownloadItem {
            url: download_url.clone(),
            path: local_path,
            folder: parent,
            name: file.path.clone(),
            size: expected_size,
            r#type: Some("instance".to_string()),
            sha1: expected_hash,
        });
    }

    let already_valid = regular_files.len().saturating_sub(pending.len());
    if !pending.is_empty() {
        ilog!(
            &app,
            &log_id,
            "Descargando {} archivos con verificación de integridad",
            pending.len()
        );
        let downloader = Downloader::new(300, 16, false, None);
        let (event_tx, mut event_rx) = mpsc::channel::<LaunchEvent>(256);
        let progress_app = app.clone();
        let progress_instance = instance_id.clone();
        let progress_task = tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                if let LaunchEvent::Progress { downloaded, .. } = event {
                    progress_app
                        .emit(
                            "instance-progress",
                            serde_json::json!({
                                "instanceId": &progress_instance,
                                "current": already_valid + downloaded as usize,
                                "total": total
                            }),
                        )
                        .ok();
                }
            }
        });
        let download_result = downloader.download_multiple(pending, event_tx).await;
        let _ = progress_task.await;
        download_result.map_err(|error| format!("Instalación incompleta: {}", error))?;
    }

    for file in &regular_files {
        let local_path = safe_instance_path(&instance_dir, &file.path)?;
        let actual_hash = match file.hashes.sha1.as_ref() {
            Some(hash) => hash.to_lowercase(),
            None => sha1_file(&local_path)
                .map_err(|error| format!("No se pudo verificar {}: {}", file.path, error))?,
        };
        new_hashes.insert(file.path.clone(), actual_hash);
    }
    manifest.files = new_hashes;

    if let Some(file) = overrides {
        let local_path = safe_instance_path(&instance_dir, &file.path)?;
        let download_url = file
            .downloads
            .first()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "overrides.zip no tiene una URL de descarga".to_string())?;
        let expected_hash = file.hashes.sha1.as_ref().map(|hash| hash.to_lowercase());
        let should_download = expected_hash
            .as_ref()
            .map_or(true, |hash| manifest.overrides_hash.as_ref() != Some(hash));

        if should_download {
            let downloader = Downloader::new(300, 1, false, None);
            downloader
                .download_file(&DownloadItem {
                    url: download_url.clone(),
                    path: local_path.clone(),
                    folder: instance_dir.clone(),
                    name: file.path.clone(),
                    size: file.size.unwrap_or(0),
                    r#type: Some("overrides".to_string()),
                    sha1: expected_hash,
                })
                .await
                .map_err(|error| format!("No se pudo descargar overrides.zip: {}", error))?;

            let zip_bytes = fs::read(&local_path)
                .map_err(|error| format!("No se pudo leer overrides.zip: {}", error))?;
            let extracted_hash = sha1_hex(&zip_bytes);
            let cursor = std::io::Cursor::new(zip_bytes);
            let mut archive = zip::ZipArchive::new(cursor)
                .map_err(|error| format!("overrides.zip está dañado: {}", error))?;
            app.emit(
                "instance-status",
                serde_json::json!({ "instanceId": &instance_id, "status": "Extracting overrides..." }),
            )
            .ok();
            for index in 0..archive.len() {
                let mut zip_file = archive
                    .by_index(index)
                    .map_err(|error| format!("No se pudo leer overrides.zip: {}", error))?;
                let enclosed = zip_file
                    .enclosed_name()
                    .ok_or_else(|| format!("Ruta insegura en overrides.zip: {}", zip_file.name()))?
                    .to_path_buf();
                let out_path = instance_dir.join(enclosed);
                if zip_file.is_dir() {
                    fs::create_dir_all(&out_path).map_err(|error| error.to_string())?;
                } else {
                    let mut contents = Vec::new();
                    zip_file
                        .read_to_end(&mut contents)
                        .map_err(|error| format!("No se pudo extraer {}: {}", zip_file.name(), error))?;
                    write_atomic(&out_path, &contents)
                        .map_err(|error| format!("No se pudo guardar {}: {}", out_path.display(), error))?;
                }
            }
            let _ = fs::remove_file(&local_path);
            manifest.overrides_hash = Some(extracted_hash);
        }
    }

    for path in &to_delete {
        let local_path = safe_instance_path(&instance_dir, path)?;
        if local_path.exists() {
            fs::remove_file(&local_path)
                .map_err(|error| format!("No se pudo borrar {}: {}", path, error))?;
        }
        manifest.files.remove(path);
    }

    manifest.schema_version = 2;
    save_manifest(&instance_dir, &manifest)?;

    {
        let mut manager = state.instances.lock().unwrap();
        manager.mark_files_installed(&instance_id);
    }
    ilog!(
        &app,
        &log_id,
        "Installation complete: {}/{} files verified",
        total,
        total
    );
    app.emit("instance-done", instance_id).ok();
    Ok(())
}

pub fn offline_uuid(username: &str) -> String {
    let name = format!("OfflinePlayer:{}", username);
    let digest = md5::compute(name.as_bytes());
    let mut bytes = digest.0;
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

#[command]
pub fn create_instance(
    name: String,
    id: String,
    base_path: String,
    loader: String,
    version: String,
    slug: Option<String>,
    state: State<'_, AppState>,
) -> String {
    let mut manager = state.instances.lock().unwrap();
    let instance = manager.create_instance(
        name,
        id,
        PathBuf::from(base_path),
        loader,
        version,
        slug,
        None,
        None,
        None,
    );
    instance.name
}

#[command]
pub fn list_instances(state: State<'_, AppState>) -> Vec<Instance> {
    let manager = state.instances.lock().unwrap();
    manager.instances.clone()
}

#[command]
pub async fn launch_instance_cmd(
    app: AppHandle,
    instance_id: String,
    username: String,
    uuid: String,
    token: String,
    xuid: Option<String>,
    ram: u64,
    width: i32,
    height: i32,
    fullscreen: bool,
    download_concurrency: Option<u32>,
    force_ipv4: Option<bool>,
    dns: Option<bool>,
    runtime_settings: Option<InstanceRuntimeSettings>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let instance = {
        let manager = state.instances.lock().unwrap();
        manager
            .instances
            .iter()
            .find(|i| i.id == instance_id)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "Instance '{}' not found. Available: [{}]",
                    instance_id,
                    manager
                        .instances
                        .iter()
                        .map(|i| format!("'{}'", i.id))
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            })?
    };

    let log_id = format!("{}-{}", instance.id, instance.slug.as_deref().unwrap_or(""));
    let version = instance.minecraft_version.clone();
    let loader = instance.loader.to_lowercase();

    ilog!(
        &app,
        &log_id,
        "Launching '{}' | version={} | loader={}",
        instance.name,
        version,
        loader
    );

    if token == "none" || token.is_empty() {
        return Err("Se requiere cuenta premium. Inicia sesión con Microsoft.".to_string());
    }
    let effective_uuid = uuid.clone();
    let effective_token = token.clone();
    let xbox_account = xuid
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|xuid| minecraft_java_rs_core::models::minecraft::XboxAccount { xuid });

    let engine_dir = crate::commands::config::get_install_dir_path().join("engine_data");
    fs::create_dir_all(&engine_dir).ok();

    let loader_type = match loader.as_str() {
        "fabric" => Some(LoaderType::Fabric),
        "forge" => Some(LoaderType::Forge),
        "neoforge" => Some(LoaderType::NeoForge),
        "quilt" => Some(LoaderType::Quilt),
        "legacyfabric" | "legacy_fabric" => Some(LoaderType::LegacyFabric),
        _ => None,
    };

    let custom_memory = runtime_settings
        .as_ref()
        .and_then(|settings| settings.memory_mode.as_deref())
        .is_some_and(|mode| mode == "custom");
    let min_ram = if custom_memory {
        runtime_settings
            .as_ref()
            .and_then(|settings| settings.min_ram_mb)
            .map(u64::from)
            .unwrap_or_else(|| (ram / 4).max(512))
    } else {
        (ram / 4).max(512)
    };
    let max_ram = if custom_memory {
        runtime_settings
            .as_ref()
            .and_then(|settings| settings.max_ram_mb)
            .map(u64::from)
            .unwrap_or(ram)
            .max(min_ram)
    } else {
        ram
    };

    let custom_resolution = runtime_settings
        .as_ref()
        .and_then(|settings| settings.resolution_mode.as_deref())
        .is_some_and(|mode| mode == "custom");
    let launch_width = if custom_resolution {
        runtime_settings
            .as_ref()
            .and_then(|settings| settings.width)
            .unwrap_or(width.max(320) as u32)
    } else {
        width.max(320) as u32
    };
    let launch_height = if custom_resolution {
        runtime_settings
            .as_ref()
            .and_then(|settings| settings.height)
            .unwrap_or(height.max(240) as u32)
    } else {
        height.max(240) as u32
    };
    let launch_fullscreen = if custom_resolution {
        runtime_settings
            .as_ref()
            .and_then(|settings| settings.fullscreen)
            .unwrap_or(fullscreen)
    } else {
        fullscreen
    };

    let custom_java_path = runtime_settings
        .as_ref()
        .filter(|settings| settings.java_mode.as_deref() == Some("custom"))
        .and_then(|settings| settings.java_path.as_deref())
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(|p| {
            // Normaliza: acepta "C:/java17", "C:/java17/bin", "C:/java17/bin/java.exe"
            let pb = PathBuf::from(p);
            let s = pb.to_string_lossy().to_lowercase();
            if s.ends_with("java.exe") || s.ends_with("java") {
                pb.parent().and_then(|x| x.parent()).map(|x| x.to_path_buf()).unwrap_or(pb)
            } else if pb.file_name().map(|n| n.to_string_lossy().to_lowercase() == "bin").unwrap_or(false) {
                pb.parent().map(|x| x.to_path_buf()).unwrap_or(pb)
            } else {
                pb
            }
        });
    // Clamp de RAM según RAM real del sistema (evita OOM en PC de 4GB)
    let total_ram_mb: u64 = {
        let mut sys = sysinfo::System::new_all();
        sys.refresh_memory();
        sys.total_memory() / 1024 / 1024
    };
    let safe_max = if total_ram_mb > 0 { ((total_ram_mb as f64 * 0.7) as u64).max(1024) } else { 8192 };
    let clamped_max_ram = max_ram.min(safe_max);
    let clamped_min_ram = min_ram.min(clamped_max_ram).max(512);
    if clamped_max_ram != max_ram {
        ilog!(&app, &log_id, "RAM solicitada {}M excede 70% del sistema ({}M) -> clamp a {}M", max_ram, total_ram_mb, clamped_max_ram);
    }
    let java_options = custom_java_path
        .map(|path| JavaOptions {
            path: Some(path),
            ..Default::default()
        })
        .unwrap_or_default();

    let mut jvm_args: Vec<String> = Vec::new();
    if let Some(extra_args) = runtime_settings
        .as_ref()
        .and_then(|settings| settings.extra_jvm_args.as_deref())
        .map(str::trim)
        .filter(|args| !args.is_empty())
    {
        jvm_args.extend(extra_args.split_whitespace().map(ToString::to_string));
    }
    if let Some(global_args) = crate::commands::config::get_config()
        .get("app")
        .and_then(|a| a.get("extra-jvm-args"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|args| !args.is_empty())
    {
        jvm_args.extend(global_args.split_whitespace().map(ToString::to_string));
    }

    let options = LaunchOptions {
        path: engine_dir.clone(),
        instance: Some(instance.path.to_string_lossy().into_owned()),
        version: version.clone(),
        authenticator: Authenticator {
            access_token: effective_token,
            name: username.clone(),
            uuid: effective_uuid,
            xbox_account,
            user_properties: None,
            client_id: None,
            client_token: None,
        },
        loader: LoaderConfig {
            enable: loader_type.is_some(),
            loader_type,
            build: "latest".to_string(),
            ..Default::default()
        },
        memory: MemoryConfig {
            min: format!("{}M", clamped_min_ram),
            max: format!("{}M", clamped_max_ram),
        },
        screen: ScreenConfig {
            width: Some(launch_width),
            height: Some(launch_height),
            fullscreen: launch_fullscreen,
        },
        jvm_args,
        download_concurrency: download_concurrency.unwrap_or(10),
        force_ipv4: force_ipv4.unwrap_or(true),
        // Cloudflare DNS-over-HTTPS resolver; bypasses ISP DNS hijacking/port-53 blocking.
        dns: dns
            .unwrap_or(false)
            .then(|| IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))),
        timeout_secs: 30,
        bypass_offline: false,
        java: java_options,
        game_args: vec![],
        verify: false,
        verify_concurrency: 4,
        skip_bundle_check: true,
        url: None,
        mcp: None,
        intel_enabled_mac: false,
    };

    let (tx, mut rx) = mpsc::channel::<LaunchEvent>(512);

    let collected_logs: std::sync::Arc<std::sync::Mutex<Vec<String>>> =
        std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let logs_for_event = collected_logs.clone();
    let logs_for_monitor = collected_logs;

    let app_ev = app.clone();
    let iid = instance_id.clone();
    let log_id_ev = log_id.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                LaunchEvent::Progress {
                    downloaded,
                    total,
                    ref kind,
                } => match kind.as_str() {
                    "libraries" | "assets" => {
                        app_ev
                            .emit("minecraft-progress", serde_json::json!({ "instanceId": &iid, "current": downloaded, "total": total }))
                            .ok();
                    }
                    "java" => {
                        let pct = if total > 0 {
                            downloaded * 100 / total
                        } else {
                            0
                        };
                        app_ev
                            .emit(
                                "java-download-progress",
                                serde_json::json!({ "instanceId": &iid, "percent": pct, "status": "Downloading..." }),
                            )
                            .ok();
                    }
                    _ => {}
                },
                LaunchEvent::GameDownloadFinished => {
                    app_ev
                        .emit(
                            "java-download-done",
                            serde_json::json!({ "instanceId": &iid }),
                        )
                        .ok();
                    app_ev.emit("minecraft-done", &iid).ok();
                }
                LaunchEvent::Check {
                    current,
                    total,
                    ref kind,
                } => {
                    app_ev
                        .emit("minecraft-progress", serde_json::json!({ "instanceId": &iid, "current": current, "total": total }))
                        .ok();
                    app_ev
                        .emit("minecraft-status", serde_json::json!({ "instanceId": &iid, "status": format!("Verifying {}...", kind) }))
                        .ok();
                }
                LaunchEvent::Extract(ref name) => {
                    app_ev
                        .emit("minecraft-status", serde_json::json!({ "instanceId": &iid, "status": format!("Extracting {}...", name) }))
                        .ok();
                }
                LaunchEvent::Patch(ref name) => {
                    app_ev
                        .emit("minecraft-status", serde_json::json!({ "instanceId": &iid, "status": format!("Patching {}...", name), "indeterminate": true }))
                        .ok();
                }
                LaunchEvent::Data(ref line) => {
                    let mut logs = logs_for_event.lock().unwrap();
                    if logs.len() < 2000 {
                        logs.push(line.clone());
                    }
                    drop(logs);
                    ilog!(&app_ev, &log_id_ev, "{}", line);
                }
                LaunchEvent::Error(ref msg) => {
                    ilog_err!(&app_ev, &log_id_ev, "{}", msg);
                    app_ev.emit("minecraft-error", serde_json::json!({ "instanceId": &iid, "message": msg })).ok();
                    app_ev.emit("minecraft-status", serde_json::json!({ "instanceId": &iid, "status": format!("Error: {}", msg) })).ok();
                }
                other => {
                    // Loguear eventos no mapeados para evitar "95% congelado" sin razón visible
                    ilog!(&app_ev, &log_id_ev, "[evento] {:?}", other);
                }
            }
        }
    });

    // Acquire download slot: wait if another instance is already downloading
    // the same MC version to avoid concurrent writes to shared library/asset files.
    loop {
        {
            let mut dl = state.downloading.lock().unwrap();
            if !dl.values().any(|v| v == &version) {
                dl.insert(instance_id.clone(), version.clone());
                break;
            }
        }
        ilog!(
            &app,
            &log_id,
            "Waiting for another download of {} to finish...",
            version
        );
        state.download_notify.notified().await;
    }

    ilog!(&app, &log_id, "Downloading game files... (OS={}, arch={})", std::env::consts::OS, std::env::consts::ARCH);
    let mut launcher = Launcher::new(options);

    // Timeout absoluto para evitar 95% colgado infinito en Windows (Defender / firewall / stream cortado)
    // Nota: el slot SIEMPRE se libera aunque haya timeout — evita deadlock en reintentos de la misma versión
    let raw_download = tokio::time::timeout(Duration::from_secs(300), launcher.download_game(tx.clone())).await;
    // Release download slot regardless of success, failure, or timeout.
    state.downloading.lock().unwrap().remove(&instance_id);
    state.download_notify.notify_waiters();

    let download_result: Result<(), String> = match raw_download {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => {
            let msg = "Tiempo agotado descargando archivos (300s). Revisa firewall/antivirus, conexión y vuelve a intentar. Si persiste, borra engine_data/libraries y reintenta.";
            emit_launch_error(&app, &log_id, &instance_id, msg);
            return Err(msg.to_string());
        }
    };

    if let Err(e) = &download_result {
        let msg = format!("Error descargando: {}", e);
        emit_launch_error(&app, &log_id, &instance_id, &msg);
        // limpiar barra de progreso en frontend
        app.emit("minecraft-progress", serde_json::json!({ "instanceId": &instance_id, "current": 0, "total": 100 })).ok();
        return Err(msg);
    }

    // PRIME offload solo para el proceso de Minecraft (hijo).
    // Si el launcher se corre con `npm run prime` o con `prime-run`, estas vars se heredan al hijo Java
    // y MC usa la NVIDIA aunque Tauri siga en Intel/Wayland (evita el crash Wayland 71 de prime-run).
    let prime_requested = std::env::var("SPEKTRA_PRIME").is_ok()
        || std::env::var("__NV_PRIME_RENDER_OFFLOAD").is_ok()
        || std::env::var("PRIME_OFFLOAD").is_ok();
    if prime_requested {
        std::env::set_var("__NV_PRIME_RENDER_OFFLOAD", "1");
        std::env::set_var("__GLX_VENDOR_LIBRARY_NAME", "nvidia");
        std::env::set_var("__VK_LAYER_NV_optimus", "NVIDIA_only");
        ilog!(&app, &log_id, "PRIME offload activado para Minecraft (NVIDIA)");
    }
    ilog!(&app, &log_id, "Launching Minecraft...");
    let mut child = match tokio::time::timeout(Duration::from_secs(45), launcher.launch(tx)).await {
        Ok(Ok(c)) => c,
        Ok(Err(e)) => {
            let msg = format!("Error al lanzar: {}. Verifica Java, RAM asignada y que el antivirus no bloqueó java.exe", e);
            emit_launch_error(&app, &log_id, &instance_id, &msg);
            return Err(msg);
        }
        Err(_) => {
            let log_hint = crate::logger::log_dir().display().to_string();
            let msg = format!("Tiempo agotado iniciando Minecraft (45s). Posible bloqueo de antivirus/firewall sobre java.exe o natives. Revisa los logs en {}", log_hint);
            emit_launch_error(&app, &log_id, &instance_id, &msg);
            return Err(msg);
        }
    };

    let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();
    state
        .running
        .lock()
        .unwrap()
        .insert(instance_id.clone(), kill_tx);

    let running_ev = state.running.clone();
    let app_ev2 = app.clone();
    let id_ev2 = instance_id.clone();

    tokio::spawn(async move {
        let exit_code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()).unwrap_or(-1),
            _ = kill_rx => {
                let _ = child.kill().await;
                child.wait().await.ok().and_then(|s| s.code()).unwrap_or(-1)
            }
        };

        running_ev.lock().unwrap().remove(&id_ev2);

        let logs_snapshot = logs_for_monitor.lock().unwrap().clone();
        if Launcher::is_corrupt_crash(exit_code, &logs_snapshot) {
            app_ev2.emit("minecraft-corrupt-crash", &id_ev2).ok();
        }

        app_ev2.emit("minecraft-closed", &id_ev2).ok();
    });

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalInstance {
    pub id: String,
    pub title: String,
    pub minecraft_version: String,
    pub loader: String,
    pub icon_path: Option<String>,
    pub background_path: Option<String>,
    pub created_at: i64,
}

fn instances_root(_app: &AppHandle) -> PathBuf {
    crate::commands::config::get_install_dir_path().join("instances")
}

fn instance_dir(app: &AppHandle, id: &str) -> PathBuf {
    instances_root(app).join(id)
}

fn instance_json_path(app: &AppHandle, id: &str) -> PathBuf {
    instance_dir(app, id).join("instance.json")
}

fn selected_id_path(app: &AppHandle) -> PathBuf {
    instances_root(app).join(".selected")
}

fn img_ext(src: &PathBuf) -> &'static str {
    match src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "jpg",
        _ => "png",
    }
}

fn copy_image(src: &str, dest_dir: &PathBuf, name: &str) -> Result<String, String> {
    let src_path = PathBuf::from(src);
    if !src_path.exists() {
        return Err(format!("File not found: {}", src));
    }
    let ext = img_ext(&src_path);
    let dest = dest_dir.join(format!("{}.{}", name, ext));
    fs::copy(&src_path, &dest).map_err(|e| format!("Error copying image: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

fn init_instance_dirs(dir: &PathBuf) -> Result<(), String> {
    for sub in &["mods", "config", "saves", "resourcepacks", "shaderpacks"] {
        fs::create_dir_all(dir.join(sub)).map_err(|e| format!("Error creating {}: {}", sub, e))?;
    }
    Ok(())
}

#[command]
pub fn load_local_instances(app: AppHandle) -> Vec<LocalInstance> {
    let root = instances_root(&app);
    if !root.exists() {
        return vec![];
    }
    let Ok(entries) = fs::read_dir(&root) else {
        eprintln!("[load_local_instances] no se pudo leer {} — devolviendo vacío", root.display());
        return vec![];
    };
    let mut list: Vec<LocalInstance> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let json = e.path().join("instance.json");
            let raw = fs::read_to_string(&json).ok()?;
            serde_json::from_str::<LocalInstance>(&raw).ok()
        })
        .collect();
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    list
}

#[command]
pub fn add_local_instance(
    app: AppHandle,
    mut instance: LocalInstance,
    icon_src: Option<String>,
    background_src: Option<String>,
) -> Result<LocalInstance, String> {
    let dir = instance_dir(&app, &instance.id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    init_instance_dirs(&dir)?;
    if let Some(src) = icon_src.filter(|s| !s.is_empty()) {
        match copy_image(&src, &dir, "icon") {
            Ok(dest) => instance.icon_path = Some(dest),
            Err(e) => eprintln!("Warn: could not copy icon: {}", e),
        }
    }
    if let Some(src) = background_src.filter(|s| !s.is_empty()) {
        match copy_image(&src, &dir, "background") {
            Ok(dest) => instance.background_path = Some(dest),
            Err(e) => eprintln!("Warn: could not copy background: {}", e),
        }
    }
    let json = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    fs::write(instance_json_path(&app, &instance.id), json).map_err(|e| e.to_string())?;
    Ok(instance)
}

#[command]
pub fn remove_local_instance(
    app: AppHandle,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let dir = instance_dir(&app, &id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    {
        let mut manager = state.instances.lock().unwrap();
        let before = manager.instances.len();
        manager.instances.retain(|i| i.id != id);
        if manager.instances.len() != before {
            manager.save();
        }
    }
    let sel = get_selected_local_instance_id(app.clone());
    if sel.as_deref() == Some(&id) {
        set_selected_local_instance_id(app, None).ok();
    }
    Ok(())
}

#[command]
pub fn update_local_instance(
    app: AppHandle,
    id: String,
    title: Option<String>,
    minecraft_version: Option<String>,
    loader: Option<String>,
    icon_src: Option<String>,
    background_src: Option<String>,
    clear_icon: bool,
    clear_background: bool,
) -> Result<LocalInstance, String> {
    let json_path = instance_json_path(&app, &id);
    let raw = fs::read_to_string(&json_path).map_err(|_| format!("Instance '{}' not found", id))?;
    let mut inst: LocalInstance = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let dir = instance_dir(&app, &id);
    if let Some(v) = title {
        inst.title = v;
    }
    if let Some(v) = minecraft_version {
        inst.minecraft_version = v;
    }
    if let Some(v) = loader {
        inst.loader = v;
    }
    if clear_icon {
        if let Some(ref p) = inst.icon_path {
            let _ = fs::remove_file(p);
        }
        inst.icon_path = None;
    } else if let Some(src) = icon_src.filter(|s| !s.is_empty()) {
        if let Some(ref old) = inst.icon_path {
            let _ = fs::remove_file(old);
        }
        match copy_image(&src, &dir, "icon") {
            Ok(dest) => inst.icon_path = Some(dest),
            Err(e) => eprintln!("Warn: icon: {}", e),
        }
    }
    if clear_background {
        if let Some(ref p) = inst.background_path {
            let _ = fs::remove_file(p);
        }
        inst.background_path = None;
    } else if let Some(src) = background_src.filter(|s| !s.is_empty()) {
        if let Some(ref old) = inst.background_path {
            let _ = fs::remove_file(old);
        }
        match copy_image(&src, &dir, "background") {
            Ok(dest) => inst.background_path = Some(dest),
            Err(e) => eprintln!("Warn: background: {}", e),
        }
    }
    let json = serde_json::to_string_pretty(&inst).map_err(|e| e.to_string())?;
    fs::write(&json_path, json).map_err(|e| e.to_string())?;
    Ok(inst)
}

#[command]
pub fn get_selected_local_instance_id(app: AppHandle) -> Option<String> {
    let path = selected_id_path(&app);
    fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[command]
pub fn set_selected_local_instance_id(app: AppHandle, id: Option<String>) -> Result<(), String> {
    let path = selected_id_path(&app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    match id {
        Some(val) => fs::write(&path, val).map_err(|e| e.to_string()),
        None => {
            if path.exists() {
                fs::remove_file(&path).map_err(|e| e.to_string())
            } else {
                Ok(())
            }
        }
    }
}

#[command]
pub fn open_local_instance_folder(app: AppHandle, id: String) -> Result<(), String> {
    let dir = instance_dir(&app, &id);
    if !dir.exists() {
        return Err(format!("Folder not found: {}", dir.display()));
    }
    open::that(&dir).map_err(|e| e.to_string())
}

#[command]
pub fn save_local_instances(_app: AppHandle, _instances: Vec<LocalInstance>) -> Result<(), String> {
    Ok(())
}

fn slugify_export(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c.to_lowercase().next().unwrap()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

#[command]
pub async fn stop_instance(instance_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let kill_tx = state
        .running
        .lock()
        .unwrap()
        .remove(&instance_id)
        .ok_or_else(|| format!("Instance '{}' is not running", instance_id))?;
    let _ = kill_tx.send(());
    Ok(())
}

#[command]
pub fn get_running_instances(state: State<'_, AppState>) -> Vec<String> {
    state.running.lock().unwrap().keys().cloned().collect()
}

#[command]
pub fn get_log_path() -> Result<String, String> {
    let dir = crate::logger::log_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[command]
pub fn clear_instance_logs(instance_id: String) -> Result<(), String> {
    crate::logger::clear_logs(&instance_id);
    Ok(())
}

#[command]
pub fn get_instance_logs_tail(instance_id: String, lines: Option<usize>) -> Vec<String> {
    crate::logger::read_log_tail(&instance_id, lines.unwrap_or(200))
}

#[command]
pub fn get_downloading_instances(state: State<'_, AppState>) -> HashMap<String, String> {
    state.downloading.lock().unwrap().clone()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub children: Option<Vec<FileEntry>>,
}

#[command]
pub fn get_instance_files(app: AppHandle, instance_id: String) -> Vec<FileEntry> {
    let dir = instance_dir(&app, &instance_id);
    read_dir_recursive(&dir, &dir, 0, 4)
}

fn read_dir_recursive(
    root: &PathBuf,
    path: &PathBuf,
    depth: u32,
    max_depth: u32,
) -> Vec<FileEntry> {
    if depth >= max_depth {
        return vec![];
    }
    let Ok(entries) = fs::read_dir(path) else {
        return vec![];
    };
    let mut result: Vec<FileEntry> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let is_dir = meta.is_dir();
            let full_path = e.path();
            let relative = full_path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            Some(FileEntry {
                name: e.file_name().to_string_lossy().to_string(),
                path: relative,
                is_dir,
                size: if is_dir { None } else { Some(meta.len()) },
                children: if is_dir {
                    Some(read_dir_recursive(root, &full_path, depth + 1, max_depth))
                } else {
                    None
                },
            })
        })
        .collect();
    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    result
}

#[command]
pub fn read_instance_file(
    app: AppHandle,
    instance_id: String,
    file_path: String,
) -> Result<String, String> {
    let dir = instance_dir(&app, &instance_id);
    let full_path = dir.join(&file_path);
    if !full_path.starts_with(&dir) {
        return Err("Access denied".into());
    }
    let content =
        fs::read_to_string(&full_path).map_err(|e| format!("Could not read file: {}", e))?;
    Ok(content)
}

#[command]
pub fn delete_instance_file(
    app: AppHandle,
    instance_id: String,
    file_path: String,
) -> Result<(), String> {
    let dir = instance_dir(&app, &instance_id);
    let full_path = dir.join(&file_path);
    if !full_path.starts_with(&dir) {
        return Err("Access denied".into());
    }
    if full_path.is_dir() {
        fs::remove_dir_all(&full_path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&full_path).map_err(|e| e.to_string())
    }
}

#[command]
pub fn rename_instance_file(
    app: AppHandle,
    instance_id: String,
    file_path: String,
    new_name: String,
) -> Result<(), String> {
    let dir = instance_dir(&app, &instance_id);
    let full_path = dir.join(&file_path);
    if !full_path.starts_with(&dir) {
        return Err("Access denied".into());
    }
    let new_path = full_path.parent().ok_or("No parent dir")?.join(&new_name);
    fs::rename(&full_path, &new_path).map_err(|e| e.to_string())
}

#[command]
pub fn write_instance_file(
    app: AppHandle,
    instance_id: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let dir = instance_dir(&app, &instance_id);
    let full_path = dir.join(&file_path);
    if !full_path.starts_with(&dir) {
        return Err("Access denied".into());
    }
    fs::write(&full_path, content.as_bytes()).map_err(|e| format!("Could not write file: {}", e))
}

