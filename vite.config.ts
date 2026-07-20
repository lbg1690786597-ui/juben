import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 期望固定端口，失败即报错而非自动切换
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Tauri 相关：清屏关闭以便看到 rust 报错
  clearScreen: false,
  server: {
    port: 5199,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? { protocol: "ws", host, port: 5200 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // 生产构建：Tauri 打包时用相对路径
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
  },
});