import { defineConfig } from "vite";

export default defineConfig({
  server: {
    allowedHosts: [
      ".trycloudflare.com"
    ],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        secure: false
      },
      "/health": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        secure: false
      }
    }
  }
});
