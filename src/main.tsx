import "./globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Fix: View transition API lanza InvalidStateError si document.visibilityState === 'hidden'
// (ocurre al minimizar/cambiar pestaña en webview). Parcheamos startViewTransition
// y silenciamos la promise rejection para evitar spam en consola.
if (typeof document !== 'undefined' && 'startViewTransition' in document) {
  const orig = (document as any).startViewTransition.bind(document)
  ;(document as any).startViewTransition = (callback: () => void | Promise<void>) => {
    if (document.visibilityState === 'hidden') {
      try { const r = callback?.(); if (r instanceof Promise) r.catch(() => {}) } catch {}
      // objeto falso compatible con ViewTransition
      return {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: () => {},
      } as unknown as ViewTransition
    }
    try {
      const vt = orig(callback)
      // silencia InvalidStateError por hidden que igual puede colarse
      vt.ready.catch(() => {})
      vt.finished.catch(() => {})
      return vt
    } catch {
      try { callback?.() } catch {}
      return {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        skipTransition: () => {},
      } as unknown as ViewTransition
    }
  }
}
window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  const msg = String((e.reason as any)?.message ?? e.reason ?? '')
  if (msg.includes('View transition') || msg.includes('visibility state is hidden')) {
    e.preventDefault()
  }
})

import { NavigationProvider } from "./hooks/useNavigation";
import { SettingsProvider } from "./stores/settingsContext";
import { AuthProvider } from "./stores/authContext";
import { InstanceProvider } from "./stores/instanceContext";
import { LaunchProvider } from "./stores/launchContext";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <SettingsProvider>
      <AuthProvider>
        <LaunchProvider>
          <InstanceProvider>
            <NavigationProvider initialPath="home">
              <App />
            </NavigationProvider>
          </InstanceProvider>
        </LaunchProvider>
      </AuthProvider>
    </SettingsProvider>
  </StrictMode>,
);
