import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs separately (pnpm --filter @af/api dev) and Vite forwards /api to it.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: process.env.API_URL ?? 'http://127.0.0.1:3000', changeOrigin: true, ws: true } } },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 900 },
});
