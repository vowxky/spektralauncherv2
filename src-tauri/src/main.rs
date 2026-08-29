#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod core;
mod discord;
mod java_runtime;
mod logger;
mod state;
mod utils;

use commands::auth::*;
use commands::config::*;
use commands::instance::*;
use commands::java::*;
use commands::secure_store::*;
use utils::*;

use tauri::Listener;
use tauri::Manager;

#[tauri::command]
fn open_logs_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("logs") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        win.unminimize().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let win = tauri::WebviewWindowBuilder::new(&app, "logs", tauri::WebviewUrl::App("index.html".into()))
        .title("Logs — Spektra")
        .inner_size(900.0, 650.0)
        .min_inner_size(600.0, 400.0)
        .center()
        .resizable(true)
        .decorations(true)
        .background_color(tauri::window::Color(10, 10, 12, 255))
        .build()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    disable_tracking_prevention(&win);
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn disable_tracking_prevention(webview: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile, ICoreWebView2Profile3, ICoreWebView2_13,
        COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE,
    };
    use windows_core::Interface;

    let _ = webview.with_webview(|webview| unsafe {
        let core = match webview.controller().CoreWebView2() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("No se pudo obtener CoreWebView2: {e:?}");
                return;
            }
        };

        let core13: ICoreWebView2_13 = match core.cast() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("ICoreWebView2_13 no soportado: {e:?}");
                return;
            }
        };

        let profile: ICoreWebView2Profile = match core13.Profile() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("No se pudo obtener el Profile: {e:?}");
                return;
            }
        };

        let profile3: ICoreWebView2Profile3 = match profile.cast() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("ICoreWebView2Profile3 no soportado: {e:?}");
                return;
            }
        };

        if let Err(e) = profile3
            .SetPreferredTrackingPreventionLevel(COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE)
        {
            eprintln!("No se pudo desactivar Tracking Prevention: {e:?}");
        }
    });
}

fn main() {
    #[cfg(target_os = "windows")]
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--js-flags=\"--max-old-space-size=256\" --disable-gpu-program-cache --disable-gpu-shader-disk-cache",
        );
    }

    #[cfg(target_os = "linux")]
    {
        let _is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok()
            || std::env::var("XDG_SESSION_TYPE")
                .map(|v| v == "wayland")
                .unwrap_or(false);
    }

    std::thread::spawn(|| {
        let _ = std::panic::catch_unwind(|| {
            discord::init();
        });
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                window.show().ok();
                window.set_focus().ok();
                window.unminimize().ok();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if let Some(window_config) = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
            {
                #[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
                let window =
                    tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?
                        .visible(false)
                        .build()?;

                #[cfg(target_os = "windows")]
                disable_tracking_prevention(&window);
            }
            {
                let handle = app.handle().clone();
                app.listen("frontend-ready", move |_| {
                    if let Some(window) = handle.get_webview_window("main") {
                        window.show().ok();
                    }
                });
            }
            Ok(())
        })
        .manage(state::AppState::new())
        .invoke_handler(tauri::generate_handler![
            create_instance,
            launch_instance_cmd,
            install_instance_files,
            uninstall_instance,
            get_instances,
            get_instance,
            verify_account,
            set_config,
            get_config,
            get_system_ram,
            login_microsoft,
            refresh_microsoft_token,
            validate_minecraft_token,
            logout,
            save_auth_json,
            get_auth_json,
            clear_auth,
            secure_set,
            secure_get,
            secure_remove,
            discord_set_idle,
            discord_set_home,
            discord_set_login,
            discord_set_settings,
            discord_set_browsing,
            discord_set_downloading,
            discord_set_installing,
            discord_set_playing,
            get_install_dir,
            pick_install_dir,
            reset_install_dir,
            get_java_runtimes_status,
            detect_java_runtime,
            install_java_runtime,
            pick_java_runtime,
            stop_instance,
            get_running_instances,
            get_downloading_instances,
            get_log_path,
            clear_instance_logs,
            get_instance_logs_tail,
            open_logs_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri");
}
