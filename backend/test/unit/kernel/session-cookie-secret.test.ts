/**
 * The reference deployment's session key is in its **environment**, not in a
 * local (`src/composition.ts`, `resolveSessionCookieSecret`).
 *
 * ## The defect this file was written from
 *
 * `index.ts` and `worker.ts` resolved
 * `SESSION_COOKIE_SECRET ?? 'dev-secret-change-me'` into a `const`, handed it to
 * `buildServer` and never wrote it back. Everything *downstream of composition*
 * that reads the same variable therefore saw nothing: the platform's
 * `composeApp` resolves `NEWSLETTER_TOKEN_SECRET ?? SESSION_COOKIE_SECRET ?? ''`
 * and `NewsletterTokenHelper` refuses an empty string. A commit correctly
 * deleted the shipped `'newsletter-dev-secret'` literal — a signing key in a
 * public repository — and left the reference deployment with a fallback the
 * platform could not reach.
 *
 * On a developer's machine `backend/.env` carries the variable and nothing is
 * visible. On a fresh clone with no `.env` — `test:backend`'s container, a
 * first-run `pnpm --filter backend run dev`, any `pnpm --filter backend run
 * module:*`, which composes through `cli.ts` — composition dies with
 * `[newsletter] token secret must be a non-empty string`, naming neither the
 * variable nor the deployment.
 *
 * ## Why this file reads source instead of calling the function
 *
 * The function is exported from `src/composition.ts`, which is where a
 * development default for *this* repository's signing key belongs: a
 * self-contained file of its own under `backend/src` is what
 * `host-residue-partition.test.ts` derives as platform-shaped debt. Importing
 * that module pulls the whole composed graph, which is what puts a test file in
 * `test/unit/harness/service-dependent-ledger.test.ts`' population and takes it
 * *out* of the fast suite — the one suite everybody runs, and the one this
 * defect needed to be visible in.
 *
 * So the behavioural proof is
 * `test/integration/kernel/production-boot.test.ts`, which boots the real root
 * against a real environment and is where the defect was found. What is
 * asserted here is the shape that made it possible, in a form the fast suite can
 * carry: the default is **published** rather than kept, it is guarded by the
 * production branch, it is stated **once**, and the composition root resolves it
 * before it composes. Each of the four fails on its own.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const read = (path: string): string =>
  readFileSync(join(BACKEND_ROOT, ...path.split('/')), 'utf8');

/** A source with its comments removed — a mention in prose is not a call. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the reference deployment resolves its session key into the environment', () => {
  it('publishes the development default instead of keeping it in a local', () => {
    // The whole defect in one assertion: the resolved default is assigned back
    // to the variable the platform reads, not merely returned to a caller.
    expect(code(read('src/composition.ts'))).toMatch(
      /process\.env\['SESSION_COOKIE_SECRET'\]\s*=\s*DEVELOPMENT_SESSION_COOKIE_SECRET/,
    );
  });

  it('never invents a key for a production deployment', () => {
    const composition = code(read('src/composition.ts'));
    const body = composition.slice(
      composition.indexOf('export function resolveSessionCookieSecret'),
    );

    // The guard stands before the assignment, so a production process reaches
    // the return and not the default. A development default is a development
    // default: a production deployment that has not been given a key is a
    // misconfiguration and not a value to guess, and this repository has
    // already paid once for a signing key that shipped.
    const guard = body.indexOf("process.env['NODE_ENV'] === 'production'");
    const assignment = body.indexOf("process.env['SESSION_COOKIE_SECRET'] =");
    expect(guard).toBeGreaterThan(-1);
    expect(assignment).toBeGreaterThan(guard);
  });

  it('states the development default once, and both entry points read it from there', () => {
    const restating = ['src/composition.ts', 'src/index.ts', 'src/worker.ts'].filter((path) =>
      code(read(path)).includes("'dev-secret-change-me'"),
    );
    expect(restating).toEqual(['src/composition.ts']);

    for (const path of ['src/index.ts', 'src/worker.ts']) {
      expect(code(read(path)), `${path} does not share the one resolution`).toMatch(
        /import \{[^}]*resolveSessionCookieSecret[^}]*\} from '\.\/composition\.js'/,
      );
    }
  });

  it('resolves it inside `composeApp`, so the CLI and the boot test get it too', () => {
    // `index.ts` is not the only caller. `cli.ts` composes for every `module:*`
    // and `admin:create` invocation, and the integration test composes to prove
    // this root boots — so a default applied only by the HTTP entry point is a
    // default two of the three cannot see.
    const composition = code(read('src/composition.ts'));
    const composeApp = composition.slice(composition.indexOf('export async function composeApp'));

    expect(composeApp).toContain('resolveSessionCookieSecret()');
    // And before the composition it guards: `resolvedManifestEntries()` is the
    // first thing that body does with the deployment.
    expect(composeApp.indexOf('resolveSessionCookieSecret()')).toBeLessThan(
      composeApp.indexOf('resolvedManifestEntries()'),
    );
  });
});
