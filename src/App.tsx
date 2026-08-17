import { useEffect, useState } from "react";
import { Toast } from "@heroui/react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import Frame from "./components/Frame";
import { UpdateNotification } from "./components/UpdateNotification";

import Home from "./views/Home";
import Settings from "./views/Settings";
import Loading from "./views/Loading";
import Login from "./views/Login";

import { UpdateProvider, useUpdate } from "./stores/updateContext";
import { useNavigation } from "./hooks/useNavigation";
import { useAuth } from "./stores/authContext";

const ALLOWED_PATHS = new Set(["home", "settings"]);

function AppInner() {
  const currentPath = useNavigation((s) => s.currentPath);
  const push = useNavigation((s) => s.push);
  const { authReady, user } = useAuth();
  const [loadingDone, setLoadingDone] = useState(false);
  useUpdate();

  useEffect(() => {
    if (ALLOWED_PATHS.has(currentPath)) return;
    push("home");
  }, [currentPath, push]);

  useEffect(() => {
    getCurrentWindow().show().catch(console.error);
    emit("frontend-ready", {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  return (
    <div
      data-theme="dark"
      className="w-screen h-screen flex flex-col bg-background overflow-hidden rounded-xl"
    >
      <Toast.Provider placement="top" className="top-11" />
      {!loadingDone && <Loading onDone={() => setLoadingDone(true)} />}
      <UpdateNotification />
      <Frame />

      {authReady && user && (
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <Home />
          {currentPath === "settings" && <Settings />}
        </div>
      )}
      {authReady && !user && (
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <Login />
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <UpdateProvider>
      <AppInner />
    </UpdateProvider>
  );
}
