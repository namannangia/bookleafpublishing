import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in dev too, so the session cookie and EventSource just work.
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: false } },
  },
});
