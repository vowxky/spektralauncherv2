import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@heroui/react";

import UserBtn from "../components/UserBtn";
import SpektraIntro from "../components/SpektraIntro";
import defaultBackground from "../assets/modstack-default.jpg";
import { IconSettings, IconSettingsFilled } from "@tabler/icons-react";
import { useAuth } from "../stores/authContext";
import { useInstance } from "../stores/instanceContext";
import { useLaunch } from "../stores/launchContext";
import { useSettings } from "../stores/settingsContext";
import { useNavigation } from "../hooks/useNavigation";

// NOTE: mirror of the design tokens declared in globals.css
// (:root --background, --surface, --border, --foreground, --muted).
// Kept inline for the gothic chrome; prefer CSS vars for new UI.
const C = {
  bg: "#0a0a0c",
  surface: "#111113",
  surfaceSec: "#15151a",
  border: "rgba(255,255,255,0.06)",
  borderSub: "rgba(255,255,255,0.10)",
  fg: "#eeeef0",
  fgMuted: "#7a7a8a",
  overlay: "rgba(0,0,0,0.82)",
} as const;

function GothicIconBtn({
  onClick,
  title,
  active = false,
  size = 48,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  size?: number;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        position: "relative",
        width: size,
        height: size,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        outline: "none",
        transform: pressed ? "translateY(2px)" : hovered ? "translateY(-1px)" : "none",
        transition: "transform 0.08s",
        filter: hovered ? "brightness(1.15)" : "none",
      }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <rect x="2" y="6" width="44" height="42" rx="3" fill="rgba(0,0,0,0.75)" />
        <rect x="0" y="6" width="46" height="42" rx="3" fill={active ? C.surfaceSec : C.bg} />
        <rect x="0" y="0" width="46" height="42" rx="3" fill={active ? "#1e1e26" : "#141418"} />
        <rect x="2" y="1" width="42" height="8" rx="2" fill={active ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)"} />
        <rect x="1" y="1" width="4" height="40" rx="2" fill={active ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)"} />
        <rect x="0" y="0" width="46" height="42" rx="3" fill="none" stroke={active ? "rgba(255,255,255,0.18)" : C.border} strokeWidth="1" />
        <rect x="0" y="38" width="46" height="4" rx="2" fill="rgba(0,0,0,0.40)" />
      </svg>
      <span style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: active ? C.fg : C.fgMuted, width: "100%", height: "100%", paddingBottom: 4 }}>
        {children}
      </span>
    </button>
  );
}

function instanceMedia(instance: Instance | null) {
  return {
    animation: instance?.animation || undefined,
    poster: instance?.landscape || instance?.poster || defaultBackground,
  };
}

export default function Home() {
  const push = useNavigation((state) => state.push);
  const currentPath = useNavigation((state) => state.currentPath);
  const { animatedBackground } = useSettings();
  const { user } = useAuth();
  const { runningInstances } = useLaunch();
  const {
    instances,
    installedInstances,
    selectedInstance,
    setSelectedInstance,
    fetchInstances,
    launchInstance,
    launchedInstanceId,
    installProgress,
    installStatus,
  } = useInstance();
  const [playHovered, setPlayHovered] = useState(false);
  const [playPressed, setPlayPressed] = useState(false);
  const mediaRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  // Shortcuts: Ctrl+L/F12 = logs en ventana separada, Ctrl+, / Ctrl+Shift+S = ajustes
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (isTyping && event.key !== "Escape") return;

      const ctrlOrCmd = event.ctrlKey || event.metaKey;

      const isLogs =
        event.key === "F12" ||
        (ctrlOrCmd && event.key.toLowerCase() === "l");
      if (isLogs) {
        event.preventDefault();
        invoke("open_logs_window").catch(console.error);
        return;
      }

      const isSettings =
        (ctrlOrCmd && event.key === ",") ||
        (ctrlOrCmd && event.shiftKey && event.key.toLowerCase() === "s");

      if (isSettings) {
        event.preventDefault();
        push(currentPath === "settings" ? "home" : "settings");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentPath, push]);

  const panelInstances = useMemo(() => instances.filter((instance) => !instance.hide), [instances]);
  // Fallback robusto: si hay una instancia corriendo, priorizarla para que el botón refleje JUGANDO
  const instance = useMemo(() => {
    const fallbackCached = (() => {
      try {
        const raw = window.localStorage.getItem("cachedPanelInstances");
        const arr = raw ? (JSON.parse(raw) as Instance[]) : [];
        return arr[0] ?? null;
      } catch {
        return null;
      }
    })();
    // Priorizar la instancia activa (fix "no lo actualiza en el boton")
    const runningId = [...runningInstances][0];
    if (runningId) {
      const runningResolved =
        panelInstances.find((i) => i.id === runningId || (i as any).slug === runningId) ??
        installedInstances.find((i) => i.id === runningId || (i as any).slug === runningId) ??
        (selectedInstance && (selectedInstance.id === runningId || (selectedInstance as any).slug === runningId) ? selectedInstance : null) ??
        (fallbackCached && (fallbackCached.id === runningId || (fallbackCached as any).slug === runningId) ? fallbackCached : null);
      if (runningResolved) {
        console.log("[Home] resolve instance (running priority)", { runningId, resolvedId: (runningResolved as any).id });
        return runningResolved as Instance;
      }
    }
    const resolved = (panelInstances[0] ??
      selectedInstance ??
      (installedInstances[0] as unknown as Instance) ??
      fallbackCached) as Instance | null;
    console.log("[Home] resolve instance", {
      panelLen: panelInstances.length,
      installedLen: installedInstances.length,
      hasSelected: !!selectedInstance,
      runningId: runningId ?? null,
      resolvedId: resolved?.id ?? null,
      cachedId: fallbackCached?.id ?? null,
    });
    return resolved;
  }, [panelInstances, selectedInstance, installedInstances, runningInstances]);
  const media = instanceMedia(instance);
  const isSelectedRunning = instance ? runningInstances.has(instance.id) || instance.id === launchedInstanceId : false;
  const isBusy = installProgress > 0 || installStatus !== "";
  const isPlayLocked = !instance || isBusy || isSelectedRunning;
  const buttonLabel = isSelectedRunning ? "JUGANDO" : isBusy ? "INSTALANDO" : "JUGAR";
  const isActiveGreen = isSelectedRunning;
  const bottomHeight = 68;
  const playTransform = playPressed && !isPlayLocked
    ? "translateY(2px)"
    : playHovered && !isPlayLocked
      ? "translateY(-2px)"
      : "none";

  const playInstance = (instance: Instance | null) => {
    if (!user) {
      toast.danger("Inicia sesion", { description: "Debes iniciar sesion para jugar." });
      return;
    }
    if (!instance || isBusy) return;
    if (runningInstances.has(instance.id) || launchedInstanceId === instance.id) {
      invoke("stop_instance", { instanceId: instance.id }).catch(console.error);
      return;
    }
    setSelectedInstance(instance);
    launchInstance(instance);
  };

  const handlePlay = () => playInstance(instance);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", background: "var(--color-background)" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <video
          ref={mediaRef}
          src={animatedBackground ? media.animation : undefined}
          poster={!media.animation || !animatedBackground ? media.poster : undefined}
          autoPlay
          loop
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          className="theme-tint-media"
        />
        {!media.animation || !animatedBackground ? null : <img src={media.poster} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover theme-tint-media" />}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.70) 78%, rgba(0,0,0,0.97) 100%)" }} />
      </div>

      <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, paddingBottom: bottomHeight, top: "50%" }}>
        <button
          disabled={isPlayLocked}
          onClick={handlePlay}
          className="min-w-[210px] max-w-[280px] px-4"
          style={{ position: "relative", height: 52, border: "none", cursor: isPlayLocked ? "not-allowed" : "pointer", background: "transparent", outline: "none", opacity: !instance ? 0.85 : 1, transform: playTransform, filter: playHovered && !isPlayLocked ? "brightness(1.18)" : "none", transition: "transform 0.08s, filter 0.1s" }}
          onMouseEnter={() => setPlayHovered(true)}
          onMouseLeave={() => {
            setPlayHovered(false);
            setPlayPressed(false);
          }}
          onMouseDown={() => {
            if (isPlayLocked) return;
            setPlayPressed(true);
          }}
          onMouseUp={() => {
            if (isPlayLocked) return;
            setPlayPressed(false);
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 52" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            <rect x="3" y="8" width="204" height="44" rx="3" fill="rgba(0,0,0,0.75)" />
            <rect x="0" y="8" width="207" height="44" rx="3" fill={isActiveGreen ? "#0a1f12" : isBusy ? "#090909" : C.bg} />
            <rect x="0" y="0" width="207" height="44" rx="3" fill={isActiveGreen ? "#16a34a" : isBusy ? "#141416" : "#1a1a1f"} />
            <rect x="2" y="1" width="203" height="10" rx="2" fill={isActiveGreen ? "rgba(255,255,255,0.18)" : isBusy ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.10)"} />
            <rect x="1" y="1" width="5" height="42" rx="2" fill={isActiveGreen ? "rgba(255,255,255,0.10)" : isBusy ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.06)"} />
            <rect x="0" y="0" width="207" height="44" rx="3" fill="none" stroke={isActiveGreen ? "rgba(34,197,94,0.55)" : isBusy ? C.border : "rgba(255,255,255,0.22)"} strokeWidth="1" />
          </svg>
          <span className="truncate" style={{ position: "relative", zIndex: 1, display: "block", fontSize: 22, fontWeight: 400, letterSpacing: "0.12em", fontFamily: "'Minecraft', 'Courier New', monospace", color: isActiveGreen ? "#dcfce7" : isBusy ? "#3a3a46" : C.fg, textShadow: isActiveGreen ? "0 2px 0 rgba(0,0,0,0.5)" : isBusy ? "none" : "0 2px 0 rgba(0,0,0,0.7)", userSelect: "none", paddingLeft: 8, paddingRight: 8 }}>
            {buttonLabel}
          </span>
        </button>
      </div>

      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20, height: bottomHeight, background: "rgba(10,10,12,0.93)", backdropFilter: "blur(14px)", borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <UserBtn />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <GothicIconBtn size={40} onClick={() => push("settings")} title="Ajustes" active={currentPath === "settings"}>
            {currentPath === "settings" ? <IconSettingsFilled size={20} /> : <IconSettings size={20} />}
          </GothicIconBtn>
        </div>
      </div>

      <SpektraIntro />
    </div>
  );
}