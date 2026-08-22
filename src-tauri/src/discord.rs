use discord_rich_presence::{
    activity::{Activity, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);
static LAST_ACTIVITY: Mutex<u64> = Mutex::new(0);
static IS_PLAYING: Mutex<bool> = Mutex::new(false);
static CURRENT_DETAILS: Mutex<String> = Mutex::new(String::new());
static CURRENT_STATE: Mutex<String> = Mutex::new(String::new());
static CURRENT_SMALL_IMAGE: Mutex<Option<String>> = Mutex::new(None);
static CURRENT_SMALL_TEXT: Mutex<Option<String>> = Mutex::new(None);
static START_SECS: Mutex<i64> = Mutex::new(0);

const CLIENT_ID: &str = "1420171156312555592";
const AFK_TIMEOUT_SECS: u64 = 15 * 60;

// Asset keys as configured in Discord Developer Portal -> Rich Presence -> Art Assets
// large image: icon del Spektra Launcher (key = "icon")
// small images: "fabric" y "login"
const LARGE_IMAGE: &str = "icon";
const LARGE_TEXT: &str = "Spektra Launcher";
const SMALL_FABRIC: &str = "fabric";
const SMALL_LOGIN: &str = "login";

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn update_last_activity() {
    *LAST_ACTIVITY.lock().unwrap() = now_secs();
}

fn update_start() {
    *START_SECS.lock().unwrap() = now_secs() as i64;
}

fn apply_activity() {
    let details = CURRENT_DETAILS.lock().unwrap().clone();
    let state = CURRENT_STATE.lock().unwrap().clone();
    let small_image = CURRENT_SMALL_IMAGE.lock().unwrap().clone();
    let small_text = CURRENT_SMALL_TEXT.lock().unwrap().clone();
    let start = *START_SECS.lock().unwrap();

    // Build assets: large is always Spektra icon, small is conditional (fabric/login/none)
    let mut assets = Assets::new()
        .large_image(LARGE_IMAGE)
        .large_text(LARGE_TEXT);

    if let Some(ref img) = small_image {
        assets = assets.small_image(img.as_str());
        if let Some(ref txt) = small_text {
            assets = assets.small_text(txt.as_str());
        }
    }

    let mut activity = Activity::new().details(details.as_str()).assets(assets);

    if !state.is_empty() {
        activity = activity.state(state.as_str());
    }

    if start != 0 {
        activity = activity.timestamps(Timestamps::new().start(start));
    }

    let mut lock = CLIENT.lock().unwrap();
    if let Some(client) = lock.as_mut() {
        // details for log
        let log_small = small_image
            .as_deref()
            .unwrap_or("none");
        println!(
            "[Discord] details=\"{}\" state=\"{}\" small=\"{}\"",
            details, state, log_small
        );
        if let Err(e) = client.set_activity(activity) {
            println!("[Discord] Error: {:?}", e);
        }
    }
}

fn set_activity(details: &str, state: &str, small_image: Option<&str>, small_text: Option<&str>, is_playing: bool) {
    update_last_activity();
    update_start();
    *IS_PLAYING.lock().unwrap() = is_playing;
    *CURRENT_DETAILS.lock().unwrap() = details.to_string();
    *CURRENT_STATE.lock().unwrap() = state.to_string();
    *CURRENT_SMALL_IMAGE.lock().unwrap() = small_image.map(|s| s.to_string());
    *CURRENT_SMALL_TEXT.lock().unwrap() = small_text.map(|s| s.to_string());
    apply_activity();
}

pub fn init() {
    println!("[Discord] Initializing RPC with client_id {}...", CLIENT_ID);

    let mut client = match DiscordIpcClient::new(CLIENT_ID) {
        Ok(c) => c,
        Err(e) => {
            println!("[Discord] Error creating client: {:?}", e);
            return;
        }
    };

    match client.connect() {
        Ok(_) => println!("[Discord] Connected successfully"),
        Err(e) => {
            println!("[Discord] Could not connect: {:?}", e);
            return;
        }
    }

    *CLIENT.lock().unwrap() = Some(client);
    set_activity("En el inicio", "Descansando", None, None, false);
    update_last_activity();

    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(60));

        if *IS_PLAYING.lock().unwrap() {
            continue;
        }

        let elapsed = now_secs().saturating_sub(*LAST_ACTIVITY.lock().unwrap());
        if elapsed >= AFK_TIMEOUT_SECS {
            set_activity("Ausente", "AFK — Sin actividad", None, None, false);
            println!("[Discord] Activity: AFK");
        }
    });
}

pub fn set_idle() {
    set_activity("En el inicio", "Descansando", None, None, false);
}

pub fn set_home() {
    set_activity("En el inicio", "Descansando", None, None, false);
}

pub fn set_login() {
    set_activity(
        "En el inicio de sesión",
        "Esperando autenticación",
        Some(SMALL_LOGIN),
        Some("Iniciando sesión"),
        false,
    );
}

pub fn set_settings() {
    set_activity(
        "En los ajustes",
        "Personalizando el launcher",
        None,
        None,
        false,
    );
}

pub fn set_browsing() {
    set_activity(
        "En el inicio",
        "Explorando instancias",
        None,
        None,
        false,
    );
}

pub fn set_downloading(instance_name: &str, progress: Option<u8>) {
    let details = format!("Descargando {}", instance_name);
    let state = match progress {
        Some(p) => format!("Preparando archivos • {}%", p.min(100)),
        None => "Preparando archivos...".to_string(),
    };
    set_activity(&details, &state, None, None, false);
}

pub fn set_installing(instance_name: &str) {
    let details = format!("Instalando {}", instance_name);
    set_activity(&details, "Instalando archivos...", None, None, false);
}

pub fn set_playing(instance_name: &str, loader: Option<&str>) {
    update_last_activity();
    update_start();
    *IS_PLAYING.lock().unwrap() = true;
    *CURRENT_DETAILS.lock().unwrap() = format!("Jugando {}", instance_name);

    let is_fabric = loader
        .map(|l| l.eq_ignore_ascii_case("fabric"))
        .unwrap_or(false);

    if is_fabric {
        *CURRENT_STATE.lock().unwrap() = "Fabric".to_string();
        *CURRENT_SMALL_IMAGE.lock().unwrap() = Some(SMALL_FABRIC.to_string());
        *CURRENT_SMALL_TEXT.lock().unwrap() = Some("Fabric".to_string());
    } else {
        let state = loader
            .filter(|l| !l.is_empty())
            .map(|l| {
                if l.eq_ignore_ascii_case("vanilla") {
                    "Vainilla".to_string()
                } else {
                    let mut c = l.chars();
                    match c.next() {
                        None => String::new(),
                        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                    }
                }
            })
            .unwrap_or_else(|| "Vainilla".to_string());
        *CURRENT_STATE.lock().unwrap() = state;
        *CURRENT_SMALL_IMAGE.lock().unwrap() = None;
        *CURRENT_SMALL_TEXT.lock().unwrap() = None;
    }

    apply_activity();
}
