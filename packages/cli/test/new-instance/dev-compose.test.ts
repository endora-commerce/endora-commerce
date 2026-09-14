/**
 * `compose.dev.yml` — the development environment a scaffolded instance carries
 * (`specs/125-first-mile-install/spec.md` §4.1, FR-100…FR-112; `tasks.md`
 * T1-A…T1-E, T1-I).
 *
 * ## What was measured before this existed
 *
 * A scaffolded instance held **no runnable services file at all**. Re-derived
 * on this branch before the first line of it was written:
 *
 * ```
 * grep -E "    path: '" packages/cli/src/new-instance/template.ts \
 *   | grep -icE 'docker|compose'   # → 0
 * ```
 *
 * Everything under `deploy/` is `image: ${REGISTRY_IMAGE}/<member>:${IMAGE_TAG:-latest}`,
 * so none of it can be started by the person who receives it: the images do not
 * exist until that client has built and pushed them to a registry they own. A
 * production example is not a development environment. So Postgres, Redis and a
 * search engine were the client's to provision by hand — three of the nineteen
 * steps §2.3 counts.
 *
 * ## Every assertion here is over a rendered document, parsed
 *
 * Feature 122's T010, which this file inherits along with its reader: *"a test
 * that greps the example for a string proves the string, not the file"*. A
 * `ports:` block one indentation level out would satisfy every substring
 * assertion anybody would think to write and would be refused by `docker
 * compose` on the client's machine.
 *
 * ## The two properties that are not about content
 *
 * **FR-101** is asserted as the *absence* of an un-defaulted expansion rather
 * than the presence of a default, because the property is that the file runs in
 * a tree whose `.env` was never opened — and one `${FOO}` anywhere defeats it
 * whatever the other twenty say.
 *
 * **FR-103** is asserted across two documents: the image, the healthcheck and
 * the volume of each shared service come from the same record, so a case here
 * moves both renderings or neither. That is what stops the defect §2.5's F-2
 * names — three statements of `postgres:16-alpine` agreeing by coincidence.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEV_COMPOSE_PATH,
  developmentComposeFile,
  undefaultedExpansions,
  type DeployInput,
} from '../../src/new-instance/deploy.js';
import { planInstance, type PlanInput } from '../../src/new-instance/template.js';
import { parseComposeYaml, serviceNames, type YamlMapping } from './compose-yaml.js';

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

function deployInput(overrides: Partial<DeployInput> = {}): DeployInput {
  return {
    topology: 'single-host',
    admin: false,
    npmrc: false,
    docs: false,
    enginesNode: '>=22.17.0',
    packageManager: 'pnpm@9.15.0',
    declared: [],
    ...overrides,
  };
}

function contentAt(input: PlanInput, path: string): string {
  const file = planInstance(input).files.find((entry) => entry.path === path);
  expect(file, `${path} is not in the plan`).toBeDefined();
  return file!.content;
}

function devDocument(input: PlanInput = planInput()): YamlMapping {
  return parseComposeYaml(contentAt(input, DEV_COMPOSE_PATH));
}

function serviceOf(document: YamlMapping, name: string): YamlMapping {
  const service = (document['services'] as YamlMapping)[name];
  expect(service, `the document declares no \`${name}\` service`).toBeDefined();
  return service as YamlMapping;
}

/** This repository's own root, found by the file that declares its workspace. */
function repositoryRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8');
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error('dev-compose.test: no `pnpm-workspace.yaml` above this file');
}

describe('FR-100…FR-102 — a runnable services file, at the root and not under `deploy/`', () => {
  it('T1-A — the plan writes `compose.dev.yml` at the instance root', () => {
    const file = planInstance(planInput()).files.find((entry) => entry.path === DEV_COMPOSE_PATH);
    expect(file).toBeDefined();
    expect(file!.member).toBe('root');
    // Derived, not the client's: it is a function of the service catalogue and
    // is meant to be run unedited, where everything in `deploy/` is rendered
    // once and edited by them (spec §5.3.1).
    expect(file!.kind).toBe('derived');
  });

  it('FR-102 — it is at none of Compose\'s four default filenames, and not under `deploy/`', () => {
    const paths = planInstance(planInput()).files.map((entry) => entry.path);
    expect(paths).toContain('compose.dev.yml');
    for (const reserved of [
      'compose.yaml',
      'compose.yml',
      'docker-compose.yaml',
      'docker-compose.yml',
    ]) {
      // A default-named compose file in the same repository as a production
      // example is the file that gets started on the wrong machine.
      expect(paths).not.toContain(reserved);
      expect(paths).not.toContain(`deploy/${reserved}`);
    }
    expect(paths.filter((path) => path.endsWith('compose.dev.yml'))).toEqual(['compose.dev.yml']);
  });

  it('FR-107 — it is written whatever the member set and whatever the topology', () => {
    for (const input of [
      planInput(),
      planInput({ topology: 'three-host' }),
      planInput({ adminShellVersion: '4.5.6', adminKitVersion: '4.5.6' }),
    ]) {
      expect(planInstance(input).files.map((entry) => entry.path)).toContain(DEV_COMPOSE_PATH);
    }
  });

  it('T1-A — it declares Postgres, Redis, Meilisearch and a mail catcher', () => {
    expect(serviceNames(devDocument())).toEqual(['mailpit', 'meilisearch', 'postgres', 'redis']);
  });

  it('FR-104 — it holds no application service and waits for nothing', () => {
    const document = devDocument();
    const text = contentAt(planInput(), DEV_COMPOSE_PATH);
    // The backend, the admin and the storefront run natively from the workspace
    // this same run wrote. An image built from a registry the client does not
    // have yet is the whole reason `deploy/` cannot be started.
    expect(text).not.toContain('REGISTRY_IMAGE');
    expect(text).not.toContain('depends_on');
    for (const name of serviceNames(document)) {
      expect(Object.keys(serviceOf(document, name))).not.toContain('depends_on');
    }
  });

  it('FR-101 — every expansion in it carries an inline default', () => {
    expect(undefaultedExpansions(contentAt(planInput(), DEV_COMPOSE_PATH))).toEqual([]);
  });

  it('FR-104 — every service publishes a host port, each one overridable', () => {
    const document = devDocument();
    const published = new Map<string, readonly string[]>();
    for (const name of serviceNames(document)) {
      const ports = serviceOf(document, name)['ports'];
      expect(Array.isArray(ports), `\`${name}\` publishes no host port`).toBe(true);
      published.set(name, (ports as readonly string[]).map(String));
    }
    expect(published.get('postgres')).toEqual(['${POSTGRES_PORT:-5432}:5432']);
    expect(published.get('redis')).toEqual(['${REDIS_PORT:-6379}:6379']);
    expect(published.get('meilisearch')).toEqual(['${MEILISEARCH_PORT:-7700}:7700']);
    expect(published.get('mailpit')).toEqual([
      '${MAILPIT_SMTP_PORT:-1025}:1025',
      '${MAILPIT_UI_PORT:-8025}:8025',
    ]);
  });

  it('its header says how to start it and that it is not a deployment', () => {
    const header = contentAt(planInput(), DEV_COMPOSE_PATH).split('\nservices:')[0]!;
    expect(header).toContain('docker compose -f compose.dev.yml up -d --wait');
    expect(header.toLowerCase()).toContain('development');
    expect(header).toContain('deploy/');
  });
});

describe('FR-103 — one catalogue, two renderings', () => {
  it('the image, the healthcheck and the volume of a shared service are the same record', () => {
    const development = devDocument();
    const production = parseComposeYaml(contentAt(planInput(), 'deploy/compose.prod.yml'));
    for (const name of ['postgres', 'redis', 'meilisearch']) {
      const dev = serviceOf(development, name);
      const prod = serviceOf(production, name);
      expect(dev['image'], `${name}: the image differs between the two renderings`).toEqual(
        prod['image'],
      );
      expect(dev['volumes']).toEqual(prod['volumes']);
      // The healthcheck's *shape* is one record's; its expansions are rendered
      // per mode, which is the one difference FR-103 allows.
      const shape = (service: YamlMapping): unknown =>
        JSON.parse(
          JSON.stringify(service['healthcheck']).replace(/\$\{([A-Z0-9_]+)(:-[^}]*)?\}/g, '${$1}'),
        );
      expect(shape(dev)).toEqual(shape(prod));
    }
  });

  it('T1-B — each image tag is stated exactly once in this package\'s sources', () => {
    const source = readFileSync(
      join(repositoryRoot(), 'packages/cli/src/new-instance/deploy.ts'),
      'utf8',
    );
    for (const image of [
      'postgres:16-alpine',
      'redis:7-alpine',
      'getmeili/meilisearch:v1.11',
      'axllent/mailpit:v1.31',
    ]) {
      const occurrences = source.split(image).length - 1;
      expect(occurrences, `${image} is stated ${String(occurrences)} times, not once`).toBe(1);
    }
  });

  it('the development rendering differs from the production one in the value source only', () => {
    const production = parseComposeYaml(contentAt(planInput(), 'deploy/compose.prod.yml'));
    const development = devDocument();
    const postgresProd = serviceOf(production, 'postgres')['environment'] as YamlMapping;
    const postgresDev = serviceOf(development, 'postgres')['environment'] as YamlMapping;
    expect(Object.keys(postgresDev)).toEqual(Object.keys(postgresProd));
    expect(postgresProd['POSTGRES_USER']).toBe('${POSTGRES_USER}');
    expect(postgresDev['POSTGRES_USER']).toBe('${POSTGRES_USER:-endora}');
  });
});

describe('FR-111 / T1-D — the guard `envExampleFor` does not give you', () => {
  it('reports an un-defaulted expansion by name, and a defaulted one not at all', () => {
    expect(undefaultedExpansions('a: ${FOO}\nb: ${BAR:-2}\n')).toEqual(['FOO']);
    expect(undefaultedExpansions('a: ${FOO:-1}\n')).toEqual([]);
  });

  it('reports each name once, sorted, however often it is expanded', () => {
    expect(undefaultedExpansions('${B} ${A} ${B}')).toEqual(['A', 'B']);
  });

  it('the renderer throws on a document that would reach a client with a blank', () => {
    // The document is rendered from the catalogue, so the only way to reach
    // this is a record that gained an expansion with no default — which is
    // exactly the case the throw exists for, and it names the variable.
    expect(() =>
      developmentComposeFile(deployInput(), ['x-probe: ${UNDEFAULTED_PROBE}']),
    ).toThrow(/UNDEFAULTED_PROBE/);
  });

  it('envExampleFor is not called for this document and keeps its own regex', () => {
    const source = readFileSync(
      join(repositoryRoot(), 'packages/cli/src/new-instance/deploy.ts'),
      'utf8',
    );
    // spec §5.3.3: that function's default clause is NON-capturing, so a match
    // says nothing about which of the two forms it was. Reusing the constant
    // would report every expansion as defaulted — which is a guard that is
    // green on the document it was written to refuse.
    expect(source).toContain('/\\$\\{([A-Z0-9_]+)(?::-[^}]*)?\\}/g');
    expect(source).toContain('/\\$\\{([A-Z0-9_]+)(:-[^}]*)?\\}/g');
  });
});

describe('T1-E / defect F-2 — the image tags agree by instrument rather than by luck', () => {
  it('this repository\'s own `docker-compose.yml` names the catalogue\'s images', () => {
    const infra = readFileSync(join(repositoryRoot(), 'docker-compose.yml'), 'utf8');
    const document = devDocument();
    for (const name of ['postgres', 'redis', 'meilisearch', 'mailpit']) {
      const image = serviceOf(document, name)['image'] as string;
      expect(
        infra,
        `docker-compose.yml and packages/cli/src/new-instance/deploy.ts disagree about ` +
          `${name}: the catalogue renders \`${image}\`. Two statements of one image tag with ` +
          `nothing between them is what this case exists to refuse.`,
      ).toContain(`image: ${image}`);
    }
  });

  it('it runs Mailpit rather than MailHog (FR-112)', () => {
    const infra = readFileSync(join(repositoryRoot(), 'docker-compose.yml'), 'utf8');
    // Measured 2026-09-14: `mailhog/MailHog`'s last commit is 2024-02-13,
    // `axllent/mailpit`'s is 2026-09-06. The assertion is over the **image**
    // and not the vocabulary: the file names MailHog in the comment recording
    // why it moved, which is the sentence a reader needs and not a service.
    expect(infra).not.toContain('image: mailhog/');
    expect(infra).toContain('image: axllent/mailpit:');
  });
});

describe('FR-107 / T1-I — a file the client deleted does not come back', () => {
  it('a second run over a tree that holds an instance refuses and writes nothing', async () => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { InstanceInputError, runNewInstance } = await import('../../src/new-instance/index.js');
    const target = mkdtempSync(join(tmpdir(), 'devcompose-'));
    try {
      mkdirSync(join(target, 'backend'), { recursive: true });
      writeFileSync(join(target, 'package.json'), '{}\n', 'utf8');
      // The client deleted it. A completion run does not exist yet — the
      // command refuses a non-empty directory outright (F1) — so the property
      // holds by the stronger refusal, and this case is what will notice when
      // completion arrives.
      await expect(runNewInstance({ dir: target })).rejects.toBeInstanceOf(InstanceInputError);
      expect(() => readFileSync(join(target, DEV_COMPOSE_PATH), 'utf8')).toThrow();
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});
