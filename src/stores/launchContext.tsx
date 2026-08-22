import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface DownloadProgress {
  instanceId: string;
  name: string;
  progress: number;
  status: string;
  indeterminate?: boolean;
}

// Key format: "${instanceId}:instance" | "${instanceId}:minecraft" | "${instanceId}:java"
export type ProgressMap = Map<string, DownloadProgress>;

interface LaunchContextValue {
  progressMap: ProgressMap;
  runningInstances: Set<string>;
  pendingInstances: Map<string, string>;
  addRunning: (id: string) => void;
  removeRunning: (id: string) => void;
  addPending: (id: string, name: string) => void;
  removePending: (id: string) => void;
}

const LaunchContext = createContext<LaunchContextValue>({
  progressMap: new Map(),
  runningInstances: new Set(),
  pendingInstances: new Map(),
  addRunning: () => {},
  removeRunning: () => {},
  addPending: () => {},
  removePending: () => {},
});

export function LaunchProvider({ children }: { children: ReactNode }) {
  const [progressMap, setProgressMap] = useState<ProgressMap>(new Map());
  const [runningInstances, setRunningInstances] = useState<Set<string>>(new Set());
  const [pendingInstances, setPendingInstances] = useState<Map<string, string>>(new Map());
  const cleanupTimers = useRef<Map<string, number>>(new Map());

  const update = useCallback(
    (key: string, patch: Partial<DownloadProgress> | null) => {
      setProgressMap((prev) => {
        const next = new Map(prev);
        if (patch === null) {
          next.delete(key);
          const timer = cleanupTimers.current.get(key);
          if (timer) {
            window.clearTimeout(timer);
            cleanupTimers.current.delete(key);
          }
        } else {
          const value = {
            ...(next.get(key) ?? { instanceId: "", name: "", progress: 0, status: "" }),
            ...patch,
          };
          next.set(key, value);
          if (value.progress >= 100 && !cleanupTimers.current.has(key)) {
            const timer = window.setTimeout(() => {
              cleanupTimers.current.delete(key);
              update(key, null);
            }, 1800);
            cleanupTimers.current.set(key, timer);
          }
        }
        return next;
      });
    },
    []
  );

  const addRunning = useCallback((id: string) => {
    setRunningInstances((prev) => new Set([...prev, id]));
  }, []);

  const removeRunning = useCallback((id: string) => {
    setRunningInstances((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const addPending = useCallback((id: string, name: string) => {
    setPendingInstances((prev) => new Map([...prev, [id, name]]));
  }, []);

  const removePending = useCallback((id: string) => {
    setPendingInstances((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Hidratar + polling contra el backend como fuente de verdad
  // Fix "Sin instancias activas" aunque MC siga abierto (el Set en memoria se pierde al reiniciar)
  useEffect(() => {
    const sync = () => {
      invoke<string[]>("get_running_instances")
        .then((ids) => {
          if (!Array.isArray(ids)) return;
          setRunningInstances((prev) => {
            const next = new Set(ids);
            // evitar rerender si es idéntico
            if (prev.size !== next.size) return next;
            for (const id of next) if (!prev.has(id)) return next;
            return prev;
          });
        })
        .catch(() => {});
    };
    sync();
    const iv = window.setInterval(sync, 2000);
    const onFocus = () => sync();
    window.addEventListener("focus", onFocus);
    window.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  useEffect(() => {
    const unlisteners = [
      listen<{ instanceId: string; current: number; total: number }>(
        "instance-progress",
        ({ payload: { instanceId, current, total } }) => {
          const progress = total > 0 ? Math.floor((current / total) * 100) : 0;
          update(`${instanceId}:instance`, {
            instanceId,
            name: instanceId,
            progress,
            status: "Downloading mods...",
          });
        }
      ),

      listen<{ instanceId: string; status: string }>(
        "instance-status",
        ({ payload: { instanceId, status } }) => {
          update(`${instanceId}:instance`, { instanceId, name: instanceId, status });
        }
      ),

      listen<string>("instance-done", ({ payload: instanceId }) => {
        const key = `${instanceId}:instance`;
        update(key, { progress: 100, status: "Done" });
        setTimeout(() => update(key, null), 1500);
      }),

      listen<{ instanceId: string; current: number; total: number }>(
        "minecraft-progress",
        ({ payload: { instanceId, current, total } }) => {
          const progress = total > 0 ? Math.floor((current / total) * 100) : 0;
          update(`${instanceId}:minecraft`, {
            instanceId,
            name: instanceId,
            progress,
            status: "Downloading...",
          });
        }
      ),

      listen<{ instanceId: string; status: string; indeterminate?: boolean }>(
        "minecraft-status",
        ({ payload: { instanceId, status, indeterminate } }) => {
          update(`${instanceId}:minecraft`, { instanceId, name: instanceId, status, indeterminate: indeterminate ?? false });
        }
      ),

      listen<string>("minecraft-done", ({ payload: instanceId }) => {
        const key = `${instanceId}:minecraft`;
        update(key, { progress: 100, status: "Done" });
        setTimeout(() => update(key, null), 1500);
      }),

      listen<{ instanceId: string; percent: number; status: string }>(
        "java-download-progress",
        ({ payload: { instanceId, percent, status } }) => {
          update(`${instanceId}:java`, { progress: percent, status });
        }
      ),

      listen<{ instanceId: string }>(
        "java-download-done",
        ({ payload: { instanceId } }) => {
          const key = `${instanceId}:java`;
          setProgressMap((prev) => {
            if (!prev.has(key)) return prev;
            const next = new Map(prev);
            next.set(key, { ...next.get(key)!, progress: 100, status: "Installed" });
            setTimeout(() => update(key, null), 1500);
            return next;
          });
        }
      ),

      listen<string>("minecraft-closed", ({ payload: instanceId }) => {
        removeRunning(instanceId);
      }),
    ];

    return () => {
      unlisteners.forEach((p) => p.then((f) => f()));
    };
  }, [update, removeRunning]);

  return (
    <LaunchContext.Provider value={{ progressMap, runningInstances, pendingInstances, addRunning, removeRunning, addPending, removePending }}>
      {children}
    </LaunchContext.Provider>
  );
}

export function useLaunch() {
  return useContext(LaunchContext);
}
