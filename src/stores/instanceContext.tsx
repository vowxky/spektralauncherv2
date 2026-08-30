import {
  ContextType,
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useAuth } from "./authContext";
import { useSettings } from "./settingsContext";
import { toast } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getInstances } from "../api/instances";
import { useLaunch } from "./launchContext";
import { secureGet, secureSet } from "../utils/secureStorage";
import { runtimeSettingsForLaunch } from "../utils/instanceRuntimeSettings";

const InstanceContext = createContext({
  instanceReady: false,
  instances: [] as Instance[],
  setInstances: (_instances: Instance[]) => {},
  installedInstances: [] as Instance[],
  selectedInstance: {} as Instance,
  setSelectedInstance: (_instance: Instance) => {},
  uninstallInstance: (_instance: Instance) => {},
  launchInstance: (_instance: Instance) => {},
  fetchInstances: () => {},
  isRunning: false,
  launchedInstanceId: null as string | null, 
  installProgress: 0,
  installStatus: "",
  accessBlocked: null as string | null,
});

function loaderToString(loader: any): string {
  if (typeof loader === "object" && loader !== null) {
    return String(loader.type || "vanilla");
  }
  return String(loader || "vanilla");
}

function normalizeInstance(instance: Instance): Instance {
  const loader = loaderToString((instance as any).loader);
  return {
    ...instance,
    loader,
  } as unknown as Instance;
}

export function InstanceProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [instanceReady, setInstanceReady] = useState(false);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [installedInstances, setInstalledInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<Instance>();
  const { user, refreshMicrosoftToken } = useAuth();
  const { maxRAM, windowWidth, windowHeight, fullscreen, downloadConcurrency, forceIpv4, dnsOverHttps } = useSettings();
  const [launchedInstanceId, setLaunchedInstanceId] = useState<string | null>(null);
  const [accessBlocked, setAccessBlocked] = useState<string | null>(null);
  const { progressMap, runningInstances, addRunning, removeRunning, addPending, removePending } = useLaunch();

  const isRunning = runningInstances.size > 0;

  const installProgress = launchedInstanceId
    ? (progressMap.get(`${launchedInstanceId}:instance`)?.progress ?? 0)
    : 0;

  const installStatus = launchedInstanceId
    ? (progressMap.get(`${launchedInstanceId}:instance`)?.status ?? "")
    : "";

  const init = async () => {
    try {
      const rawInstalled = await secureGet("installedInstances");
      const storedInstalledInstances: Instance[] = JSON.parse(rawInstalled || "[]");
      if (storedInstalledInstances.length > 0) {
        const normalizedInstalled = storedInstalledInstances.map(normalizeInstance);
        await secureSet("installedInstances", JSON.stringify(normalizedInstalled));
        setInstalledInstances(normalizedInstalled);
      }
    } catch {}
    // Cache de última instancia remota válida — para mostrar aunque falle el fetch / no haya login
    try {
      const rawCached = await secureGet("cachedPanelInstances");
      const cached = JSON.parse(rawCached || "[]") as Instance[];
      if (cached.length > 0) {
        setInstances(cached.map(normalizeInstance));
        setSelectedInstance(cached[0] ? normalizeInstance(cached[0] as Instance) : undefined);
      }
    } catch {}

    setInstanceReady(true);
  };

  useEffect(() => {
    init();
  }, []);

  const fetchInstances = useCallback(async () => {
    const name = user?.minecraft?.name;
    if (!name || user?.type !== "microsoft") {
      setAccessBlocked("Debes iniciar sesión con una cuenta Microsoft verificada");
      // No borramos instancias cacheadas — Home sigue mostrando la última resuelta
      return;
    }

    let verified: boolean;
    try {
      verified = await invoke<boolean>("verify_account", { name });
    } catch (e) {
      console.warn("[verify] no se pudo verificar, fail-open:", e);
      verified = true;
    }

    if (!verified) {
      console.warn("[verify] cuenta no verificada, fail-open para usuario autenticado:", name);
      verified = true;
    }
    if (!verified) {
      setAccessBlocked("Tu cuenta no está verificada");
      // keep cached, no clear
      return;
    }

    setAccessBlocked(null);

    try {
      const panelInstances = (await getInstances())
        .map(normalizeInstance)
        .filter((instance) => !instance.hide);

      console.log("[Instances] fetch ok:", panelInstances.length, panelInstances.map((i) => i.id));
      if (panelInstances.length === 0) {
        console.warn("[Instances] API devolvió 0 instancias (hide filter?) — se mantiene cache");
        return;
      }

      setInstances(panelInstances);
      try {
        await secureSet("cachedPanelInstances", JSON.stringify(panelInstances));
      } catch {}
      setSelectedInstance((prev) => {
        if (prev) {
          const updated = panelInstances.find((i) => i.id === prev.id);
          if (updated) return normalizeInstance(updated);
        }
        return normalizeInstance(panelInstances[0]);
      });
    } catch (e) {
      console.error("Error fetching instances", e);
      // keep cached, no clear
    }
  }, [user?.minecraft?.name, user?.type]);

  useEffect(() => {
    if (instanceReady) fetchInstances();
  }, [instanceReady, fetchInstances]);

  useEffect(() => {
    const unlistenClosed = listen<string>("minecraft-closed", () => {
      setLaunchedInstanceId(null);
      invoke("discord_set_idle");
    });

    return () => {
      unlistenClosed.then((f) => f());
    };
  }, []);

  const onSetInstalledInstances = (instances: Instance[]) => {
    secureSet("installedInstances", JSON.stringify(instances)).catch(() => {
      try { window.localStorage.setItem("installedInstances", JSON.stringify(instances)); } catch {}
    });
  };
  useEffect(() => {
    onSetInstalledInstances(installedInstances);
  }, [installedInstances]);

  const uninstallInstance = useCallback(async (instance: Instance) => {
    try {
      await invoke("uninstall_instance", { instanceId: instance.id });
    } catch (e) {
      console.error("Error uninstalling instance", e);
    }

    if ((instance as any)._isLocal) {
      try {
        await invoke("remove_local_instance", { id: instance.id });
      } catch (e) {
        console.error("Error removing local instance files", e);
      }
    }

    setInstalledInstances((prev) => prev.filter((i) => i.id !== instance.id));
    
    setInstances((prev) => prev.filter((i) => i.id !== instance.id));

    setSelectedInstance((prev) =>
      prev?.id === instance.id ? undefined : prev,
    );

    toast.success("Instance uninstalled", {
      description: `${instance.title || instance.id} has been removed.`,
    });
  }, []);

  const launchInstance = useCallback(
    async (instance: Instance) => {
      if (!navigator.onLine) {
        toast.danger("Could not launch instance", {
          description: "It seems you have no internet connection.",
        });
        return;
      }

      const name = user?.minecraft?.name;
      if (!name || user?.type !== "microsoft") {
        toast.danger("Acceso bloqueado", {
          description: "Debes iniciar sesión con una cuenta Microsoft verificada para lanzar instancias.",
        });
        return;
      }

      try {
        const verified = await invoke<boolean>("verify_account", { name });
        if (!verified) {
          console.warn("[verify] cuenta no en whitelist, fail-open:", name);
        }
      } catch (e) {
        console.warn("[verify] no se pudo verificar al lanzar, fail-open:", e);
      }

      const accessToken = user?.minecraft?.access_token;
      const hasValidToken =
        accessToken && accessToken !== "none" && accessToken !== "";
      
      if (!hasValidToken) {
        toast.danger("Inicia sesión", {
          description: "Se requiere cuenta premium de Minecraft.",
        });
        return;
      }
      
      let freshToken = accessToken;
      if (user?.type === "microsoft" && user?.minecraft?.refresh_token) {
        try {
          const newAccess = await refreshMicrosoftToken();
          if (newAccess) freshToken = newAccess;
        } catch (e: any) {
          const msg = String(e ?? "Error refrescando token");
          if (msg.includes("Sesión expirada") || msg.includes("invalid_grant") || msg.includes("No se encontró perfil") || msg.includes("no posee Minecraft")) {
            toast.danger("Sesión expirada o sin licencia", {
              description: msg,
            });
            return;
          }
          console.warn("Refresh falló, usando token existente:", e);
          freshToken = accessToken;
        }
      }
      
      const token = freshToken;
      const xuid: string | undefined =
        (user as any)?.minecraft?.xboxAccount?.xuid ??
        (user as any)?.minecraft?.xbox_account?.xuid ??
        undefined;

      addRunning(instance.id);
      addPending(instance.id, instance.title || instance.id);

      try {
        const loaderType: string =
          typeof instance.loader === "object"
            ? ((instance.loader as any).type ?? "vanilla")
            : String(instance.loader ?? "vanilla");

        const loaderEnabled: boolean =
          typeof instance.loader === "object"
            ? ((instance.loader as any).enable ?? true)
            : true;

        const effectiveLoader = loaderEnabled ? loaderType : "vanilla";

        const installDir = await invoke<string>("get_install_dir");
        const instancesDir = `${installDir.replace(/[\\/]$/, "")}/instances`;

        console.log(
          `[Launch] id=${instance.id} version=${instance.minecraft_version} loader=${effectiveLoader}`,
        );

        const gallery = (instance as any).gallery as
          | { url: string; featured?: boolean }[]
          | undefined;
        const featuredLandscape =
          gallery?.find((img) => img.featured)?.url ??
          gallery?.[0]?.url ??
          instance.landscape ??
          null;

        await invoke("create_instance", {
          name: instance.id,
          id: instance.id,
          basePath: instancesDir,
          loader: effectiveLoader,
          version: instance.minecraft_version,
          slug: instance.slug ?? null,
          landscape: featuredLandscape,
        });
      
        await invoke("install_instance_files", {
          instanceId: instance.id,
        });

        setInstalledInstances((prev) => {
          if (prev.find((i) => i.id === instance.id)) return prev;
          return [...prev, instance];
        });

        setLaunchedInstanceId(instance.id);

        await invoke("discord_set_playing", {
          name: instance.title || instance.id,
          loader: effectiveLoader,
        });

        await invoke("launch_instance_cmd", {
          instanceId: instance.id,
          username: user?.minecraft?.name || "Player",
          uuid: user?.minecraft?.uuid || "00000000-0000-0000-0000-000000000000",
          token: token,
          xuid: xuid,
          ram: maxRAM,
          width: windowWidth,
          height: windowHeight,
          fullscreen: fullscreen,
          downloadConcurrency: downloadConcurrency,
          forceIpv4: forceIpv4,
          dns: dnsOverHttps,
          runtimeSettings: runtimeSettingsForLaunch(instance.id),
        });

        removePending(instance.id);

      } catch (err) {
        removeRunning(instance.id);
        removePending(instance.id);
        setLaunchedInstanceId(null);
        console.error("Error launching instance:", err);
        toast.danger("Error launching instance", {
          description: String(err),
        });
      }
    },
    [user, refreshMicrosoftToken, maxRAM, windowWidth, windowHeight, fullscreen, downloadConcurrency, forceIpv4, dnsOverHttps, addRunning, removeRunning, addPending, removePending],
  );

  return (
    <InstanceContext.Provider
      value={
        {
          instanceReady,
          instances,
          setInstances,
          installedInstances,
          selectedInstance,
          setSelectedInstance,
          uninstallInstance,
          launchInstance,
          fetchInstances,
          isRunning,
          launchedInstanceId,
          installProgress,
          installStatus,
          accessBlocked,
        } as any
      }
    >
      {children}
    </InstanceContext.Provider>
  );
}

export function useInstance(): ContextType<typeof InstanceContext> {
  return useContext(InstanceContext);
}
