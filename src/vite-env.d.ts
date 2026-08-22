/// <reference types='vite/client' />

interface Config {
  params: {
    "ignore-gpu-blocklist": boolean;
    "hardware-acceleration": boolean;
  };
  game: {
    detached: boolean;
    minRAM: string;
    maxRAM: string;
    fullScreen: boolean;
    directory: string;
  };
  app: {
    "window-size": string;
    "window-maximized": boolean;
    animations?: boolean;
    "animated-background": boolean;
    "hide-on-launch": boolean;
    "discord-rpc": boolean;
  };
  set: (key: string, value: any) => void;
}

interface AuthCodeData {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

interface User {
  type: "microsoft" | "offline";
  minecraft: {
    access_token: string;
    client_token: string;
    uuid: string;
    name: string;
    refresh_token: string;
    ms_access_token: string;
    // Expiración — guardado por el backend (ms) para refresh proactivo
    expires_at?: number;
    expires_in?: number;
    ms_expires_at?: number;
    ms_expires_in?: number;
    user_properties: "{}";
    meta: {
      type: "Xbox";
      access_token_expires_in: number;
      demo: boolean;
    };
    xboxAccount: {
      xuid: string;
      gamertag: string;
      ageGroup: string;
    };
  };
}

interface MCVersion {
  id: string;
  type: string;
  url: string;
  time: string;
  releaseTime: string;
}
interface MCVersionLatest {
  release: string;
  snapshot: string;
}

interface Instance {
  id: string;
  slug: string;
  title: string;
  description: string;
  version: number;
  minecraft_version: string;
  server: string;
  loader: {
    type: "fabric" | "forge" | "";
    build: "latest" | string;
    enable: boolean;
  };
  hide: boolean;
  locked: boolean;
  code: string;
  users: {
    whitelist: string[];
    noPremium: boolean;
  };
  icon: string;
  landscape: string;
  poster: string;
  animation: string;
  files?: RemoteFile[];
}

interface RemoteFile {
  path: string;
  hashes?: {
    sha512: string;
    sha1: string;
  };
  downloads?: string[];
  size?: number;
  isOverride?: boolean;
}
