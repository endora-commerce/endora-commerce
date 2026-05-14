import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // Vite auto-loads `.env` files but only exposes `VITE_*` to the bundle.
  // `loadEnv(mode, cwd, '')` (empty prefix) lets the config itself read
  // unprefixed vars like `PORT` without leaking them to the browser.
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.PORT) || 3002;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port,
      strictPort: true,
    },
    preview: {
      port,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
