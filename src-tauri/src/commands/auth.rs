use minecraft_msa_auth::MinecraftAuthorizationFlow;
use oauth2::{CsrfToken, PkceCodeChallenge};
use reqwest::Client;
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use tauri::command;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::{timeout, Duration};
use urlencoding::decode;

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

const CLIENT_ID: &str = "28345b95-0610-4565-b77d-03a20a541560";
const REDIRECT_URI: &str = "http://localhost:7878/callback";

#[command]
pub async fn login_microsoft() -> Result<Value, String> {
    let listener = TcpListener::bind("127.0.0.1:7878")
        .await
        .map_err(|e| format!("Port 7878 in use, try again: {}", e))?;

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let csrf = CsrfToken::new_random();

    let url = format!(
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize\
        ?client_id={}\
        &response_type=code\
        &redirect_uri={}\
        &scope=XboxLive.signin%20offline_access\
        &prompt=select_account\
        &state={}\
        &code_challenge={}\
        &code_challenge_method=S256",
        CLIENT_ID,
        urlencoding::encode(REDIRECT_URI),
        csrf.secret(),
        pkce_challenge.as_str()
    );

    open::that(url).map_err(|e| e.to_string())?;

    let code = timeout(Duration::from_secs(180), async {
        loop {
            let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;

            let mut buf = vec![0u8; 8192];
            let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
            let request = String::from_utf8_lossy(&buf[..n]);
            let first_line = request.lines().next().unwrap_or("");

            if !first_line.contains("/callback") {
                let resp = "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n";
                let _ = stream.write_all(resp.as_bytes()).await;
                continue;
            }

            let path = first_line.split_whitespace().nth(1).unwrap_or("");
            let query = path.split('?').nth(1).unwrap_or("");

            let mut code: Option<String> = None;
            let mut state: Option<String> = None;
            for pair in query.split('&') {
                let mut kv = pair.splitn(2, '=');
                let (Some(key), Some(val)) = (kv.next(), kv.next()) else {
                    continue;
                };
                match key {
                    "code" => code = decode(val).ok().map(|s| s.into_owned()),
                    "state" => state = decode(val).ok().map(|s| s.into_owned()),
                    "error" => {
                        let resp = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n";
                        let _ = stream.write_all(resp.as_bytes()).await;
                        return Err("Microsoft returned an error in the OAuth callback".to_string());
                    }
                    _ => {}
                }
            }

            if state.as_deref() != Some(csrf.secret()) {
                let resp = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n";
                let _ = stream.write_all(resp.as_bytes()).await;
                return Err("OAuth state mismatch: login aborted".to_string());
            }

            let body = include_str!("../commands/auth_success.html");
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes()).await;

            match code {
                Some(c) if !c.is_empty() => return Ok(c),
                _ => return Err("Empty or missing OAuth code".to_string()),
            }
        }
    })
    .await
    .map_err(|_| "OAuth login timed out after 3 minutes. Please try again.".to_string())??;

    // listener se libera automáticamente aquí (drop al salir del scope del timeout)

    let (ms_access_token, ms_refresh_token) =
        exchange_code(&code, pkce_verifier.secret())
            .await
            .map_err(|e| format!("Error exchanging code: {}", e))?;

    let mc_flow = MinecraftAuthorizationFlow::new(reqwest::Client::new());
    let mc_token = mc_flow
        .exchange_microsoft_token(&ms_access_token)
        .await
        .map_err(|e| format!("Error getting Minecraft token: {}", e))?;

    let profile = get_minecraft_profile(mc_token.access_token().as_ref())
        .await
        .map_err(|e| format!("Error getting profile: {}", e))?;

    Ok(json!({
        "type": "microsoft",
        "minecraft": {
            "name": profile["name"],
            "uuid": profile["id"],
            "access_token": mc_token.access_token().as_ref(),
            "refresh_token": ms_refresh_token,
            "ms_access_token": ms_access_token
        }
    }))
}

fn auth_store_path() -> PathBuf {
    let mut path = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("Spektra");
    std::fs::create_dir_all(&path).ok();
    path.push("auth.json");
    path
}

#[command]
pub fn save_auth_json(payload: String) -> Result<(), String> {
    let path = auth_store_path();
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut file = opts.open(&path).map_err(|e| e.to_string())?;
    file.write_all(payload.as_bytes())
        .map_err(|e| e.to_string())
}

#[command]
pub fn get_auth_json() -> Option<String> {
    std::fs::read_to_string(auth_store_path()).ok()
}

#[command]
pub fn clear_auth() -> Result<(), String> {
    let path = auth_store_path();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
pub async fn refresh_microsoft_token(refresh_token: String) -> Result<Value, String> {
    let client = Client::new();

    let params = [
        ("client_id", CLIENT_ID),
        ("refresh_token", refresh_token.as_str()),
        ("grant_type", "refresh_token"),
        ("scope", "XboxLive.signin offline_access"),
    ];

    let res = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = json.get("error") {
        return Err(format!("Error refresh: {}", err));
    }

    let new_ms_access = json["access_token"]
        .as_str()
        .ok_or("No access_token")?
        .to_string();
    let new_ms_refresh = json["refresh_token"]
        .as_str()
        .ok_or("No refresh_token")?
        .to_string();

    let mc_flow = MinecraftAuthorizationFlow::new(reqwest::Client::new());
    let mc_token = mc_flow
        .exchange_microsoft_token(&new_ms_access)
        .await
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "access_token": mc_token.access_token().as_ref(),
        "refresh_token": new_ms_refresh,
        "ms_access_token": new_ms_access
    }))
}

async fn exchange_code(code: &str, code_verifier: &str) -> Result<(String, String), String> {
    let client = Client::new();

    let params = [
        ("client_id", CLIENT_ID),
        ("code", code),
        ("grant_type", "authorization_code"),
        ("redirect_uri", REDIRECT_URI),
        ("code_verifier", code_verifier),
    ];

    let res = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = json.get("error") {
        return Err(format!(
            "MS token error: {} — {}",
            err,
            json.get("error_description").unwrap_or(&Value::Null)
        ));
    }

    let access_token = json["access_token"]
        .as_str()
        .ok_or("No access_token en respuesta")?
        .to_string();
    let refresh_token = json["refresh_token"]
        .as_str()
        .ok_or("No refresh_token en respuesta")?
        .to_string();

    Ok((access_token, refresh_token))
}

async fn get_minecraft_profile(access_token: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();

    let response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Error perfil: {}", response.status()));
    }

    let profile: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(profile)
}

#[command]
pub fn logout() {
    println!("Sesion cerrada");
}