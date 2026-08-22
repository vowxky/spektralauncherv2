use std::path::PathBuf;
use std::fs;
use tauri::command;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use aes_gcm::{Aes256Gcm, Key, Nonce, KeyInit, aead::Aead};

fn secure_dir() -> PathBuf {
    let mut p = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("Spektra");
    p.push("secure");
    fs::create_dir_all(&p).ok();
    p
}

fn secure_key() -> Result<[u8; 32], String> {
    let entry = keyring::Entry::new("Spektra-secure", "store-key").map_err(|e| e.to_string())?;
    // Try to get existing
    if let Ok(b64) = entry.get_password() {
        if let Ok(bytes) = BASE64.decode(b64.trim()) {
            if bytes.len() == 32 {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&bytes);
                return Ok(arr);
            }
        }
    }
    // Generate new
    use rand::RngCore;
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let b64 = BASE64.encode(key);
    // Store, ignore errors (fallback to ephemeral)
    let _ = entry.set_password(&b64);
    Ok(key)
}

fn encrypt(plain: &str, key: &[u8; 32]) -> Result<String, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    use rand::RngCore;
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, plain.as_bytes()).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(12 + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(BASE64.encode(out))
}

fn decrypt(enc_b64: &str, key: &[u8; 32]) -> Result<String, String> {
    let data = BASE64.decode(enc_b64.trim()).map_err(|e| e.to_string())?;
    if data.len() < 12 { return Err("ciphertext too short".into()); }
    let (nonce_bytes, ct) = data.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);
    let pt = cipher.decrypt(nonce, ct).map_err(|e| e.to_string())?;
    String::from_utf8(pt).map_err(|e| e.to_string())
}

fn key_path(key: &str) -> PathBuf {
    // sanitize key to filename
    let safe: String = key.chars().map(|c| if c.is_alphanumeric() || c=='-' || c=='_' { c } else { '_' }).collect();
    secure_dir().join(format!("{}.dat", safe))
}

#[command]
pub fn secure_set(key: String, value: String) -> Result<(), String> {
    let k = secure_key().unwrap_or([0x42u8; 32]); // fallback ephemeral if keyring fails
    let enc = encrypt(&value, &k)?;
    let p = key_path(&key);
    fs::write(&p, enc).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[command]
pub fn secure_get(key: String) -> Option<String> {
    let p = key_path(&key);
    let enc = fs::read_to_string(&p).ok()?;
    if enc.trim().is_empty() { return None; }
    let k = secure_key().ok()?;
    match decrypt(&enc, &k) {
        Ok(v) => Some(v),
        Err(_) => {
            // fallback: try plain (migration)
            if let Ok(v) = fs::read_to_string(&p) {
                // if it was plain json, return it
                if v.trim().starts_with('[') || v.trim().starts_with('{') {
                    return Some(v);
                }
            }
            None
        }
    }
}

#[command]
pub fn secure_remove(key: String) -> Result<(), String> {
    let p = key_path(&key);
    if p.exists() { fs::remove_file(&p).map_err(|e| e.to_string())?; }
    Ok(())
}
