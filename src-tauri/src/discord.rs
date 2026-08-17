use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);
static LAST_ACTIVITY: Mutex<u64> = Mutex::new(0);
static IS_PLAYING: Mutex<bool> = Mutex::new(false);
static CURRENT_DETAILS: Mutex<String> = Mutex::new(String::new());

const CLIENT_ID: &str = "1350178343651381369";
const AFK_TIMEOUT_SECS: u64 = 15 * 60;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn update_last_activity() {
    *LAST_ACTIVITY.lock().unwrap() = now_secs();
}

fn apply_activity() {
    let details = CURRENT_DETAILS.lock().unwrap().clone();

    let mut lock = CLIENT.lock().unwrap();
    if let Some(client) = lock.as_mut() {
        match client.set_activity(activity::Activity::new().details(&details)) {
            Ok(_) => println!("[Discord] {}", details),
            Err(e) => println!("[Discord] Error: {:?}", e),
        }
    }
}

pub fn init() {
    println!("[Discord] Initializing RPC...");

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
    *CURRENT_DETAILS.lock().unwrap() = "En el Menu...".to_string();
    apply_activity();
    update_last_activity();

    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(60));

        if *IS_PLAYING.lock().unwrap() {
            continue;
        }

        let elapsed = now_secs().saturating_sub(*LAST_ACTIVITY.lock().unwrap());
        if elapsed >= AFK_TIMEOUT_SECS {
            *CURRENT_DETAILS.lock().unwrap() = "AFK...".to_string();
            apply_activity();
            println!("[Discord] Activity: AFK");
        }
    });
}

pub fn set_idle() {
    update_last_activity();
    *IS_PLAYING.lock().unwrap() = false;
    *CURRENT_DETAILS.lock().unwrap() = "En el Menu...".to_string();
    apply_activity();
}

pub fn set_playing(instance_name: &str) {
    update_last_activity();
    *IS_PLAYING.lock().unwrap() = true;
    *CURRENT_DETAILS.lock().unwrap() = format!("Jugando {}", instance_name);
    apply_activity();
}
