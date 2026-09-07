/**
 * Build a **fixture instance** — a whole Vite application of its own — and print
 * the stylesheet it emits (feature 110, T126;
 * `specs/110-instance-repository/contracts/admin-stylesheet-composition.md` R3).
 *
 * ## Why an application and not a stylesheet
 *
 * Its sibling `compile-stylesheet.mjs` compiles `admin/src/index.css` alone,
 * which is enough to ask *"did this `@source` reach that package"*. It is not
 * enough here. R2.3's instance carries **no** `@source` for its own sources: it
 * relies on Tailwind v4's automatic detection, and automatic detection needs the
 * application it is rooted at. Measured — the same fixture built from its CSS
 * alone emits the shell's tokens and **not** `.bg-primary`, because nothing in
 * that build ever read a `.tsx`. A guard asserting the override over a
 * stylesheet with no utility in it would be asserting half the claim.
 *
 * So the entry is `index.html`, the plugins are the two `admin/vite.config.ts`
 * declares, and the root is the fixture's own directory — which is what makes
 * the fixture an instance rather than a corner of this one: `config.root` is
 * Tailwind's automatic-detection base, and the shell is reached by **name**
 * through `admin/node_modules`, exactly as a client reaches it through theirs.
 *
 * A child process for `compile-stylesheet.mjs`' reason, unchanged: the admin
 * suite runs under jsdom, whose `TextEncoder` does not produce a real
 * `Uint8Array`, and esbuild refuses to start on that.
 *
 * Usage: `node compile-instance-stylesheet.mjs <absolute instance root>`.
 */
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = process.argv[2];
if (!root || !path.isAbsolute(root)) {
  console.error('usage: compile-instance-stylesheet.mjs <absolute instance root>');
  process.exit(2);
}

const result = await build({
  root,
  // The fixture is an instance, so it inherits none of this project's
  // configuration — a `configFile` lookup would walk up and find `admin`'s.
  configFile: false,
  logLevel: 'error',
  plugins: [react(), tailwindcss()],
  build: {
    write: false,
    sourcemap: false,
    cssMinify: false,
    rollupOptions: { input: path.join(root, 'index.html') },
  },
});

const outputs = Array.isArray(result) ? result[0].output : (result.output ?? []);
const stylesheets = outputs
  .filter((asset) => asset.fileName.endsWith('.css'))
  .map((asset) => String(asset.source ?? ''));

if (stylesheets.length === 0) {
  console.error(
    `the fixture instance at ${root} emitted no stylesheet — a guard reading this would then ` +
      'assert that its palette is whatever it expected, which an empty string satisfies',
  );
  process.exit(2);
}

process.stdout.write(stylesheets.join('\n'));
