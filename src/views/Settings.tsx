import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { Button, Label, Slider, Switch } from "@heroui/react";
import {
  IconFolder,
  IconX,
} from "@tabler/icons-react";
import { useSettings } from "../stores/settingsContext";
import { useNavigation } from "../hooks/useNavigation";

// NOTE: mirrors globals.css design tokens (--background, --surface, --border, --foreground, --muted).
const C = {
  bg: "#0a0a0c",
  surface: "#111113",
  surfaceSec: "#15151a",
  surfaceTer: "#1a1a20",
  border: "rgba(255,255,255,0.06)",
  borderSub: "rgba(255,255,255,0.10)",
  fg: "#eeeef0",
  fgMuted: "#7a7a8a",
} as const;

function SwitchThumb() {
  return <Switch.Thumb className="size-5 group-data-[selected=true]:ml-6.5 bg-white!" />;
}

function SwitchRow({
  name,
  label,
  desc,
  value,
  onChange,
}: {
  name: string;
  label: string;
  desc: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderBottom: `1px solid ${C.border}` }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.fg, marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 11, color: C.fgMuted }}>{desc}</div>
      </div>
      <Switch name={name} size="lg" isSelected={value} onChange={onChange} className="group">
        <Switch.Control className="group-data-[selected=true]:bg-white/20! group-data-[selected=true]:border-white/15!">
          <SwitchThumb />
        </Switch.Control>
      </Switch>
    </div>
  );
}

export default function Settings() {
  const {
    hideLauncher, setHideLauncher,
    minRAM, setMinRAM,
    maxRAM, setMaxRAM,
  } = useSettings();
  const push = useNavigation((state) => state.push);

  const [version, setVersion] = useState("");
  const [systemRAM, setSystemRAM] = useState<number>(8192);
  const [installDir, setInstallDir] = useState("");
  const [jvmArgs, setJvmArgs] = useState("");

  useEffect(() => {
    getVersion().then(setVersion);
    invoke<string>("get_install_dir").then(setInstallDir).catch(() => setInstallDir(""));
    invoke<number>("get_system_ram").then((memory) => {
      if (memory) setSystemRAM(memory / 1024 / 1024);
    });
    invoke<any>("get_config")
      .then((config) => setJvmArgs(config?.app?.["extra-jvm-args"] || ""))
      .catch(() => {});
  }, []);

  const pickInstallDir = async () => {
    try {
      const path = await invoke<string>("pick_install_dir");
      setInstallDir(path);
    } catch (err) {
      if (!String(err).toLowerCase().includes("cancel")) {
        console.error("Error selecting install dir:", err);
      }
    }
  };

  const resetInstallDir = async () => {
    try {
      const path = await invoke<string>("reset_install_dir");
      setInstallDir(path);
    } catch (err) {
      console.error("Error resetting install dir:", err);
    }
  };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 30, overflow: "hidden", background: "rgba(0,0,0,0.24)", backdropFilter: "blur(2px)" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 560, maxHeight: "80vh", background: C.surface, border: `1px solid ${C.borderSub}`, borderRadius: 14, boxShadow: "0 32px 72px rgba(0,0,0,0.95)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.fg }}>Ajustes</div>
              <div style={{ marginTop: 3, fontSize: 11, color: C.fgMuted }}>Configuracion esencial del launcher.</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {version && <span style={{ fontSize: 11, color: C.fgMuted }}>v{version}</span>}
              <button
                onClick={() => push("home")}
                style={{ background: C.surfaceSec, border: `1px solid ${C.borderSub}`, borderRadius: 6, width: 28, height: 28, cursor: "pointer", color: C.fgMuted, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" }}
                onMouseEnter={(event) => (event.currentTarget.style.background = C.surfaceTer)}
                onMouseLeave={(event) => (event.currentTarget.style.background = C.surfaceSec)}
              >
                <IconX size={14} />
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 20px", background: C.surface }}>
            <div style={{ padding: "0 2px" }}>
              <SwitchRow name="hide_launcher" label="Ocultar launcher" desc="Oculta el launcher mientras el juego esta abierto." value={hideLauncher} onChange={(value) => { setHideLauncher(value); invoke("set_config", { key: "app.hide-on-launch", value }); }} />

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "13px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: C.fg, marginBottom: 4 }}>
                    <IconFolder size={15} />
                    Ruta de instalacion
                  </div>
                  <div style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: C.fgMuted }} title={installDir}>
                    {installDir || "Cargando..."}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <Button variant="secondary" size="sm" onPress={pickInstallDir}>Cambiar</Button>
                  <Button variant="ghost" size="sm" onPress={resetInstallDir}>Default</Button>
                </div>
              </div>

              <div style={{ padding: "15px 0 17px" }}>
                <Slider
                  formatOptions={{ style: "unit", unit: "megabyte" }}
                  minValue={512}
                  maxValue={systemRAM}
                  step={64}
                  value={[minRAM, maxRAM]}
                  onChange={(value) => {
                    const [min, max] = typeof value === "number" ? [value, value] : value;
                    setMinRAM(min);
                    setMaxRAM(max);
                    invoke("set_config", { key: "game.minRAM", value: `${min}M` });
                    invoke("set_config", { key: "game.maxRAM", value: `${max}M` });
                  }}
                  className="flex-col [&_[data-slot=fill]]:bg-white/70! [&_[data-slot=track]]:bg-white/8! [&_[data-slot=thumb]]:bg-white/90! [&_[data-slot=thumb]]:border-white/20!"
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div>
                      <Label style={{ fontSize: 13, fontWeight: 600, color: C.fg }}>Memoria RAM</Label>
                      <div style={{ marginTop: 3, fontSize: 11, color: C.fgMuted }}>Define cuanta memoria puede usar Minecraft.</div>
                    </div>
                    <Slider.Output style={{ fontSize: 11, color: C.fgMuted }} />
                  </div>
                  <Slider.Track>
                    {({ state }) => (
                      <>
                        <Slider.Fill />
                        {state.values.map((_, index) => <Slider.Thumb key={index} index={index} />)}
                      </>
                    )}
                  </Slider.Track>
                </Slider>
              </div>

              <div style={{ padding: "15px 0 17px", borderBottom: `1px solid ${C.border}` }}>
                <Label style={{ fontSize: 13, fontWeight: 600, color: C.fg }}>Argumentos JVM</Label>
                <div style={{ marginTop: 3, marginBottom: 10, fontSize: 11, color: C.fgMuted }}>
                  Flags adicionales para el comando de ejecucion de Minecraft (separados por espacios).
                </div>
                <input
                  value={jvmArgs}
                  onChange={(event) => {
                    setJvmArgs(event.target.value);
                    invoke("set_config", { key: "app.extra-jvm-args", value: event.target.value });
                  }}
                  placeholder="-Dfml.ignoreInvalidMinecraftCertificates=true --illegal-access=deny"
                  spellCheck={false}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 9,
                    background: C.surfaceTer,
                    border: `1px solid ${C.borderSub}`,
                    color: C.fg,
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
