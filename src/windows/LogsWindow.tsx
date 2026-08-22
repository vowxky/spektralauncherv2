import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@heroui/react";
import {
  IconArrowDown,
  IconCopy,
  IconEraser,
  IconFolderOpen,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useInstance } from "../stores/instanceContext";

interface Log {
  instance: string;
  type: string;
  message: string;
  timestamp?: string;
}

interface JavaLog {
  version: number;
  message: string;
  timestamp?: string;
}

type TypeFilter = "all" | "log" | "error";

function formatTime(timestamp?: string): string {
  if (timestamp) return timestamp;
  return new Date().toLocaleTimeString([], { hour12: false });
}

export default function LogsWindow() {
  const { selectedInstance } = useInstance();
  const [logs, setLogs] = useState<Log[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedInstance);

  useEffect(() => {
    selectedRef.current = selectedInstance;
  }, [selectedInstance]);

  const instanceIdentifier = useMemo(() => {
    if (selectedInstance) return `${selectedInstance.id}-${selectedInstance.slug ?? ""}`;
    return "null";
  }, [selectedInstance]);

  // Load initial tail for current instance
  useEffect(() => {
    if (!selectedInstance) return;
    const id = `${selectedInstance.id}-${selectedInstance.slug ?? ""}`;
    invoke<string[]>("get_instance_logs_tail", { instanceId: id, lines: 500 })
      .then((lines) => {
        if (lines.length === 0) return;
        setLogs((prev) => {
          const mapped = lines.map((msg) => ({
            instance: id,
            type: "log" as const,
            message: msg,
          }));
          // avoid duplicates if already listening
          const merged = [...prev, ...mapped];
          return merged.length > 2000 ? merged.slice(-2000) : merged;
        });
      })
      .catch(() => {});
  }, [selectedInstance]);

  useEffect(() => {
    const unlistenLog = listen<Log>("instance-logger", (event) => {
      setLogs((prev) => {
        const next = [...prev, event.payload];
        return next.length > 2000 ? next.slice(-2000) : next;
      });
    });

    const unlistenJava = listen<JavaLog>("java-log", (event) => {
      const sel = selectedRef.current;
      setLogs((prev) => {
        const next = [
          ...prev,
          {
            instance: sel ? `${sel.id}-${sel.slug ?? ""}` : "java",
            type: "log" as const,
            message: event.payload.message,
            timestamp: (event.payload as any).timestamp,
          },
        ];
        return next.length > 2000 ? next.slice(-2000) : next;
      });
    });

    return () => {
      unlistenLog.then((f) => f());
      unlistenJava.then((f) => f());
    };
  }, []);

  const instanceLogs = useMemo(
    () => logs.filter((l) => l.instance === instanceIdentifier || l.instance === "java"),
    [logs, instanceIdentifier],
  );

  const visibleLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return instanceLogs.filter((l) => {
      if (typeFilter !== "all" && l.type !== typeFilter) return false;
      if (q && !l.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [instanceLogs, typeFilter, search]);

  useEffect(() => {
    if (autoScroll) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [visibleLogs, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(atBottom);
  };

  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAutoScroll(true);
  };

  const clearLogs = useCallback(() => {
    setLogs((prev) => prev.filter((l) => l.instance !== instanceIdentifier && l.instance !== "java"));
    if (selectedInstance) {
      const id = `${selectedInstance.id}-${selectedInstance.slug ?? ""}`;
      invoke("clear_instance_logs", { instanceId: id }).catch(() => {});
    }
  }, [instanceIdentifier, selectedInstance]);

  const copyAll = useCallback(async () => {
    const text = visibleLogs
      .map((l) => `[${formatTime(l.timestamp)}] ${l.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }, [visibleLogs]);

  const openLogFolder = useCallback(async () => {
    try {
      const path = await invoke<string>("get_log_path");
      try {
        const shell: any = await import("@tauri-apps/plugin-shell");
        const opener = shell.open ?? shell.openPath;
        if (opener) await opener(path);
        else await navigator.clipboard.writeText(path);
      } catch {
        await navigator.clipboard.writeText(path);
      }
    } catch {}
  }, []);

  return (
    <div
      data-theme="dark"
      className="w-screen h-screen flex flex-col bg-[#0a0a0c] text-[#eeeef0] overflow-hidden select-none"
    >
      {/* Title bar */}
      <div
        data-tauri-drag-region
        className="h-9 flex items-center justify-between px-3 shrink-0 border-b border-white/10 bg-[#111113]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold truncate">
            Logs — {selectedInstance?.title ?? "Spektra"}
          </span>
          <span className="text-[11px] text-white/40 hidden sm:inline">
            Ctrl+L / F12 para abrir desde el launcher
          </span>
        </div>
        <button
          onClick={() => getCurrentWindow().close()}
          className="size-7 flex items-center justify-center rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          aria-label="Cerrar"
        >
          <IconX size={14} />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 p-3 border-b border-white/5 bg-[#111113] shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1.5 rounded border border-white/10 bg-black/40 px-2 py-1.5 min-w-0">
            <IconSearch size={12} className="shrink-0 text-white/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar mensajes..."
              className="w-full min-w-0 bg-transparent text-xs text-white outline-none placeholder:text-white/40"
            />
          </div>
          <Button size="sm" variant="ghost" isIconOnly onPress={copyAll} className="size-7 shrink-0 rounded" aria-label="Copiar logs">
            <IconCopy size={12} />
          </Button>
          <Button size="sm" variant="ghost" isIconOnly onPress={clearLogs} className="size-7 shrink-0 rounded" aria-label="Limpiar logs">
            <IconEraser size={12} />
          </Button>
          <Button size="sm" variant="ghost" isIconOnly onPress={openLogFolder} className="size-7 shrink-0 rounded" aria-label="Abrir carpeta de logs">
            <IconFolderOpen size={12} />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          {(["all", "log", "error"] as TypeFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setTypeFilter(f)}
              className={`px-2 py-0.5 rounded text-[11px] uppercase tracking-wide transition-colors ${typeFilter === f ? "bg-white/15 text-white" : "text-white/40 hover:text-white"}`}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-white/30">
            {visibleLogs.length} líneas {autoScroll ? "• auto-scroll" : ""}
          </span>
        </div>
      </div>

      {/* Log list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto flex flex-col bg-black relative"
      >
        {visibleLogs.length === 0 && (
          <div className="p-3 font-mono text-xs text-white/60">Waiting for instance to launch</div>
        )}
        {visibleLogs.map((log, i) => (
          <div
            key={i}
            className={`w-full px-3 first:pt-2 last:pb-2 whitespace-pre-wrap break-all font-mono text-xs leading-relaxed ${log.type === "error" ? "text-red-500" : "text-white"} ${i % 2 === 1 ? "bg-white/[0.03]" : ""}`}
          >
            <span className="mr-2 select-none opacity-50">{formatTime(log.timestamp)}</span>
            {log.message}
          </div>
        ))}
        {!autoScroll && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-2 self-end mr-2 flex items-center gap-1 rounded border border-white/15 bg-white/10 px-2 py-1 text-[11px] text-white backdrop-blur hover:bg-white/15"
          >
            <IconArrowDown size={11} />
            Ir al final
          </button>
        )}
      </div>
    </div>
  );
}
