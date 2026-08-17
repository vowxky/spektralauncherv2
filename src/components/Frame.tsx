import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLaunch } from "../stores/launchContext";
import { useInstance } from "../stores/instanceContext";
import { useUpdate } from "../stores/updateContext";
import { useIntro } from "../stores/introStore";
import { Button, ProgressBar } from "@heroui/react";
import { RunningInstances } from "./RunningInstances";
import {
  IconDownload,
  IconMinus,
  IconRefresh,
  IconSquare,
  IconSquares,
  IconX,
} from "@tabler/icons-react";

interface DownloadItem {
  id: string;
  name: string;
  title?: string;
  progress: number;
  status: string;
  indeterminate?: boolean;
}

function DownloadsPopup() {
  const { progressMap, pendingInstances } = useLaunch();
  const { instances } = useInstance();
  const [open, setOpen] = useState(false);
  const [userClosed, setUserClosed] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  const displayNameFor = (id: string, fallback?: string) => {
    const inst = instances.find((item) => item.id === id || item.slug === id);
    return inst?.title || inst?.slug || fallback || id;
  };

  const downloads: DownloadItem[] = [
    ...[...pendingInstances.entries()]
      .filter(([id]) => ![...progressMap.keys()].some((k) => k.startsWith(`${id}:`)))
      .map(([id, name]) => ({
        id: `${id}:pending`,
        name: displayNameFor(id, name),
        progress: 0,
        status: `Iniciando ${displayNameFor(id, name)}...`,
        indeterminate: true,
      })),
    ...[...progressMap.values()].map((p) => ({
      id: `${p.instanceId}:${p.name.toLowerCase()}`,
      name: displayNameFor(p.instanceId, p.name),
      progress: p.progress,
      status: p.status,
      indeterminate: p.indeterminate,
    })),
  ];
  const hasActivity = downloads.length > 0 || pendingInstances.size > 0;

  useEffect(() => {
    if (hasActivity && !userClosed) setOpen(true);
    if (!hasActivity) {
      setOpen(false);
      setUserClosed(false);
    }
  }, [hasActivity, userClosed]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const handler = (e: MouseEvent) => {
        if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
          setOpen(false);
          setUserClosed(true);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  if (!hasActivity) return null;

  return (
    <div className="relative flex items-center" ref={popupRef}>
      <Button
        variant="ghost"
        size="lg"
        isIconOnly
        onPress={() => {
          setOpen((value) => !value);
          setUserClosed(false);
        }}
        className="relative h-11 w-10 rounded-none p-0 ring-inset"
        aria-label="Descargas"
      >
        <IconDownload size={16} />
        <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-success" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[316px] max-w-sm w-max z-50 rounded-lg border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <IconDownload size={14} className="text-success" />
              Descargas
            </div>
            <Button variant="ghost" isIconOnly onPress={() => setOpen(false)} className="size-5 rounded">
              <IconX size={12} />
            </Button>
          </div>
          <div className="flex flex-col gap-3 px-3 py-3">
            {downloads.map((item) => (
              <div key={item.id} className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-foreground">{item.title ?? item.name}</span>
                <ProgressBar value={item.progress} isIndeterminate={item.indeterminate}>
                  <ProgressBar.Track>
                    <ProgressBar.Fill />
                  </ProgressBar.Track>
                </ProgressBar>
                <div className="flex items-center justify-start gap-1.5 text-xs text-muted w-full">
                  <span className="shrink-0">{item.progress}%</span>
                  <span>{item.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Frame() {
  const { status, applyUpdate, closeWithInstall } = useUpdate();
  const introActive = useIntro((s) => s.active);
  const setLogoPos = useIntro((s) => s.setLogoPos);
  const logoRef = useRef<HTMLImageElement>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const measure = () => {
      const el = logoRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setLogoPos({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [setLogoPos]);

  const closeApp = () =>
    status === "downloaded" ? closeWithInstall() : getCurrentWindow().close();
  const minimizeApp = () =>
    getCurrentWindow().minimize().then(() => setIsMaximized(false));
  const maximizeApp = () =>
    getCurrentWindow().toggleMaximize().then(() => setIsMaximized(true));

  useEffect(() => {
    const check = async () => setIsMaximized(await getCurrentWindow().isMaximized());
    check();
    getCurrentWindow().onResized(check);
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="relative w-full h-11 flex justify-between"
      style={{
        background: "linear-gradient(180deg, #141414 0%, #0d0d0d 100%)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div data-tauri-drag-region className="px-4 flex items-center gap-x-2">
        <img
          ref={logoRef}
          data-logo
          data-tauri-drag-region
          src="./icon.png"
          alt="Logo"
          className="w-6 h-6"
          style={{
            filter: "grayscale(1) brightness(1.25)",
            visibility: introActive ? "hidden" : "visible",
          }}
        />
        <span data-tauri-drag-region className="text-sm text-muted font-semibold">
          Spektra Launcher
        </span>
        <div className="flex items-center gap-x-1">
        </div>
      </div>

      <div className="flex h-11 items-center">
        <RunningInstances />
        <DownloadsPopup />
        {status === "downloaded" && (
          <Button variant="ghost" size="lg" isIconOnly onPress={applyUpdate} className="h-11 w-10 rounded-none p-0 ring-inset text-accent" aria-label="Actualizacion lista">
            <IconRefresh size={16} />
          </Button>
        )}
        <Button variant="ghost" size="lg" isIconOnly onPress={minimizeApp} className="h-11 w-10 rounded-none p-0 ring-inset">
          <IconMinus size={16} />
        </Button>
        <Button variant="ghost" size="lg" isIconOnly onPress={maximizeApp} className="h-11 w-10 rounded-none p-0 ring-inset">
          {isMaximized ? <IconSquares size={16} className="-rotate-90" /> : <IconSquare size={16} />}
        </Button>
        <Button variant="ghost" size="lg" isIconOnly onPress={closeApp} className="h-11 w-10 rounded-none p-0 ring-inset hover:bg-danger-soft-hover hover:text-danger-soft-foreground">
          <IconX size={16} />
        </Button>
      </div>
    </div>
  );
}
