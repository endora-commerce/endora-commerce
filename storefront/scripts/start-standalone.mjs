// `pnpm run start` — serve the build `pnpm run build` produced.
//
// `next.config.js` builds with `output: 'standalone'`: a self-contained server
// under `.next/standalone/`, which is what the image runs. `next start` over
// such a build says `"next start" does not work with "output: standalone"
// configuration. Use "node .next/standalone/server.js" instead.` — so this is
// that, with the two things the bare command leaves to its caller:
//
//   * **where the server is.** `outputFileTracingRoot` is the directory above
//     the application, so the emitted tree repeats the application's own
//     directory name: `.next/standalone/<this directory's name>/server.js`.
//     A scaffolded storefront is called whatever its owner called it.
//   * **what it serves from.** The standalone tree carries the server and its
//     traced dependencies, and neither `.next/static` nor `public/`. The
//     Dockerfile copies both beside the server; a start on a machine has to do
//     the same, every time, or it serves the previous build's assets.
//
// `.env` is loaded by the `node --env-file-if-exists=.env` that runs this file
// (the `start` script), so `PORT` is read exactly as `dev` reads it.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Where `next build` put this application's standalone tree. */
export function standaloneAppDir(appDir) {
  return join(appDir, '.next', 'standalone', basename(appDir));
}

/**
 * Put the static assets and `public/` beside the standalone server, and answer
 * the server's path. Throws when the tree was not built.
 */
export function assembleStandalone(appDir) {
  const standalone = standaloneAppDir(appDir);
  const server = join(standalone, 'server.js');
  if (!existsSync(server)) {
    throw new Error(
      `there is no built storefront at ${server}. Run \`pnpm run build\` first — it is what ` +
        'produces the server this command starts.',
    );
  }
  for (const [from, to] of [
    [join(appDir, '.next', 'static'), join(standalone, '.next', 'static')],
    [join(appDir, 'public'), join(standalone, 'public')],
  ]) {
    rmSync(to, { recursive: true, force: true });
    if (existsSync(from)) cpSync(from, to, { recursive: true });
  }
  return server;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
  let server;
  try {
    server = assembleStandalone(appDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  // The standalone server binds `HOSTNAME`, and a shell that exports its
  // machine's name there would have it listen on that one interface — where
  // `http://localhost:<PORT>`, the address this storefront is told it has, does
  // not answer. `next start` listens on every interface; so does this.
  process.env.HOSTNAME = '0.0.0.0';
  process.env.NODE_ENV ??= 'production';
  await import(pathToFileURL(server).href);
}
