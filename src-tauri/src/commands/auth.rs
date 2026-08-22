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

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| Client::new())
}

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
    drop(listener);

    let (ms_access_token, ms_refresh_token, ms_expires_in) =
        exchange_code(&code, pkce_verifier.secret())
            .await
            .map_err(|e| format!("Error exchanging code: {}", e))?;

    let mc_flow = MinecraftAuthorizationFlow::new(http_client());
    let mc_token = mc_flow
        .exchange_microsoft_token(&ms_access_token)
        .await
        .map_err(|e| map_minecraft_auth_error(e))?;

    // Perfil de Minecraft — aquí falla el "no encuentra su perfil"
    // Esta llamada verifica que el token es válido contra api.minecraftservices.com
    // (equivalente a la verificación que hace el juego contra sessionserver.mojang.com)
    let profile = get_minecraft_profile(mc_token.access_token().as_ref()).await.map_err(|e| e)?;
    if let Err(e) = check_minecraft_entitlements(mc_token.access_token().as_ref()).await {
        eprintln!("[auth] advertencia entitlements: {}", e);
    }
    let profile_name = profile["name"].as_str().unwrap().to_string();
    let profile_id = profile["id"].as_str().unwrap().to_string();
    let mc_expires_in = mc_token.expires_in() as u64;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    // XUID para que el juego use user_type=msa y obtenga la clave pública de chat
    // (fix "CHAT DISABLED DUE TO MISSING PROFILE PUBLIC KEY")
    let xuid: Option<String> = match get_xbox_xuid(&ms_access_token).await {
        Ok(x) => Some(x),
        Err(e) => {
            eprintln!("[auth] no se pudo obtener XUID (chat puede fallar, se usa fallback): {}", e);
            None
        }
    };

    Ok(json!({
        "type": "microsoft",
        "minecraft": {
            "name": profile_name,
            "uuid": profile_id,
            "access_token": mc_token.access_token().as_ref(),
            "refresh_token": ms_refresh_token,
            "ms_access_token": ms_access_token,
            "expires_at": now_ms + mc_expires_in * 1000,
            "expires_in": mc_expires_in,
            "ms_expires_at": now_ms + ms_expires_in * 1000,
            "ms_expires_in": ms_expires_in,
            "xboxAccount": xuid.as_ref().map(|x| json!({ "xuid": x })).unwrap_or(Value::Null),
            "xbox_account": xuid.as_ref().map(|x| json!({ "xuid": x })).unwrap_or(Value::Null)
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

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("Spektra", "auth").map_err(|e| e.to_string())
}

fn save_to_keyring(payload: &str) -> Result<(), String> {
    let entry = keyring_entry()?;
    entry.set_password(payload).map_err(|e| e.to_string())
}

fn get_from_keyring() -> Option<String> {
    let entry = keyring_entry().ok()?;
    match entry.get_password() {
        Ok(v) if !v.is_empty() => Some(v),
        _ => None,
    }
}

fn clear_keyring() {
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
}

fn save_to_file(payload: &str) -> Result<(), String> {
    let path = auth_store_path();
    let tmp = path.with_extension("json.tmp");
    {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        opts.mode(0o600);
        let mut file = opts.open(&tmp).map_err(|e| e.to_string())?;
        file.write_all(payload.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[command]
pub fn save_auth_json(payload: String) -> Result<(), String> {
    // Validar que sea JSON válido antes de tocar disco/keychain
    serde_json::from_str::<Value>(&payload).map_err(|e| format!("payload no es JSON válido: {}", e))?;
    // 1) Intento keychain OS (sin prompt, atado al login del usuario)
    //    Si funciona, es la fuente de verdad y borramos el archivo plano para no dejar tokens en texto
    match save_to_keyring(&payload) {
        Ok(()) => {
            // Migración: eliminar archivo plano si existe (no falla si no existe)
            let path = auth_store_path();
            if path.exists() {
                let _ = std::fs::remove_file(&path);
            }
            return Ok(());
        }
        Err(e) => {
            eprintln!("[auth] keychain no disponible, fallback a archivo: {}", e);
        }
    }
    // 2) Fallback a archivo (compatibilidad / entornos sin keychain)
    save_to_file(&payload)
}

#[command]
pub fn get_auth_json() -> Option<String> {
    // 1) Keychain primero — fuente de verdad segura
    if let Some(v) = get_from_keyring() {
        return Some(v);
    }
    // 2) Fallback archivo
    let path = auth_store_path();
    let file_content = match std::fs::read_to_string(&path) {
        Ok(v) if !v.trim().is_empty() && serde_json::from_str::<Value>(&v).is_ok() => v,
        _ => return None,
    };
    // En dev no forzamos re-login para no molestar (mantiene compatibilidad)
    if cfg!(debug_assertions) {
        eprintln!("[auth] dev mode: sesión legacy encontrada, usando archivo sin forzar re-login");
        return Some(file_content);
    }
    // Intentar migrar a keychain para saber si el backend está disponible.
    // En entornos sin Secret Service / keychain, esto falla y hacemos fallback silencioso
    // sin forzar re-login (evita loop infinito).
    // En producción con keychain OK, forzamos un re-login ÚNICO para que los tokens
    // se regeneren ya cifrados y con la nueva estructura expires_at.
    match save_to_keyring(&file_content) {
        Ok(()) => {
            eprintln!("[auth] sesión legacy detectada — forzando re-login único para migrar a keychain");
            let _ = std::fs::remove_file(&path);
            clear_keyring(); // borra la copia migrada para exigir login fresco
            None // fuerza Login en el frontend
        }
        Err(e) => {
            eprintln!("[auth] keychain no disponible ({}), usando archivo como fallback sin forzar", e);
            Some(file_content)
        }
    }
}

#[command]
pub fn clear_auth() -> Result<(), String> {
    clear_keyring();
    let path = auth_store_path();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
#[allow(non_snake_case)]
pub async fn refresh_microsoft_token(
    refreshToken: Option<String>,
    refresh_token: Option<String>,
) -> Result<Value, String> {
    let refresh_token = refreshToken
        .or(refresh_token)
        .ok_or_else(|| "Missing refreshToken/refresh_token".to_string())?;
    if refresh_token.trim().is_empty() || refresh_token.len() < 10 {
        return Err("refresh_token vacío o inválido — vuelve a iniciar sesión".to_string());
    }
    let client = http_client();

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
        .map_err(|e| format!("Error de red en refresh: {}", e))?;

    // Si el endpoint devuelve HTML (p.ej. 500) el .json() fallaría con mensaje críptico
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_str(&text).map_err(|_| {
        format!("Respuesta no-JSON del servidor Microsoft ({}): {}", status, &text[..text.len().min(300)])
    })?;

    if let Some(err) = json.get("error") {
        let err_str = err.as_str().unwrap_or("");
        let desc = json
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        // Errores que requieren re-login según doc MS: invalid_grant, interaction_required, login_required, consent_required
        let needs_relogin = matches!(
            err_str,
            "invalid_grant" | "interaction_required" | "login_required" | "consent_required" | "invalid_request"
        );
        if needs_relogin {
            return Err(
                "Sesión expirada: vuelve a iniciar sesión con Microsoft (refresh_token inválido o revocado)".to_string(),
            );
        }
        return Err(format!("Error refresh ({}): {} — {}", status, err_str, desc));
    }

    if !status.is_success() {
        return Err(format!("Error HTTP en refresh ({}): {}", status, text.chars().take(500).collect::<String>()));
    }

    let new_ms_access = json["access_token"]
        .as_str()
        .ok_or("No access_token en refresh")?
        .to_string();
    let ms_expires_in = json["expires_in"].as_u64().unwrap_or(3600);
    // Microsoft a veces no rota el refresh_token, reusamos el anterior si no viene
    let new_ms_refresh = json["refresh_token"]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| refresh_token.clone());

    let mc_flow = MinecraftAuthorizationFlow::new(http_client());
    let mc_token = mc_flow
        .exchange_microsoft_token(&new_ms_access)
        .await
        .map_err(|e| map_minecraft_auth_error(e))?;

    // Re-validar perfil en refresh — si es 404 (cuenta solo Xbox) no bloqueamos, solo avisamos
    // Nota: esto verifica que MC pueda validar el token (equiv. a hasJoined/sessionserver)
    let mc_expires_in = mc_token.expires_in() as u64;
    if let Err(e) = get_minecraft_profile(mc_token.access_token().as_ref()).await {
        if e.contains("404") {
            eprintln!("[auth] refresh sin perfil Minecraft (cuenta solo Xbox), continúa con fallback: {}", e);
        } else {
            return Err(e);
        }
    }
    // Entitlements solo como warning
    if let Err(e) = check_minecraft_entitlements(mc_token.access_token().as_ref()).await {
        eprintln!("[auth] advertencia entitlements en refresh: {}", e);
    }

    Ok(json!({
        "access_token": mc_token.access_token().as_ref(),
        "refresh_token": new_ms_refresh,
        "ms_access_token": new_ms_access,
        "expires_in": mc_expires_in,
        "ms_expires_in": ms_expires_in
    }))
}

async fn exchange_code(code: &str, code_verifier: &str) -> Result<(String, String, u64), String> {
    let client = http_client();

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
        .map_err(|e| format!("Error de red en exchange_code: {}", e))?;

    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_str(&text).map_err(|_| {
        format!("Respuesta no-JSON en exchange_code ({}): {}", status, &text[..text.len().min(300)])
    })?;

    if let Some(err) = json.get("error") {
        return Err(format!(
            "MS token error ({}): {} — {}",
            status,
            err,
            json.get("error_description").unwrap_or(&Value::Null)
        ));
    }
    if !status.is_success() {
        return Err(format!("Error HTTP en exchange_code ({}): {}", status, text.chars().take(500).collect::<String>()));
    }

    let access_token = json["access_token"]
        .as_str()
        .ok_or("No access_token en respuesta")?
        .to_string();
    let refresh_token = json["refresh_token"]
        .as_str()
        .ok_or("No refresh_token en respuesta")?
        .to_string();
    let expires_in = json["expires_in"].as_u64().unwrap_or(3600);

    Ok((access_token, refresh_token, expires_in))
}

fn map_minecraft_auth_error(e: minecraft_msa_auth::MinecraftAuthorizationError) -> String {
    use minecraft_msa_auth::MinecraftAuthorizationError::*;
    match e {
        NoXbox => "Tu cuenta Microsoft no tiene perfil de Xbox. Créalo gratis en https://www.xbox.com y vuelve a intentar.".to_string(),
        AddToFamily => "Tu cuenta es de menor y debe ser añadida a una familia Microsoft (https://family.microsoft.com).".to_string(),
        MissingClaims => format!("Error de autenticación Xbox (MissingClaims): {}", e),
        XboxError { x_err, message, redirect } => format!("Error Xbox ({}): {} — {}", x_err, message, redirect),
        Reqwest(err) => format!("Error de red autenticando con Xbox/Minecraft: {}", err),
    }
}

async fn get_minecraft_profile(access_token: &str) -> Result<Value, String> {
    let client = http_client();

    let response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Error de red al validar perfil Minecraft: {}", e))?;

    if response.status() == 404 {
        return Err(
            "No se encontró perfil de Minecraft (404). Tu cuenta no tiene Minecraft Java Edition o aún no creaste un perfil en minecraft.net. Nota: Xbox Game Pass de consola NO incluye Java Edition — necesitas PC Game Pass o comprar el juego. Si acabas de comprar/migrar, entra una vez a minecraft.net y crea tu perfil.".to_string()
        );
    }
    if response.status() == 401 || response.status() == 403 {
        return Err(format!(
            "Token de Minecraft no autorizado ({}). Vuelve a iniciar sesión. Si el problema persiste, tu cuenta no posee el juego.",
            response.status()
        ));
    }
    if response.status() == 429 {
        return Err("Rate limited por api.minecraftservices.com (429). Intenta de nuevo en unos segundos.".to_string());
    }
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Error obteniendo perfil de Minecraft: {} — {}", status, body));
    }

    let profile: Value = response.json().await.map_err(|e| e.to_string())?;
    // Validar que tenga name e id
    if profile.get("name").and_then(|v| v.as_str()).is_none()
        || profile.get("id").and_then(|v| v.as_str()).is_none()
    {
        return Err("Respuesta de perfil inválida (sin name/id). Intenta de nuevo.".to_string());
    }
    Ok(profile)
}

async fn check_minecraft_entitlements(access_token: &str) -> Result<(), String> {
    let client = http_client();
    let resp = client
        .get("https://api.minecraftservices.com/entitlements/mcstore")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        // Si falla entitlements no bloqueamos duro, pero avisamos
        // 401/403 aquí también indica token inválido
        if resp.status() == 401 || resp.status() == 403 {
            return Err("No autorizado al verificar licencias (entitlements). Vuelve a iniciar sesión.".to_string());
        }
        // Otros errores los logueamos pero no bloqueamos el login si ya tenemos perfil
        return Ok(());
    }

    let json: Value = resp.json().await.map_err(|e| e.to_string())?;
    let items = json.get("items").and_then(|v| v.as_array());
    let has_entitlement = items.map(|arr| !arr.is_empty()).unwrap_or(false);
    // Algunos Game Pass devuelven items vacíos pero permiten jugar Bedrock; para Java debe haber item
    if !has_entitlement {
        return Err(
            "Tu cuenta no posee Minecraft Java Edition (sin entitlements). Con Xbox Game Pass de consola no alcanza — es solo para Bedrock/consola. Necesitas PC Game Pass (incluye Java) o comprar Java Edition. Verifica en https://www.minecraft.net/en-us/entitlements/mcstore .".to_string()
        );
    }
    Ok(())
}

fn offline_uuid(username: &str) -> String {
    let name = format!("OfflinePlayer:{}", username);
    let digest = md5::compute(name.as_bytes());
    let mut bytes = digest.0;
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

async fn get_xbox_xuid(ms_access_token: &str) -> Result<String, String> {
    let client = http_client();
    let xbl_resp = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={}", ms_access_token)
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !xbl_resp.status().is_success() {
        return Err(format!("XBL auth falló: {}", xbl_resp.status()));
    }
    let xbl_json: Value = xbl_resp.json().await.map_err(|e| e.to_string())?;
    let xuid = xbl_json
        .get("DisplayClaims")
        .and_then(|v| v.get("xui"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|o| o.get("uhs"))
        .and_then(|v| v.as_str())
        .ok_or("XBL sin uhs/xuid")?
        .to_string();
    Ok(xuid)
}

async fn get_xbox_gamertag(ms_access_token: &str) -> Result<String, String> {
    let client = http_client();
    // 1) Xbox Live authenticate para obtener XBL token
    let xbl_resp = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={}", ms_access_token)
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !xbl_resp.status().is_success() {
        return Err(format!("XBL auth falló: {}", xbl_resp.status()));
    }
    let xbl_json: Value = xbl_resp.json().await.map_err(|e| e.to_string())?;
    let xbl_token = xbl_json
        .get("Token")
        .and_then(|v| v.as_str())
        .ok_or("XBL sin Token")?
        .to_string();
    let user_hash = xbl_json
        .get("DisplayClaims")
        .and_then(|v| v.get("xui"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|o| o.get("uhs"))
        .and_then(|v| v.as_str())
        .ok_or("XBL sin uhs")?
        .to_string();

    // 2) Profile settings para gamertag
    let profile_resp = client
        .get("https://profile.xboxlive.com/users/me/profile/settings?settings=Gamertag")
        .header("Authorization", format!("XBL3.0 x={};{}", user_hash, xbl_token))
        .header("x-xbl-contract-version", "2")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !profile_resp.status().is_success() {
        return Err(format!("Xbox profile falló: {}", profile_resp.status()));
    }
    let profile_json: Value = profile_resp.json().await.map_err(|e| e.to_string())?;
    let gamertag = profile_json
        .get("profileUsers")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|u| u.get("settings"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.iter().find(|s| s.get("id").and_then(|v| v.as_str()) == Some("Gamertag")))
        .and_then(|s| s.get("value"))
        .and_then(|v| v.as_str())
        .ok_or("Gamertag no encontrado")?
        .trim()
        .to_string();
    if gamertag.is_empty() {
        return Err("Gamertag vacío".to_string());
    }
    Ok(gamertag)
}

#[command]
pub fn logout() -> Result<(), String> {
    // Limpia el archivo de sesión — el frontend también limpia su estado
    clear_auth()?;
    println!("Sesión cerrada y archivo auth eliminado");
    Ok(())
}

/// Valida que un token de Minecraft siga siendo válido contra el servidor de Mojang
/// (api.minecraftservices.com). El juego hace la verificación final contra
/// sessionserver.mojang.com/session/minecraft/join, pero esta llamada es el
/// equivalente previo que puede hacer el launcher.
#[command]
pub async fn validate_minecraft_token(access_token: String) -> Result<Value, String> {
    get_minecraft_profile(&access_token).await
}