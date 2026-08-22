import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@heroui/react";
import { IconPlayerPlay, IconPlayerStop, IconX } from "@tabler/icons-react";
import { useLaunch } from "../stores/launchContext";
import { useInstance } from "../stores/instanceContext";

export function RunningInstances() {
  const { runningInstances } = useLaunch();
  const { instances } = useInstance();
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  const count = runningInstances.size;
  const hasRunning = count > 0;

  const resolveInstance = (id: string) => {
    const inst = instances.find((i) => i.id === id || i.slug === id);
    return inst ?? ({ id, title: id } as unknown as Instance);
  };

  const displayName = (instance: Instance) =>
    instance.title || instance.slug || instance.id;

  const runningDetails = [...runningInstances].map(resolveInstance);
  // Si no hay ninguna corriendo pero sí hay al menos una disponible, mostrar su nombre como hint
  const fallbackInstance = !hasRunning ? (instances[0] ?? null) : null;

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const handler = (e: MouseEvent) => {
        if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  const handleStop = async (instanceId: string) => {
    try {
      await invoke("stop_instance", { instanceId });
    } catch (e) {
      console.error("Error stopping instance:", e);
    }
  };

  return (
    <div className="relative flex items-center" ref={popupRef}>
      <Button
        variant="ghost"
        size="lg"
        onPress={hasRunning ? () => setOpen((v) => !v) : undefined}
        className="h-11 rounded-none ring-inset gap-1.5 px-3"
        aria-label={
          hasRunning
            ? `${count} instance${count !== 1 ? "s" : ""} running`
            : "Sin instancias activas"
        }
      >
        {hasRunning ? (
          <>
            <span className="size-1.5 rounded-full bg-success animate-pulse shrink-0" />
            <span className="max-w-[140px] truncate break-words text-xs">
              {count === 1 ? displayName(runningDetails[0]) : `${count} running`}
            </span>
          </>
        ) : fallbackInstance ? (
          <>
            <IconPlayerPlay size={13} className="opacity-50 shrink-0" />
            <span className="max-w-[140px] truncate break-words text-xs opacity-70">
              {displayName(fallbackInstance)}
            </span>
          </>
        ) : (
          <>
            <IconPlayerPlay size={13} className="opacity-35 shrink-0" />
            <span className="truncate text-xs opacity-35">Sin instancias activas</span>
          </>
        )}
      </Button>

      {open && hasRunning && (
        <div className="absolute right-0 top-full mt-1 z-50 max-w-xs min-w-[260px] w-max rounded-lg border border-white/10 bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="size-2 rounded-full bg-success animate-pulse" />
              Ejecutandose
            </div>
            <Button
              variant="ghost"
              isIconOnly
              onPress={() => setOpen(false)}
              className="size-5 rounded"
            >
              <IconX size={12} />
            </Button>
          </div>

          <div className="flex flex-col py-1">
            {runningDetails.map((inst) => (
              <div
                key={inst.id}
                className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-white/5"
              >
                {inst.icon && (
                  <img
                    src={inst.icon}
                    alt=""
                    className="size-6 rounded object-cover shrink-0"
                  />
                )}
                <span className="flex-1 truncate break-words text-sm text-left">
                  {displayName(inst)}
                </span>
                <Button
                  variant="ghost"
                  isIconOnly
                  onPress={() => handleStop(inst.id)}
                  className="size-6 rounded shrink-0 text-danger-soft-foreground hover:bg-danger-soft-hover"
                  aria-label={`Detener ${displayName(inst)}`}
                >
                  <IconPlayerStop size={12} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}