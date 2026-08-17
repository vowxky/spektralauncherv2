import "./globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

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
