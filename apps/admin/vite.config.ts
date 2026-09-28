import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The back office, an app of its own. In development its server runs with the API (pnpm --filter @af/api dev starts
// both: the app on 3000, the back office on 3001) and Vite forwards /api to it. The display font is the app's.
export default defineConfig({
  plugins: [react()],
  publicDir: '../web/public',
  server: { port: 5174, proxy: { '/api': { target: process.env.ADMIN_API_URL ?? 'http://127.0.0.1:3001', changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: true },
});
