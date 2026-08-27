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
      /**
       * No source maps in the built bundle, and the reason is disclosure
       * before it is memory.
       *
       * `admin/dist` is served as static files by nginx (`admin/Dockerfile`),
       * so a `.map` beside a chunk is the original TypeScript — every module's
       * admin surface, its route guards, its permission codes and its
       * comments — readable by anyone who can reach the app. The storefront
       * already ships none: Next's `productionBrowserSourceMaps` defaults to
       * `false` and this repository never sets it, so admin was the one
       * surface exporting its own source.
       *
       * The second reason is why it surfaced now. Measured on one machine,
       * whole process group: **2819 MB** peak with maps, **1642 MB** without.
       * `build:admin` was being killed by the host's OOM killer even after
       * `resource_group: image-builds` gave it the machine to itself, and a
       * heap cap would have traded `Killed` for `JavaScript heap out of
       * memory` — the peak is the process group's, not V8's alone.
       *
       * A stack trace from production is now minified. That is the accepted
       * cost: admin is an internal tool, the maps were already answering
       * "Can't resolve original location of error" in the build log, and a
       * reproduction runs `pnpm --filter admin run dev`, which has them.
       */
      sourcemap: false,
    },
  };
});
