/**
 * Compile `admin/src/index.css` through the app's own Vite config and print it.
 *
 * A child process rather than an in-process call, for a reason worth stating:
 * the admin suite runs under jsdom, whose `TextEncoder` does not produce a real
 * `Uint8Array`, and esbuild — which Vite loads to read `vite.config.ts` —
 * refuses to start on that. Opting the one test file out of jsdom is not
 * available either, since `test/setup.ts` touches `Element` at import time. So
 * the compile happens where the real build happens: a clean Node process whose
 * cwd is this workspace member, which is also what makes Tailwind v4's
 * automatic source root (`config.root`) identical to the real build's.
 *
 * Only the stylesheet is built — no JS entry — so it costs well under a second
 * against the twenty a full `vite build` takes, while running the same
 * `@tailwindcss/vite` plugin over the same `@source` directives.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const result = await build({
  root: adminRoot,
  configFile: path.join(adminRoot, 'vite.config.ts'),
  logLevel: 'error',
  build: {
    write: false,
    sourcemap: false,
    cssMinify: false,
    rollupOptions: { input: path.join(adminRoot, 'src/index.css') },
  },
});

const outputs = Array.isArray(result) ? result[0].output : (result.output ?? []);
const stylesheets = outputs
  .filter((asset) => asset.fileName.endsWith('.css'))
  .map((asset) => String(asset.source ?? ''));

if (stylesheets.length === 0) {
  console.error(
    'the admin CSS-only build emitted no stylesheet — a guard reading this would then ' +
      'assert that nothing was scanned, which every broken configuration satisfies',
  );
  process.exit(2);
}

process.stdout.write(stylesheets.join('\n'));
