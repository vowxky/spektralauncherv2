import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  base: "./",
  build: {
    outDir: "./dist",
  },
  server: {
    watch: {
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },
  // secrets moved to Rust backend — nothing exposed in bundle
  define: {},
});