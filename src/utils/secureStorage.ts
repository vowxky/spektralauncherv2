import { invoke } from "@tauri-apps/api/core";

// Wrapper que cifra en Rust (AES-GCM + key en keyring). Si falla (dev sin keyring), fallback a localStorage con obfuscación base64.
export async function secureSet(key: string, value: string): Promise<void> {
  try {
    await invoke("secure_set", { key, value });
  } catch {
    // fallback
    try { localStorage.setItem(key, btoa(unescape(encodeURIComponent(value)))); } catch {}
  }
}

export async function secureGet(key: string): Promise<string | null> {
  try {
    const v = await invoke<string | null>("secure_get", { key });
    if (v !== null && v !== undefined) return v;
  } catch {}
  // fallback: try localStorage + backend migration check
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      // try base64 decode (obfuscated)
      try {
        const decoded = decodeURIComponent(escape(atob(raw)));
        // if it looks like json, return decoded, else raw
        if (decoded.trim().startsWith("{") || decoded.trim().startsWith("[")) return decoded;
        return raw;
      } catch { return raw; }
    }
  } catch {}
  return null;
}

export async function secureRemove(key: string): Promise<void> {
  try { await invoke("secure_remove", { key }); } catch {}
  try { localStorage.removeItem(key); } catch {}
}
