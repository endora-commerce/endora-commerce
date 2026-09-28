/**
 * The host an `endora install` case stands in: a directory holding an install
 * of ours and nothing else — the shape `test/install.test.ts` builds, lifted
 * here so the wizard's cases (`test/install-wizard.test.ts`) enter at the same
 * place rather than at a pre-resolved plan (issue #130).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch: string[] = [];

/** Remove every directory {@link temp} made. Call it from `afterEach`. */
export function cleanScratch(): void {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
}

export function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** One declared environment input, in the shape the contract's schema takes. */
function input(
  name: string,
  requirement: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    describes: { en: `what ${name} decides.`, pl: `co ${name} ustala.` },
    requirement,
    secret: false,
    generable: false,
    owner: { kind: 'platform' },
    consumers: ['backend'],
    addressOf: null,
    ...overrides,
  };
}

/** The packages an install leaves beside the target, as `pnpm add` writes them. */
export function installFixture(root: string): void {
  const scopeDir = join(root, 'node_modules', '@endora-commerce');
  const write = (name: string, manifest: unknown, source: string): void => {
    const dir = join(scopeDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest), 'utf8');
    writeFileSync(join(dir, 'manifest.js'), source, 'utf8');
  };
  write(
    'platform',
    {
      name: '@endora-commerce/platform',
      version: '1.2.3',
      type: 'module',
      endora: { type: 'platform' },
      exports: { '.': { default: './manifest.js' } },
      peerDependencies: { fastify: '^5', zod: '^4' },
    },
    // What a scaffolded instance reads from its environment is the **installed**
    // platform's declaration, so the fixture carries one: the four the
    // development stack answers, plus the secret two trees share. The
    // `.env` this produces is what the derivation writes into, and an input
    // nothing declares gets no line — which is the intersection FR-105 states.
    `export const PLATFORM_ENVIRONMENT_INPUTS = ${JSON.stringify([
      input('DATABASE_URL', { kind: 'required' }),
      input('REDIS_URL', { kind: 'required' }),
      input('MEILISEARCH_URL', {
        kind: 'optional',
        without: { en: 'the liveness probe reports this instance degraded.', pl: 'x' },
      }),
      input('SMTP_URL', {
        kind: 'optional',
        without: { en: 'mail goes to a console mailer that delivers nothing.', pl: 'x' },
      }),
      input('REVALIDATE_SECRET', { kind: 'required' }, { secret: true }),
      input('SESSION_COOKIE_SECRET', { kind: 'required' }, { secret: true, generable: true }),
    ])};\n`,
  );
  write(
    'mod-settings',
    {
      name: '@endora-commerce/mod-settings',
      version: '1.2.3',
      type: 'module',
      endora: { type: 'module', id: 'settings' },
      exports: { '.': { default: './manifest.js' } },
    },
    `export const manifest = { id: 'settings', dependencies: [], activation: { nonDeactivatable: true, reason: 'the platform cannot run without it' } };\n`,
  );
  write(
    'mod-admin-users',
    {
      name: '@endora-commerce/mod-admin-users',
      version: '1.2.3',
      type: 'module',
      endora: { type: 'module', id: 'admin_users' },
      exports: { '.': { default: './manifest.js' } },
    },
    `export const manifest = { id: 'admin_users', dependencies: ['settings'] };\n`,
  );
}

/** A host directory: an install of ours, and nothing else. */
export function host(): string {
  const root = temp('endora-install-');
  installFixture(root);
  return root;
}

export const ADMIN = {
  adminEmail: 'owner@example.com',
  adminPassword: 'a-password-they-remember',
  adminFirstName: 'Ada',
  adminLastName: 'Lovelace',
} as const;

