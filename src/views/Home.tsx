import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  IconPlayerPlay,
  IconSettings,
  IconSettingsFilled,
  IconSquare,
  IconX,
} from "@tabler/icons-react";
import UserBtn from "../components/UserBtn";
import SpektraIntro from "../components/SpektraIntro";
import defaultBackground from "../assets/modstack-default.jpg";
import { useAuth } from "../stores/authContext";
import { useInstance } from "../stores/instanceContext";
import { useLaunch } from "../stores/launchContext";
import { useSettings } from "../stores/settingsContext";
import { useNavigation } from "../hooks/useNavigation";

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

function loaderName(loader: any) {
  if (typeof loader === "object" && loader !== null) {
    return loader.enable === false ? "Vanilla" : loader.type || "Vanilla";
  }
  return String(loader || "Vanilla");
}

function instanceMedia(instance: Instance | null) {
  return {
    animation: instance?.animation || undefined,
    poster: instance?.landscape || instance?.poster || defaultBackground,
  };
}

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

function InstanceSidebar({
  open,
  instances,
  selected,
  launchedInstanceId,
  busyInstanceId,
  accessBlocked,
  onClose,
  onSelect,
  onPlay,
}: {
  open: boolean;
  instances: Instance[];
  selected: Instance | null;
  launchedInstanceId: string | null;
  busyInstanceId: string | null;
  accessBlocked: string | null;
  onClose: () => void;
  onSelect: (instance: Instance) => void;
  onPlay: (instance: Instance) => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            aria-label="Cerrar instancias"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 28,
              border: 0,
              background: "rgba(0,0,0,0.28)",
              backdropFilter: "blur(2px)",
              cursor: "default",
            }}
          />
          <motion.aside
            initial={{ x: 360, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 360, opacity: 0 }}
            transition={{ type: "spring", stiffness: 390, damping: 34 }}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              zIndex: 29,
              width: 344,
              background: "rgba(10,10,12,0.96)",
              borderLeft: `1px solid ${C.borderSub}`,
              boxShadow: "-28px 0 72px rgba(0,0,0,0.72)",
              backdropFilter: "blur(18px)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ minHeight: 58, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 18px", borderBottom: `1px solid ${C.border}` }}>
              <div>
                <div style={{ color: C.fg, fontSize: 14, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" }}>Instancias</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={onClose}
                  style={{ width: 30, height: 30, borderRadius: 7, background: C.surfaceSec, border: `1px solid ${C.borderSub}`, color: C.fgMuted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                >
                  <IconX size={15} />
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {instances.length === 0 ? (
                <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: C.fgMuted, fontSize: 13, lineHeight: 1.5, padding: 24, gap: 14 }}>
                  <div>{accessBlocked || "No hay instancias disponibles."}</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {instances.map((instance, index) => {
                    const isFirst = index === 0;
                    const active = selected?.id === instance.id;
                    const running = launchedInstanceId === instance.id;
                    const busy = busyInstanceId === instance.id;
                    const loader = loaderName(instance.loader);

                    return (
                      <motion.div
                        key={instance.id}
                        initial={{ opacity: 0, x: 24 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(index * 0.025, 0.18), duration: 0.18 }}
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          padding: 10,
                          borderRadius: 9,
                          background: active ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.035)",
                          border: `1px solid ${active ? "rgba(255,255,255,0.18)" : C.border}`,
                          opacity: isFirst ? 1 : 0.55,
                        }}
                      >
                        <button
                          onClick={isFirst ? () => onSelect(instance) : undefined}
                          disabled={!isFirst}
                          style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, background: "transparent", border: 0, padding: 0, color: C.fg, textAlign: "left", cursor: isFirst ? "pointer" : "default" }}
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-black/40">
                            {instance.icon ? (
                              <img src={instance.icon} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span style={{ color: C.fgMuted, fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>
                                {(loader || "V").slice(0, 1)}
                              </span>
                            )}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 800 }}>{instance.title || instance.id}</span>
                            <span style={{ display: "block", color: C.fgMuted, fontSize: 11 }}>{loader} - {instance.minecraft_version}</span>
                          </span>
                        </button>
                        <button
                          onClick={isFirst ? () => onPlay(instance) : undefined}
                          disabled={!isFirst || busy}
                          title={running ? "Detener" : "Jugar"}
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 7,
                            border: `1px solid ${C.borderSub}`,
                            background: running ? "rgba(239,68,68,0.14)" : "rgba(255,255,255,0.06)",
                            color: running ? "#ef9a9a" : C.fg,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: !isFirst || busy ? "not-allowed" : "pointer",
                            opacity: !isFirst ? 0.4 : busy ? 0.55 : 1,
                          }}
                        >
                          {running ? <IconSquare size={14} /> : <IconPlayerPlay size={15} />}
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default function Home() {
  const push = useNavigation((state) => state.push);
  const currentPath = useNavigation((state) => state.currentPath);
  const { animatedBackground } = useSettings();
  const { user } = useAuth();
  const { runningInstances } = useLaunch();
  const {
    instances,
    selectedInstance,
    setSelectedInstance,
    fetchInstances,
    launchInstance,
    launchedInstanceId,
    installProgress,
    installStatus,
    accessBlocked,
  } = useInstance();
  const [instancesSidebarOpen, setInstancesSidebarOpen] = useState(false);
  const [playHovered, setPlayHovered] = useState(false);
  const [playPressed, setPlayPressed] = useState(false);
  const mediaRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  const panelInstances = useMemo(() => instances.filter((instance) => !instance.hide), [instances]);
  const selected =
    selectedInstance && panelInstances.some((item) => item.id === selectedInstance.id)
      ? selectedInstance
      : panelInstances[0] ?? null;
  const media = instanceMedia(selected);
  const isSelectedRunning = selected ? runningInstances.has(selected.id) || selected.id === launchedInstanceId : false;
  const isBusy = installProgress > 0 || installStatus !== "";
  const isPlayLocked = isBusy || isSelectedRunning;
  const buttonLabel = isSelectedRunning ? "JUGANDO" : isBusy ? "INSTALANDO" : "JUGAR";
  const bottomHeight = 68;
  const busyInstanceId = isBusy ? launchedInstanceId : null;
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

  const handlePlay = () => playInstance(selected);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", background: C.bg }}>
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

      <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingBottom: bottomHeight, top: "50%" }}>
        <button
          disabled={isPlayLocked}
          onClick={selected ? handlePlay : () => setInstancesSidebarOpen(true)}
          style={{ position: "relative", width: selected ? 210 : 250, height: 52, border: "none", cursor: isPlayLocked ? "not-allowed" : "pointer", background: "transparent", outline: "none", opacity: 1, transform: playTransform, filter: playHovered && !isPlayLocked ? "brightness(1.18)" : "none", transition: "transform 0.08s, filter 0.1s" }}
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
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 52" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            <rect x="3" y="8" width="204" height="44" rx="3" fill="rgba(0,0,0,0.75)" />
            <rect x="0" y="8" width="207" height="44" rx="3" fill={isPlayLocked ? "#090909" : C.bg} />
            <rect x="0" y="0" width="207" height="44" rx="3" fill={isPlayLocked ? "#141416" : "#1a1a1f"} />
            <rect x="2" y="1" width="203" height="10" rx="2" fill={isPlayLocked ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.10)"} />
            <rect x="1" y="1" width="5" height="42" rx="2" fill={isPlayLocked ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.06)"} />
            <rect x="0" y="0" width="207" height="44" rx="3" fill="none" stroke={isPlayLocked ? C.border : "rgba(255,255,255,0.22)"} strokeWidth="1" />
          </svg>
          <span style={{ position: "relative", zIndex: 1, fontSize: selected ? 22 : 18, fontWeight: 400, letterSpacing: "0.12em", fontFamily: "'Minecraft', 'Courier New', monospace", color: isPlayLocked ? "#3a3a46" : C.fg, textShadow: isPlayLocked ? "none" : "0 2px 0 rgba(0,0,0,0.7)", userSelect: "none" }}>
            {selected ? buttonLabel : "AGREGAR"}
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

        <InstanceSidebar
        open={instancesSidebarOpen}
        instances={panelInstances}
        selected={selected}
        launchedInstanceId={launchedInstanceId}
        busyInstanceId={busyInstanceId}
        accessBlocked={accessBlocked}
        onClose={() => setInstancesSidebarOpen(false)}
        onSelect={(instance) => setSelectedInstance(instance)}
        onPlay={playInstance}
      />

      <SpektraIntro />
    </div>
  );
}
