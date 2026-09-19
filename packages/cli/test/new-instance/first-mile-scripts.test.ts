/**
 * The root scripts that drive the development environment, and the block a
 * client is told to follow (`specs/125-first-mile-install/spec.md` §4.1,
 * FR-108…FR-110; `tasks.md` T1-G, T1-H).
 *
 * ## What was measured before these existed
 *
 * Re-derived on this branch, over `nextSteps()` and the rendered root manifest:
 * the block was **eleven** entries at its longest, of which nine were commands,
 * one was an editor session over a file with blanks in it and one was a pointer
 * to another command; and `pnpm -C admin run preview` — the command that serves
 * the admin bundle the client just built — was printed **nowhere**, in the
 * block or in the README, while `admin/package.json` has declared it all along.
 *
 * ## The composite is derived from the named entries, exactly as `build` is
 *
 * FR-109. `build` is `layerBuilds.map(…).join(' && ')` and has been since
 * feature 122, for the reason that file states: *"deriving it from the named
 * entries is what keeps its value byte-identical to the named parts rather than
 * merely similar to them"*. `setup` is the same shape one level up — it names
 * **root scripts**, so a change to what `migrate` runs reaches it with nothing
 * here edited — and the case below asserts that every term of it is a script
 * the same manifest declares, rather than comparing it to a string.
 *
 * ## The printed addresses are read off the rendered document
 *
 * T1-H, and it is the half of FR-105 that is unblocked: until the derived
 * `.env` lands (Phase 2, proposed ruling PR-1(a)), the block **prints** the
 * three URLs rather than writing them. They are derived from the rendered
 * `compose.dev.yml` and not written down here, so a changed default port moves
 * the printed address in the same run — which is the property a second list
 * would not have.
 */
import { describe, expect, it } from 'vitest';

import {
  DEV_COMPOSE_PATH,
  developmentAddresses,
} from '../../src/new-instance/deploy.js';
import { nextSteps } from '../../src/new-instance/index.js';
import { planInstance, type PlanInput } from '../../src/new-instance/template.js';

const SCOPE = '@endora-commerce/';

function planInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    name: 'acme-shop',
    deployment: 'acme-shop',
    scope: SCOPE,
    platformVersion: '1.2.3',
    enginesNode: '>=22.17.0',
    packageManager: 'pnpm@9.15.0',
    modules: [{ id: 'settings', packageName: `${SCOPE}mod-settings`, version: '0.4.5' }],
    adminShellVersion: null,
    adminKitVersion: null,
    adminRanges: new Map(),
    adminPeers: new Map(),
    cliVersion: '1.2.3',
    docsRanges: new Map([
      ['@docusaurus/core', '^3.10.0'],
      ['@docusaurus/preset-classic', '^3.10.0'],
    ]),
    declaredRanges: new Map([
      ['@mikro-orm/core', '^6'],
      ['fastify', '^5'],
      ['zod', '^4'],
      ['typescript', '^5.9.3'],
    ]),
    registry: null,
    npmrc: null,
    topology: 'single-host',
    declared: [],
    existingEnv: '',
    generated: new Map(),
    ...overrides,
  };
}

function withAdminMember(overrides: Partial<PlanInput> = {}): PlanInput {
  return planInput({
    adminShellVersion: '4.5.6',
    adminKitVersion: '4.5.6',
    adminRanges: new Map([
      ['react', '^19.0.0'],
      ['react-dom', '^19.0.0'],
      ['vite', '^7.3.2'],
      ['@vitejs/plugin-react', '^5.2.0'],
      ['tailwindcss', '^4.2.4'],
      ['@tailwindcss/vite', '^4.2.4'],
    ]),
    adminPeers: new Map(),
    ...overrides,
  });
}

function scriptsOf(input: PlanInput, path = 'package.json'): Record<string, string> {
  const file = planInstance(input).files.find((entry) => entry.path === path);
  expect(file, `${path} is not in the plan`).toBeDefined();
  return (JSON.parse(file!.content) as { scripts: Record<string, string> }).scripts;
}

function composeOf(input: PlanInput): string {
  return planInstance(input).files.find((entry) => entry.path === DEV_COMPOSE_PATH)!.content;
}

describe('FR-108 — the two scripts that drive the development stack', () => {
  it('T1-G — `dev:services` waits for health, and `dev:services:down` stops the stack', () => {
    const scripts = scriptsOf(planInput());
    expect(scripts['dev:services']).toBe(
      `docker compose -f ${DEV_COMPOSE_PATH} up -d --wait`,
    );
    expect(scripts['dev:services:down']).toBe(`docker compose -f ${DEV_COMPOSE_PATH} down`);
  });

  it('`--wait` is not decoration: it is what stops `migrate` racing an initialising Postgres', () => {
    // The flag is the whole reason the composite below can run `migrate`
    // straight after the services, so it is asserted rather than assumed.
    expect(scriptsOf(planInput())['dev:services']).toContain(' --wait');
  });

  it('both name the file this same run writes, and no other', () => {
    const paths = planInstance(planInput()).files.map((file) => file.path);
    for (const script of ['dev:services', 'dev:services:down']) {
      const command = scriptsOf(planInput())[script]!;
      const named = /-f (\S+)/.exec(command)![1]!;
      expect(paths, `${script} names ${named}, which this run does not write`).toContain(named);
    }
  });

  it('`down` keeps the volumes — a development database is not a scratch file', () => {
    expect(scriptsOf(planInput())['dev:services:down']).not.toContain('-v');
    expect(scriptsOf(planInput())['dev:services:down']).not.toContain('--volumes');
  });
});

describe('FR-109 — `setup` is the conjunction of the named entries, never a second spelling', () => {
  it('T1-G — every term of it is a root script this same manifest declares', () => {
    for (const input of [planInput(), withAdminMember(), planInput({ docsRanges: new Map() })]) {
      const scripts = scriptsOf(input);
      const terms = scripts['setup']!.split(' && ');
      expect(terms.length).toBeGreaterThan(1);
      for (const term of terms) {
        const named = /^pnpm run (\S+)/.exec(term);
        expect(named, `\`${term}\` is not a call of a named root script`).not.toBeNull();
        expect(
          scripts[named![1]!],
          `setup runs \`${named![1]!}\`, which this manifest does not declare`,
        ).toBeDefined();
        expect(named![1]).not.toBe('setup');
      }
    }
  });

  it('it is the four steps of the printed sequence, in the printed order', () => {
    expect(scriptsOf(withAdminMember())['setup']).toBe(
      'pnpm run generate && pnpm run build && pnpm run migrate && pnpm run module:install --all',
    );
  });

  it('an instance with nothing to generate has no `generate` term to run', () => {
    // Neither generated member **and** no installed module: since T065 the
    // entity index is a family of its own, belonging to no member, so a headless
    // instance that installed a module does have something to render and does
    // get the term. This is the state that has nothing at all.
    const scripts = scriptsOf(planInput({ docsRanges: new Map(), modules: [] }));
    expect(scripts['generate']).toBeUndefined();
    expect(scripts['setup']).toBe(
      'pnpm run build && pnpm run migrate && pnpm run module:install --all',
    );
  });

  it('a headless instance that installed a module keeps the `generate` term', () => {
    const scripts = scriptsOf(planInput({ docsRanges: new Map() }));
    expect(scripts['generate']).toBe('endora generate');
    expect(scripts['setup']).toBe(
      'pnpm run generate && pnpm run build && pnpm run migrate && pnpm run module:install --all',
    );
  });
});

describe('FR-110 — the admin is servable from the root', () => {
  it('T1-G — `preview:admin` is written with the member and delegates to its own script', () => {
    const scripts = scriptsOf(withAdminMember());
    expect(scripts['preview:admin']).toBe('pnpm -C admin run preview');
    // T141's rule, restated over the new entry: the delegation reaches a script
    // the member actually declares.
    expect(scriptsOf(withAdminMember(), 'admin/package.json')['preview']).toBeDefined();
  });

  it('an admin-less instance gets no `preview:admin` rather than a script that fails', () => {
    expect(scriptsOf(planInput())['preview:admin']).toBeUndefined();
  });
});

describe('FR-105 (printed half) — the addresses are read off the rendered document', () => {
  it('T1-H — every printed URL parses to a port `compose.dev.yml` publishes', () => {
    const document = composeOf(planInput());
    const addresses = developmentAddresses(document);
    for (const [name, value] of addresses) {
      const port = /:(\d+)(?:\/|$)/.exec(value)?.[1];
      if (port === undefined) continue;
      expect(
        document,
        `${name} names port ${port}, which the rendered document does not publish`,
      ).toContain(`:-${port}}:`);
    }
    expect(addresses.get('DATABASE_URL')).toBe('postgresql://endora:endora@localhost:5432/endora');
    expect(addresses.get('REDIS_URL')).toBe('redis://localhost:6379');
    expect(addresses.get('MEILISEARCH_URL')).toBe('http://localhost:7700');
    expect(addresses.get('SMTP_URL')).toBe('smtp://localhost:1025');
  });

  it('a name the document does not answer yields no address at all', () => {
    // The intersection FR-105 describes, from the compose side: a document with
    // no mail catcher supplies no `SMTP_URL`, and nothing here has to know that
    // `SMTP_URL` is the `email` module's.
    const withoutMail = composeOf(planInput())
      .split('\n')
      .filter((line) => !line.includes('MAILPIT_SMTP_PORT'))
      .join('\n');
    expect(developmentAddresses(withoutMail).has('SMTP_URL')).toBe(false);
    expect(developmentAddresses(withoutMail).has('REDIS_URL')).toBe(true);
  });

  it('a changed default moves the address with no second list edited', () => {
    const moved = composeOf(planInput()).replace('${REDIS_PORT:-6379}', '${REDIS_PORT:-16379}');
    expect(developmentAddresses(moved).get('REDIS_URL')).toBe('redis://localhost:16379');
  });
});

describe('T1-H — the block a client follows', () => {
  const steps = (
    options: Parameters<typeof nextSteps>[4] = {},
    moduleIds: readonly string[] = [],
  ): readonly string[] => nextSteps('/tmp/acme', 'default', 'single-host', moduleIds, options);

  it('the services step comes first, before anything that needs them', () => {
    const block = steps();
    const services = block.findIndex((step) => step.startsWith('pnpm run dev:services'));
    expect(services).toBeGreaterThanOrEqual(0);
    expect(services).toBeLessThan(block.findIndex((step) => step.startsWith('pnpm run setup')));
    expect(block.findIndex((step) => step.startsWith('pnpm run setup'))).toBeLessThan(
      block.findIndex((step) => step.startsWith('pnpm run start')),
    );
  });

  it('it names what `setup` runs, so a client can take any step by hand', () => {
    const setup = steps().find((step) => step.startsWith('pnpm run setup'))!;
    for (const named of ['generate', 'build', 'migrate', 'module:install --all']) {
      expect(setup).toContain(named);
    }
  });

  it('the `.env` step prints the addresses the rendered compose file publishes', () => {
    const addresses = developmentAddresses(composeOf(planInput()));
    const block = steps({ environment: addresses }).join('\n');
    for (const [, value] of addresses) expect(block).toContain(value);
  });

  it('with no derived addresses it prints none, rather than inventing them', () => {
    const block = steps().join('\n');
    expect(block).not.toContain('postgresql://');
  });

  it('`preview:admin` is printed with the member and not without it — baseline step D1', () => {
    expect(steps({ admin: true }).join('\n')).toContain('pnpm run preview:admin');
    expect(steps({ admin: false }).join('\n')).not.toContain('preview:admin');
  });

  it('the block is shorter than the sequence it replaces, and still ends on the storefront', () => {
    const block = steps({ admin: true }, ['admin_users']);
    expect(block.join('\n')).toContain('endora new storefront <dir>');
    // Four typed steps collapse onto `setup`, and one arrives (`dev:services`),
    // so the block is shorter than the eleven entries it had.
    expect(block.length).toBeLessThan(11);
  });
});
