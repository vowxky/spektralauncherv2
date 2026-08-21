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
    const storedInstalledInstances: Instance[] = JSON.parse(
      window.localStorage.getItem("installedInstances") || "[]",
    );
    if (storedInstalledInstances) {
      const normalizedInstalled = storedInstalledInstances.map(normalizeInstance);
      window.localStorage.setItem("installedInstances", JSON.stringify(normalizedInstalled));
      setInstalledInstances(normalizedInstalled);
    }

    setInstanceReady(true);
  };

  useEffect(() => {
    init();
  }, []);

  const fetchInstances = useCallback(async () => {
    const name = user?.minecraft?.name;
    if (!name || user?.type !== "microsoft") {
      setAccessBlocked("Debes iniciar sesión con una cuenta Microsoft verificada");
      setInstances([]);
      setSelectedInstance(undefined);
      toast.danger("Acceso bloqueado", {
        description: "Debes iniciar sesión con una cuenta Microsoft verificada para acceder a las instancias.",
      });
      return;
    }

    let verified: boolean;
    try {
      verified = await invoke<boolean>("verify_account", { name });
    } catch (e) {
      console.error("Error verifying account", e);
      setAccessBlocked("No se pudo verificar tu cuenta");
      setInstances([]);
      setSelectedInstance(undefined);
      toast.danger("No se pudo verificar tu cuenta", {
        description: String(e),
      });
      return;
    }

    if (!verified) {
      setAccessBlocked("Tu cuenta no está verificada");
      setInstances([]);
      setSelectedInstance(undefined);
      toast.danger("Acceso bloqueado", {
        description: "Tu cuenta no está verificada.",
      });
      return;
    }

    setAccessBlocked(null);

    try {
      const panelInstances = (await getInstances())
        .map(normalizeInstance)
        .filter((instance) => !instance.hide);

      setInstances(panelInstances);

      setSelectedInstance((prev) => {
        if (prev) {
          const updated = panelInstances.find((i) => i.id === prev.id);
          if (updated) return normalizeInstance(updated);
        }
        return panelInstances.length > 0 ? normalizeInstance(panelInstances[0]) : undefined;
      });
    } catch (e) {
      console.error("Error fetching instances", e);
      setInstances([]);
      setSelectedInstance(undefined);
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
    window.localStorage.setItem(
      "installedInstances",
      JSON.stringify(instances),
    );
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
          toast.danger("Acceso bloqueado", {
            description: "Tu cuenta no está verificada. No puedes lanzar instancias.",
          });
          return;
        }
      } catch (e) {
        toast.danger("No se pudo verificar tu cuenta", {
          description: String(e),
        });
        return;
      }

      const isLocal = !!(instance as any)._isLocal;
      const noPremiumAllowed = isLocal || instance.users?.noPremium === true;

      const accessToken = user?.minecraft?.access_token;
      const hasValidToken =
        accessToken && accessToken !== "none" && accessToken !== "";
      
      if (!noPremiumAllowed && !hasValidToken) {
        toast.danger("Sign in with Mojang", {
          description: "This instance requires a premium Minecraft account.",
        });
        return;
      }
      
      const isOffline = !hasValidToken;
      
      let freshToken = accessToken ?? "none";
      if (!isOffline && user?.type === "microsoft" && user?.minecraft?.refresh_token) {
        try {
          const newAccess = await refreshMicrosoftToken();
          if (newAccess) freshToken = newAccess;
        } catch (e: any) {
          // Si el refresh falla por invalid_grant / sin entitlements, avisamos y bloqueamos launch
          const msg = String(e ?? "Error refrescando token");
          if (msg.includes("Sesión expirada") || msg.includes("invalid_grant") || msg.includes("No se encontró perfil") || msg.includes("no posee Minecraft")) {
            toast.danger("Sesión expirada o sin licencia", {
              description: msg,
            });
            return;
          }
          // Fallback: usar token viejo (puede seguir válido unos minutos)
          console.warn("Refresh falló, usando token existente:", e);
          freshToken = accessToken ?? "none";
        }
      }
      
      const token = isOffline ? "none" : freshToken;

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
          `[Launch] id=${instance.id} version=${instance.minecraft_version} loader=${effectiveLoader} offline=${isOffline} noPremium=${noPremiumAllowed}`,
        );

        const gallery = (instance as any).gallery as
          | { url: string; featured?: boolean }[]
          | undefined;
        const featuredLandscape =
          gallery?.find((img) => img.featured)?.url ??
          gallery?.[0]?.url ??
          instance.landscape ??
          null;

        if (isLocal) {
          await invoke("create_instance", {
            name: instance.id,
            id: instance.id,
            basePath: instancesDir,
            loader: effectiveLoader,
            version: instance.minecraft_version,
            slug: instance.slug ?? null,
            landscape: featuredLandscape,
          });
        } else {
          await invoke("create_instance", {
            name: instance.id,
            id: instance.id,
            basePath: instancesDir,
            loader: effectiveLoader,
            version: instance.minecraft_version,
            slug: instance.slug ?? null,
            landscape: featuredLandscape,
          });
        
          setInstalledInstances((prev) => {
            if (prev.find((i) => i.id === instance.id)) return prev;
            return [...prev, instance];
          });
        
          try {
            await invoke("install_instance_files", {
              instanceId: instance.id,
            });
          } catch (installErr) {
            console.warn("[Install] Error downloading files, continuing anyway:", installErr);
          }
        }

        setLaunchedInstanceId(instance.id);

        await invoke("discord_set_playing", {
          name: instance.title || instance.id,
        });

        await invoke("launch_instance_cmd", {
          instanceId: instance.id,
          username: user?.minecraft?.name || "Player",
          uuid: user?.minecraft?.uuid || "00000000-0000-0000-0000-000000000000",
          token: token,
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
