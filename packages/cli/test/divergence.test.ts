/**
 * The divergence report in an **instance** (`specs/110-instance-repository/` T138a;
 * `specs/107-override-report-and-ladder/contracts/divergence-report.md`).
 *
 * ## Why this file exists and what it is *not* covering
 *
 * The derivation is `lib/divergence.ts`' and is already proven nine findings deep
 * by `backend/test/unit/scripts/check-divergence.test.ts` over a fixture
 * deployment that exercises every seam once. Nothing here re-proves any of that:
 * the two hosts share `deriveDivergence`, and a second set of cases over it would
 * be two answers to one question waiting to disagree.
 *
 * What is new — and had no subject anywhere in this repository before T138a — is
 * the **instance host**: a composition assembled out of installed packages rather
 * than out of module sources, a declaration read as source text rather than
 * imported, and the two things that follow from the first, which are an
 * attribution that is one notch less specific and an artefact that has to *say
 * so*. `divergence-report.md` §4's own standard is that a report which is
 * silently narrower is worse than no report, so the narrowing is asserted here as
 * a property of the rendered bytes and not of a comment.
 *
 * ## The fixture is an install, not a plan
 *
 * Issue #130, and `generate.test.ts`' own discipline one artefact family over.
 * Every case runs over a directory on disk holding a `pnpm-workspace.yaml`, an
 * `apps/<deployment>/` tree, and a `node_modules` carrying a module package and
 * a platform that ship **emitted** code — because "does the analysis read a
 * `dist` as readily as it reads a `src`" is precisely the question the move had
 * to answer, and a fixture of TypeScript sources would have answered a different
 * one.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { generateReport, GenerateHostError, runGenerate } from '../src/generate/index.js';
import {
  renderInstanceDivergence,
  DivergenceHostError,
  instanceDeployments,
} from '../src/generate/divergence.js';
import {
  instanceComposition,
  readDivergenceDeclaration,
  seamsFromKernel,
} from '../src/lib/divergence-artefacts.js';
import { installedModulePackages, type ModulePackage } from '../src/lib/module-packages.js';

const SCOPE = '@endora-commerce';
const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

/**
 * `ModuleContext`, as the platform's published declarations carry it.
 *
 * A `.d.ts`, because that is what an instance has: the emitted declaration is
 * what `seamsFromKernel` reads, and it is measurably the same interface —
 * `moduleContextSeams` over `packages/platform/src/kernel/module-context.ts` and
 * over `packages/platform/dist/kernel/module-context.d.ts` return the same
 * sixteen members in the same order.
 */
const MODULE_CONTEXT_DECLARATIONS = `
export interface ModuleContext {
    readonly module: {
        readonly id: string;
        readonly version: string;
    };
    readonly di: {
        register(registrations: Record<string, unknown>): void;
        providePort(name: string, registration: unknown): void;
        decorate(name: string, wrap: (inner: unknown) => unknown): void;
    };
    asClass(target: unknown): unknown;
    asFunction(target: unknown): unknown;
    asValue(value: unknown): unknown;
    cradle<C>(): C;
    routes(register: (app: unknown) => void): void;
    ungatedRoutes(reason: string, register: (app: unknown) => void): void;
    rootPlugin(reason: string, plugin: unknown): void;
    worker<W>(worker: W): W;
    subscribe(event: string, handler: (payload: unknown) => void): void;
    interceptors(entries: readonly unknown[]): void;
    onBoot(hook: () => Promise<void>): void;
    readonly log: unknown;
}
`;

/** The host an instance installed, as a published tarball leaves it: `dist` only. */
function installPlatform(root: string): void {
  const dir = join(root, 'node_modules', SCOPE, 'platform');
  write(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `${SCOPE}/platform`,
      version: '1.0.0',
      endora: { type: 'platform' },
      exports: {
        './kernel': { types: './dist/kernel/index.d.ts', default: './dist/kernel/index.js' },
        './composition': './dist/composition/index.js',
      },
    }),
  );
  write(join(dir, 'dist', 'kernel', 'index.js'), 'export {};\n');
  write(join(dir, 'dist', 'kernel', 'index.d.ts'), "export type { ModuleContext } from './module-context.js';\n");
  write(join(dir, 'dist', 'kernel', 'module-context.d.ts'), MODULE_CONTEXT_DECLARATIONS);
  // `composeApp`'s own registrations: the names a composition root supplies in
  // an instance, which is what stops a decoration of one reading `unowned-subject`.
  write(
    join(dir, 'dist', 'composition', 'index.js'),
    `export function composeApp(ctx) {\n` +
      `    ctx.di.register({\n` +
      `        commandBus: ctx.asValue(buildCommandBus()),\n` +
      `        salesChannelCodeIdPort: ctx.asValue(buildChannelPort()),\n` +
      `    });\n` +
      `}\n`,
  );
}

/** One installed module package, compiled: a registration and a route. */
function installModule(root: string, id: string, options: { backend?: boolean } = {}): void {
  const dir = join(root, 'node_modules', SCOPE, `mod-${id}`);
  write(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `${SCOPE}/mod-${id}`,
      version: '1.0.0',
      endora: { type: 'module', id },
      exports: {
        '.': './dist/manifest.js',
        ...(options.backend === false ? {} : { './backend': './dist/backend/index.js' }),
      },
    }),
  );
  write(join(dir, 'dist', 'manifest.js'), `export const manifest = { id: '${id}' };\n`);
  if (options.backend === false) return;
  write(
    join(dir, 'dist', 'backend', 'index.js'),
    `export function registerModule(ctx) {\n` +
      `    ctx.di.register({ ${id}Service: ctx.asClass(Service).singleton() });\n` +
      `    ctx.di.providePort('${id}ReadPort', ctx.asClass(Service).singleton());\n` +
      `}\n`,
  );
  write(
    join(dir, 'dist', 'backend', 'routes.js'),
    `export function register${id}Routes(app) {\n` +
      `    app.get('/api/v1/admin/${id}/items', async () => ({}));\n` +
      `}\n`,
  );
}

const DECLARATION = `export const divergence = {
  omittedModules: [],
  decorationOrder: {},
  reasons: {
    'decoration:acme_overlay:blogService':
      'Core resolves a post body straight out of the row; we prefix it with the contract id ' +
      'so support can tell which tenant a cached page came from.',
    'port-consumed:acme_overlay:blogReadPort':
      'We read the published port rather than the table, so a schema change behind it does ' +
      'not reach this deployment.',
  },
} as const;
`;

const OVERLAY = `import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';

export function registerModule(ctx: ModuleContext): void {
  ctx.di.decorate<Body>('blogService', (inner) => wrap(inner));
  const posts = lazyPort<BlogReadPort>(ctx, 'blogReadPort');
  void posts;
}
`;

/** A scaffolded instance with a deployment of its own. */
function instance(
  options: {
    overlay?: boolean;
    platform?: boolean;
    declaration?: string;
    apps?: boolean;
    admin?: boolean;
  } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'divergence-'));
  scratch.push(root);
  write(
    join(root, 'pnpm-workspace.yaml'),
    `packages:\n  - backend\n${options.admin === true ? '  - admin\n' : ''}`,
  );
  write(join(root, 'package.json'), JSON.stringify({ name: 'acme', private: true }));
  write(join(root, 'backend', 'package.json'), JSON.stringify({ name: 'acme-backend' }));
  if (options.admin === true) {
    write(join(root, 'admin', 'package.json'), JSON.stringify({ name: 'acme-admin' }));
    write(
      join(root, 'admin', 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }),
    );
    write(join(root, 'admin', 'src', 'main.tsx'), '// the entry point\n');
  }
  if (options.apps !== false) {
    write(join(root, 'apps', 'acme', 'divergence.ts'), options.declaration ?? DECLARATION);
    if (options.overlay !== false) {
      write(join(root, 'apps', 'acme', 'modules', 'acme_overlay', 'backend.ts'), OVERLAY);
    } else {
      mkdirSync(join(root, 'apps', 'acme', 'modules'), { recursive: true });
    }
  }
  installModule(root, 'blog');
  if (options.platform !== false) installPlatform(root);
  return root;
}

describe('the instance host derives what this repository derives', () => {
  it('records the deployment’s own seams, attributed to the installed package that owns them', () => {
    const root = instance();
    const [report] = renderInstanceDivergence({ root, packages: installedOf(root) });
    expect(report?.deployment).toBe('acme');
    expect(report?.overlayModules).toEqual(['acme_overlay']);
    const json = JSON.parse(
      report!.renderings.find((rendering) => rendering.outputPath.endsWith('.json'))!.content,
    ) as { entries: ReadonlyArray<{ kind: string; subject: string; owner: string | null; reason: string }> };
    const decoration = json.entries.find((entry) => entry.kind === 'decoration');
    // The owner comes out of the package's **compiled** `./backend` artefact,
    // which is the whole question the move had to answer: a `dist` carries
    // `ctx.di.register({ blogService: … })` exactly as its source does.
    expect(decoration).toMatchObject({ subject: 'blogService', owner: 'blog' });
    expect(decoration?.reason).toContain('contract id');
    expect(json.entries.find((entry) => entry.kind === 'port-consumed')).toMatchObject({
      subject: 'blogReadPort',
      owner: 'blog',
    });
    // And no finding: every derived entry has its sentence and every sentence a
    // divergence, which is `check:divergence`'s two-way pair asked of a client.
    expect(report?.findings).toEqual([]);
  });

  it('a name the platform’s composition root registers is a root’s, not nobody’s', () => {
    const root = instance({
      declaration: `export const divergence = {
  omittedModules: [],
  decorationOrder: {},
  reasons: { 'decoration:acme_overlay:commandBus': 'We audit every write into our own ledger.' },
};
`,
    });
    write(
      join(root, 'apps', 'acme', 'modules', 'acme_overlay', 'backend.ts'),
      `import type { ModuleContext } from '@endora-commerce/platform/kernel';
export function registerModule(ctx: ModuleContext): void {
  ctx.di.decorate<Bus>('commandBus', (inner) => wrap(inner));
}
`,
    );
    const [report] = renderInstanceDivergence({ root, packages: installedOf(root) });
    const json = JSON.parse(
      report!.renderings.find((rendering) => rendering.outputPath.endsWith('.json'))!.content,
    ) as { entries: ReadonlyArray<{ subject: string; owner: string | null }> };
    expect(json.entries).toContainEqual(expect.objectContaining({ subject: 'commandBus', owner: null }));
    // `unowned-subject` is the finding this discriminates against, and it is the
    // one an instance would raise for every decoration if the platform's own
    // registrations were not read.
    expect(report?.findings).toEqual([]);
  });

  it('reads `ModuleContext`’s members out of the platform’s emitted declarations', () => {
    const root = instance();
    const seams = seamsFromKernel(
      join(root, 'node_modules', SCOPE, 'platform', 'dist', 'kernel', 'index.js'),
    );
    expect(seams).toContain('di.decorate');
    expect(seams).toContain('interceptors');
    // The `di` property contributes its three **methods** and never itself, and
    // `module` — an inline object of two properties — contributes itself.
    expect(seams).not.toContain('di');
    expect(seams).toContain('module');
  });
});

describe('what the instance cannot derive, the artefact says', () => {
  it('states the attribution narrowing in the report’s own boundary', () => {
    const root = instance();
    const [report] = renderInstanceDivergence({ root, packages: installedOf(root) });
    const markdown = report!.renderings.find((r) => r.outputPath.endsWith('.md'))!.content;
    expect(markdown).toContain('the module behind a container name the platform registers on its behalf');
    expect(markdown).toContain('published `./backend` artefact');
    // FR-018's field, not a comment in a source file the client never opens.
    const json = JSON.parse(
      report!.renderings.find((r) => r.outputPath.endsWith('.json'))!.content,
    ) as { boundary: { notRecorded: ReadonlyArray<{ seam: string }> } };
    expect(json.boundary.notRecorded.map((entry) => entry.seam)).toContain(
      'the module behind a container name the platform registers on its behalf',
    );
  });

  it('renders markdown and JSON, never a typed module naming a type it cannot import', () => {
    const root = instance();
    const [report] = renderInstanceDivergence({ root, packages: installedOf(root) });
    expect(report!.renderings.map((rendering) => rendering.outputPath)).toEqual([
      join(root, 'apps', 'acme', 'divergence.generated.md'),
      join(root, 'apps', 'acme', 'divergence.generated.json'),
    ]);
    for (const rendering of report!.renderings) {
      expect(rendering.content).not.toContain('DivergenceReport');
      expect(rendering.content).not.toContain('./types.js');
    }
  });

  it('names `endora generate` and tells the client to commit it', () => {
    const root = instance();
    const [report] = renderInstanceDivergence({ root, packages: installedOf(root) });
    const markdown = report!.renderings[0]!.content;
    expect(markdown).toContain('endora generate');
    expect(markdown).not.toContain('overlay:divergence');
    // Unlike the other three families: this one is a fact about the client's
    // tree, so the header must not tell its reader not to commit it.
    expect(markdown).not.toContain('do not commit');
    expect(markdown).toContain('commit it');
  });
});

describe('the declaration is read as source text, and an unreadable one is never "empty"', () => {
  it('reads the three fields the scaffold writes', () => {
    const reading = readDivergenceDeclaration(
      `export const divergence = {\n  omittedModules: [],\n  decorationOrder: {},\n  reasons: {},\n} as const;\n`,
      'apps/acme/divergence.ts',
    );
    expect(reading.declaration).toEqual({ omittedModules: [], decorationOrder: {}, reasons: {} });
    expect(reading.unresolved).toEqual([]);
  });

  it('reads a sentence written as a `+` chain, which is how every real one is written', () => {
    const reading = readDivergenceDeclaration(
      `export const divergence = { reasons: { 'a:b:c': 'one ' + 'sentence' } };\n`,
      'apps/acme/divergence.ts',
    );
    expect(reading.declaration.reasons).toEqual({ 'a:b:c': 'one sentence' });
  });

  it('names a computed field rather than reading it as a declaration of nothing', () => {
    const reading = readDivergenceDeclaration(
      `import { REASONS } from './reasons.js';\n` +
        `export const divergence = { omittedModules: [], decorationOrder: {}, reasons: REASONS };\n`,
      'apps/acme/divergence.ts',
    );
    expect(reading.unresolved).toEqual(['reasons (not an object literal)']);
  });

  it('surfaces that through the command, so a client reads it rather than a clean run', async () => {
    const root = instance({
      declaration: `import { REASONS } from './reasons.js';\nexport const divergence = { reasons: REASONS };\n`,
    });
    const result = await runGenerate({ cwd: root });
    const printed = generateReport(result).join('\n');
    expect(printed).toContain('[unreadable-declaration]');
    // And the derivation goes on, so the client sees the divergence that has no
    // sentence too — a report that stopped would tell them less.
    expect(printed).toContain('[undeclared-divergence]');
  });
});

describe('refusals — one per input whose absence makes the report vacuously clean', () => {
  it('refuses an instance whose platform does not resolve', () => {
    const root = instance({ platform: false });
    expect(() => renderInstanceDivergence({ root, packages: installedOf(root) })).toThrow(
      DivergenceHostError,
    );
  });

  it('refuses a package that publishes a `./backend` subpath with nothing behind it', () => {
    const root = instance();
    rmSync(join(root, 'node_modules', SCOPE, 'mod-blog', 'dist', 'backend'), {
      recursive: true,
      force: true,
    });
    expect(() => renderInstanceDivergence({ root, packages: installedOf(root) })).toThrow(
      /could not be read/,
    );
  });

  it('a package publishing no `./backend` at all is readable and empty, not a refusal', () => {
    const root = instance();
    installModule(root, 'pwa', { backend: false });
    const scan = instanceComposition({
      packages: installedOf(root),
      platform: { dir: join(root, 'node_modules', SCOPE, 'platform'), exports: new Map([['./kernel', './dist/kernel/index.js']]) },
    });
    expect(scan.unreadable).toEqual([]);
    expect(scan.expected).toBe(1);
    expect(scan.covered).toBe(1);
  });

  it('an instance with no `apps/` tree is an omission the command names, not a refusal', async () => {
    // With an admin member, so the run has something else to render: the point
    // is that an absent deployment is *named* rather than that it is fatal.
    const root = instance({ apps: false, admin: true });
    expect(instanceDeployments(root)).toEqual([]);
    const result = await runGenerate({ cwd: root });
    expect(result.divergence).toEqual([]);
    expect(generateReport(result).join('\n')).toContain('no `apps/<deployment>/` tree');
  });

  it('a deployment with an empty `modules/` tree still gets a report — an empty one is a statement', async () => {
    const root = instance({
      overlay: false,
      declaration: `export const divergence = { omittedModules: [], decorationOrder: {}, reasons: {} };\n`,
    });
    const result = await runGenerate({ cwd: root });
    expect(result.divergence).toHaveLength(1);
    const markdown = readFileSync(
      join(root, 'apps', 'acme', 'divergence.generated.md'),
      'utf8',
    );
    expect(markdown).toContain('No overlay modules.');
    expect(markdown).toContain('That is a statement rather than an absence');
  });
});

describe('the command writes them beside the deployment they describe', () => {
  it('renders on a real run and writes nothing on a dry one', async () => {
    const root = instance();
    const dry = await runGenerate({ cwd: root, dryRun: true });
    expect(dry.divergence).toHaveLength(1);
    expect(generateReport(dry).join('\n')).toContain('would write apps/acme/divergence.generated.md');
    expect(() => readFileSync(join(root, 'apps', 'acme', 'divergence.generated.md'), 'utf8')).toThrow();

    const wet = await runGenerate({ cwd: root });
    expect(readFileSync(join(root, 'apps', 'acme', 'divergence.generated.md'), 'utf8')).toContain(
      '# Divergence from core: `acme`',
    );
    expect(generateReport(wet).join('\n')).toContain('Commit it: it is a fact about your tree');
  });

  it('refuses a headless instance with no deployment either — exit 2 is not this one’s class', async () => {
    const root = instance({ apps: false });
    // No admin, no docs, no deployment: nothing to render, and the remedy is the
    // operator's, so it is exit 1 and not 2.
    await expect(runGenerate({ cwd: root })).rejects.toThrow(/no `apps\/<deployment>\/` tree/);
  });

  it('an unreadable composition stops the whole command — exit 2, never a partial render', async () => {
    const root = instance({ platform: false });
    await expect(runGenerate({ cwd: root })).rejects.toThrow(GenerateHostError);
  });
});

/** The installed module packages, as the command reads them. */
function installedOf(root: string): readonly ModulePackage[] {
  return installedModulePackages(root);
}
