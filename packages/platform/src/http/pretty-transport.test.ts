/**
 * The development log transport, and the package that has to carry it.
 *
 * ## The defect this pins
 *
 * `0.100.0` named `pino-pretty` as a pino transport target from `server.ts`
 * and `logger.ts` while only the monorepo's `backend/package.json` depended on
 * it. Inside this repository the backend's dependency made the name resolve;
 * in a scaffolded instance nothing declared it, and `pnpm run dev:all` died at
 * API boot with `unable to determine transport target for "pino-pretty"`
 * (W5.5, GitHub run 36835214331). A transport target is a **string**, so no
 * import-graph check and no type-check could see the missing declaration.
 *
 * ## The rule
 *
 * The package that names the target declares it, and the target is handed to
 * pino as the path resolved from this package — never as a bare name pino has
 * to find from whichever file happens to be on its call stack. And a pretty log
 * is a development nicety: when it cannot be resolved the platform logs plain
 * JSON rather than refusing to boot.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { prettyTransport } from './pretty-transport.js';

const manifest = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { dependencies?: Record<string, string> };

describe('the pretty log transport', () => {
  it('is a declared runtime dependency of the platform, which names it', () => {
    expect(manifest.dependencies?.['pino-pretty']).toBeDefined();
  });

  it('resolves from the platform package itself, under plain Node', () => {
    // A child process with `NODE_PATH` cleared: pnpm's `.bin` shims export a
    // `NODE_PATH` reaching every package in the store, so inside `pnpm exec
    // vitest` the name resolved whether or not this package declared it, while
    // `node -e "require.resolve('pino-pretty')"` in this directory threw.
    const packageJson = fileURLToPath(new URL('../../package.json', import.meta.url));
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `require('node:module').createRequire(${JSON.stringify(packageJson)}).resolve('pino-pretty')`,
      ],
      { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } },
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it('hands pino the resolved path, not a bare name', () => {
    const transport = prettyTransport((name) => `/resolved/${name}/index.js`);
    expect(transport?.target).toBe('/resolved/pino-pretty/index.js');
    expect(transport?.options).toMatchObject({ colorize: true });
  });

  it('answers no transport — plain JSON — when pino-pretty cannot be resolved', () => {
    expect(
      prettyTransport(() => {
        throw Object.assign(new Error("Cannot find module 'pino-pretty'"), { code: 'MODULE_NOT_FOUND' });
      }),
    ).toBeUndefined();
  });

  it('resolves for real with the default resolver', () => {
    expect(prettyTransport()?.target).toMatch(/pino-pretty/);
  });
});
