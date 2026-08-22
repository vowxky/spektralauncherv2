import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInstance } from "../stores/instanceContext";
import { listen } from "@tauri-apps/api/event";
import { cn, Button, Drawer } from "@heroui/react";
import {
  IconArrowDown,
  IconCopy,
  IconEraser,
  IconSearch,
  IconTerminal2,
} from "@tabler/icons-react";

interface Log {
  instance: string;
  type: string;
  message: string;
  timestamp?: string;
}

interface JavaLog {
  version: number;
  message: string;
}

interface Props {
  overrideInstance?: string;
}

type TypeFilter = "all" | "log" | "error";

const TIMESTAMP_RE = /^\[(\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,3})?)\]\s*/;

function stripTimestamp(message: string): string {
  const match = message.match(TIMESTAMP_RE);
  return match ? message.slice(match[0].length) : message;
}

function formatTime(timestamp?: string): string {
  if (timestamp) return timestamp;
  return new Date().toLocaleTimeString([], { hour12: false });
}

export default function InstanceLogger({ overrideInstance }: Props) {
  const [logs, setLogs] = useState<Log[]>([]);
  const { isRunning, selectedInstance } = useInstance();
  const listRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [isOpen, setIsOpen] = useState(false);
  const selectedRef = useRef(selectedInstance);

  useEffect(() => {
    selectedRef.current = selectedInstance;
  }, [selectedInstance]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      // Ignore when typing, but allow Escape to close
      if (isTyping && event.key !== "Escape") return;

      const isToggle =
        event.key === "F12" ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l");

      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        setIsOpen(false);
        return;
      }

      if (isToggle) {
        event.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

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

  const instanceIdentifier = useMemo(() => {
    if (overrideInstance) return overrideInstance;
    if (selectedInstance) return `${selectedInstance.id}-${selectedInstance.slug ?? ""}`;
    return "null";
  }, [selectedInstance, overrideInstance]);

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

  const clearLogs = () => setLogs([]);

  const copyAll = useCallback(async () => {
    const text = visibleLogs
      .map((l) => `[${formatTime(l.timestamp)}] ${l.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may be unavailable in the webview; ignore.
    }
  }, [visibleLogs]);

  const lastLog = useMemo(() => {
    const last = [...instanceLogs].reverse().find((l) => l.message.length > 0);
    if (!last) {
      if (isRunning && selectedInstance) return selectedInstance.title;
      return "Waiting for instance to launch";
    }
    return stripTimestamp(last.message) || last.message;
  }, [instanceLogs, isRunning, selectedInstance]);

  const hasError = instanceLogs.some((l) => l.type === "error");

  const drawerState = useMemo(
    () => ({
      isOpen,
      setOpen: setIsOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((prev) => !prev),
    }),
    [isOpen],
  );

  return (
    <Drawer state={drawerState}>
      <Button
        variant="tertiary"
        size="sm"
        fullWidth
        aria-label="Logs — Ctrl+L / F12"
        {...({ title: "Logs — Ctrl+L / F12" } as unknown as Record<string, unknown>)}
        className={cn(
          "justify-start rounded-none text-muted overflow-hidden relative",
          hasError && "text-red-500",
        )}
      >
        <IconTerminal2 className={cn("shrink-0", isRunning && "text-[var(--color-accent)]")} />
        <span className={cn("truncate break-words", instanceLogs.length === 0 && "opacity-50")}>
          {lastLog}
        </span>
        <span className="ml-auto hidden sm:inline-flex items-center gap-1 text-[10px] tracking-wide opacity-40">
          <span className="rounded border border-white/10 bg-white/5 px-1 py-0.5 leading-none">Ctrl</span>
          <span>+</span>
          <span className="rounded border border-white/10 bg-white/5 px-1 py-0.5 leading-none">L</span>
        </span>
      </Button>

      <Drawer.Backdrop variant="transparent">
        <Drawer.Content className="pl-18">
          <Drawer.Dialog className="pb-0 px-2 pt-3 bg-surface-secondary">
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <div className="flex items-center justify-between gap-2">
                <Drawer.Heading>{selectedInstance?.title ?? "Logs"}</Drawer.Heading>
                <span className="text-[10px] tracking-wide text-muted opacity-60">Ctrl+L / F12</span>
              </div>
            </Drawer.Header>
            <Drawer.Body>
              <div className="flex flex-col gap-2 pb-2">
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center gap-1.5 rounded border border-white/10 bg-black/40 px-2 py-1.5 min-w-0">
                    <IconSearch size={12} className="shrink-0 text-muted" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Filtrar mensajes..."
                      className="w-full min-w-0 bg-transparent text-xs text-foreground outline-none placeholder:text-muted"
                    />
                  </div>
                  <Button size="sm" variant="ghost" isIconOnly onPress={copyAll} className="size-7 shrink-0 rounded" aria-label="Copiar logs">
                    <IconCopy size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" isIconOnly onPress={clearLogs} className="size-7 shrink-0 rounded" aria-label="Limpiar logs">
                    <IconEraser size={12} />
                  </Button>
                </div>
                <div className="flex items-center gap-1">
                  {(["all", "log", "error"] as TypeFilter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setTypeFilter(f)}
                      className={cn(
                        "px-2 py-0.5 rounded text-[11px] uppercase tracking-wide transition-colors",
                        typeFilter === f
                          ? "bg-white/15 text-foreground"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div
                ref={listRef}
                onScroll={handleScroll}
                className="log-selectable relative w-full min-h-60 max-h-[60vh] overflow-auto flex flex-col rounded bg-black [&>*:nth-child(2n)]:bg-white/5"
              >
                {visibleLogs.length === 0 && (
                  <div className="p-3 font-mono text-xs text-white/75">
                    Waiting for instance to launch
                  </div>
                )}
                {visibleLogs.map((log, i) => (
                  <div
                    key={i}
                    className={cn(
                      "w-full px-3 first:pt-2 last:pb-2 whitespace-pre-wrap break-all log-token-break font-mono text-xs leading-relaxed",
                      log.type === "log" && "text-white",
                      log.type === "error" && "text-red-500",
                    )}
                  >
                    <span className="mr-2 select-none opacity-50">{formatTime(log.timestamp)}</span>
                    {log.message}
                  </div>
                ))}
                {!autoScroll && (
                  <button
                    onClick={scrollToBottom}
                    className="absolute bottom-2 right-2 flex items-center gap-1 rounded border border-white/15 bg-white/10 px-2 py-1 text-[11px] text-foreground backdrop-blur hover:bg-white/15"
                  >
                    <IconArrowDown size={11} />
                    Ir al final
                  </button>
                )}
              </div>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}