import { useEffect, useState } from "react";
import { Toast } from "@heroui/react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

import Frame from "./components/Frame";
import { UpdateNotification } from "./components/UpdateNotification";

import Home from "./views/Home";
import Settings from "./views/Settings";
import Loading from "./views/Loading";
import Login from "./views/Login";
import LogsWindow from "./windows/LogsWindow";

import { UpdateProvider, useUpdate } from "./stores/updateContext";
import { useNavigation } from "./hooks/useNavigation";
import { useAuth } from "./stores/authContext";
import { useInstance } from "./stores/instanceContext";
import { useLaunch } from "./stores/launchContext";
import { useSettings } from "./stores/settingsContext";

const ALLOWED_PATHS = new Set(["home", "settings"]);

function AppInner() {
  const currentPath = useNavigation((s) => s.currentPath);
  const push = useNavigation((s) => s.push);
  const { authReady, user } = useAuth();
  const { isRunning, installProgress, launchedInstanceId } = useInstance() as any;
  const { progressMap } = useLaunch();
  const { discordRPC } = useSettings();
  const [loadingDone, setLoadingDone] = useState(false);
  useUpdate();

  const [winLabel, setWinLabel] = useState<string>(() => {
    try {
      return getCurrentWindow().label;
    } catch {
      return "main";
    }
  });

  useEffect(() => {
    // Re-evaluar por si el label no estuvo listo en el primer render (WebView2 Windows)
    try {
      const lbl = getCurrentWindow().label;
      if (lbl && lbl !== winLabel) setWinLabel(lbl);
    } catch {}
    // Fallback: si la URL contiene label=logs (/debug)
    if (window.location.hash.includes("logs") && winLabel !== "logs") {
      setWinLabel("logs");
    }
  }, [winLabel]);

  const isLogsWindow = winLabel === "logs";

  // Evitar flash blanco en Windows antes de que React pinte — fondo oscuro inmediato
  useEffect(() => {
    if (isLogsWindow) {
      document.documentElement.style.backgroundColor = "#0a0a0c";
      document.body.style.backgroundColor = "#0a0a0c";
    }
  }, [isLogsWindow]);

  useEffect(() => {
    if (isLogsWindow) {
      getCurrentWindow().show().catch(console.error);
    }
  }, [isLogsWindow]);

  useEffect(() => {
    if (isLogsWindow) return;
    if (ALLOWED_PATHS.has(currentPath)) return;
    push("home");
  }, [isLogsWindow, currentPath, push]);

  useEffect(() => {
    if (isLogsWindow) return;
    getCurrentWindow().show().catch(console.error);
    emit("frontend-ready", {});
  }, [isLogsWindow]);

  // Discord Rich Presence — estados pulidos:
  // login → "En el inicio de sesión / Esperando autenticación"
  // home  → "En el inicio / Descansando"
  // ajustes → "En los ajustes / Personalizando el launcher"
  // descargando → "Descargando <instancia> / Preparando archivos • 42%"
  // jugando → lo maneja InstanceProvider (discord_set_playing)
  useEffect(() => {
    if (isLogsWindow) return;
    if (!authReady) return;
    if (!discordRPC) return;

    // Si hay juego corriendo, no pisar "Jugando" — a menos que esté descargando
    if (isRunning) {
      const active = Array.from((progressMap as Map<string, any>).values()).find(
        (p) => p.progress < 100
      );
      if (active) {
        const prog = Math.min(100, Math.max(0, Math.round(active.progress)));
        invoke("discord_set_downloading", { name: active.name || launchedInstanceId || "Instancia", progress: prog }).catch(() => {});
      }
      return;
    }

    // Descargando sin isRunning (fallback por installProgress)
    if (installProgress > 0 && launchedInstanceId) {
      invoke("discord_set_downloading", { name: launchedInstanceId, progress: Math.round(installProgress) }).catch(() => {});
      return;
    }

    if (!user) {
      invoke("discord_set_login").catch(() => {});
      return;
    }

    if (currentPath === "settings") {
      invoke("discord_set_settings").catch(() => {});
      return;
    }

    invoke("discord_set_home").catch(() => {});
  }, [authReady, user, isLogsWindow, isRunning, discordRPC, currentPath, progressMap, installProgress, launchedInstanceId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  if (isLogsWindow) {
    return <LogsWindow />;
  }

  return (
    <div
      data-theme="dark"
      className="w-screen h-screen flex flex-col bg-background overflow-hidden rounded-xl"
    >
      <Toast.Provider placement="top" className="top-11" />
      {!loadingDone && <Loading onDone={() => setLoadingDone(true)} />}
      <UpdateNotification />
      <Frame />

      {authReady && user && (
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <Home />
          {currentPath === "settings" && <Settings />}
        </div>
      )}
      {authReady && !user && (
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <Login />
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <UpdateProvider>
      <AppInner />
    </UpdateProvider>
  );
}
