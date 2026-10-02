import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // 此环境下文件监听事件不可靠，启用轮询保证 HMR 生效
    watch: { usePolling: true, interval: 300 },
  },
  build: { target: "es2022" },
});
