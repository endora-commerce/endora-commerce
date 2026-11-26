import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultComposition } from '../composition/compose-app.js';
import { EventBus } from '../events/index.js';
import { HttpError } from '../http/error-envelope.js';
import { createRootContainer } from '../kernel/container.js';
import { composeModules, type ModuleEntry } from '../kernel/compose.js';
import { activationDeclarationsFrom } from '../kernel/lifecycle/activation-resolver.js';
import { registryCache } from '../kernel/lifecycle/registry-cache.js';
import { assertActivationWritable } from '../lifecycle/commands/activation.commands.js';
import { ModuleDepGraph } from '../lifecycle/services/dep-graph.js';
import { installGatingGraph } from '../lifecycle/services/gating-graph.js';
import type { LoadedManifestRegistry } from '../lifecycle/services/manifest-loader.js';
import {
  LifecycleError,
  ModuleLifecycleOrchestrator,
} from '../lifecycle/services/orchestrator.js';

/**
 * A manifest dependency between two **overlay** modules behaves as between any two
 * modules (`specs/190-overlay-full-modules/` FR-072, T034; `contracts/overlay-ports.md`
 * §4, §6).
 *
 * Nothing in the lifecycle tells an overlay module from a core one — the resolved
 * registry already holds overlay entries — so what this file proves is that the
 * edge arrives: from a **deployment root on disk**, through `defaultComposition`
 * (the composition an instance takes), into the registry and the graph the
 * orchestrator and the activation door read. No hand-built manifest list stands in
 * for the tree (issue #130).
 *
 * `acme_loyalty` publishes a port; `acme_reports` declares it in `dependencies` and
 * resolves the port. The fixture is JavaScript with `type: module`, the spelling a
 * compiled deployment ships, for the reason `default-composition-overlay.test.ts`
 * gives. The orchestrator runs over in-memory stand-ins for its database, Redis and
 * audit log: every refusal below is decided before anything is written.
 */

const DEPLOYMENT = 'acme';
const OWNER = 'acme_loyalty';
const DEPENDENT = 'acme_reports';

const ownerManifest = `export const manifest = {
  id: '${OWNER}',
  name: 'Acme loyalty',
  version: '1.0.0',
  dependencies: [],
  activation: { settingCode: '${OWNER}.enabled', default: true },
};
`;

const ownerBackend = `export function registerModule(ctx) {
  ctx.di.providePort(
    'acmeLoyaltyReadPort',
    ctx.asFunction(() => ({ points: (id) => (id === 'c-1' ? 42 : 0) })).singleton(),
  );
}
`;

const dependentManifest = `export const manifest = {
  id: '${DEPENDENT}',
  name: 'Acme reports',
  version: '1.0.0',
  dependencies: ['${OWNER}'],
  activation: { settingCode: '${DEPENDENT}.enabled', default: true },
};
`;

// Resolved at call time, which is what \`lazyPort\` does: a port is registered
// transient behind its owner's gate, so a singleton may not capture it.
const dependentBackend = `export function registerModule(ctx) {
  ctx.di.register({
    acmeReportsService: ctx
      .asFunction(() => ({
        pointsOf: (id) => ctx.cradle().acmeLoyaltyReadPort.points(id),
      }))
      .singleton(),
  });
}
`;

let deploymentRoot: string;
let overlayEntries: readonly ModuleEntry[];
let overlayManifests: readonly ModuleManifest[];
let registry: LoadedManifestRegistry;

function writeModule(id: string, manifest: string, backend: string): void {
  const dir = join(deploymentRoot, 'apps', DEPLOYMENT, 'modules', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.js'), manifest);
  writeFileSync(join(dir, 'backend.js'), backend);
}

beforeAll(async () => {
  deploymentRoot = mkdtempSync(join(tmpdir(), 'endora-190-overlay-deps-'));
  writeFileSync(join(deploymentRoot, 'package.json'), '{ "type": "module" }\n');
  writeModule(OWNER, ownerManifest, ownerBackend);
  writeModule(DEPENDENT, dependentManifest, dependentBackend);
  const composition = await defaultComposition(deploymentRoot, {
    DEPLOYMENT,
    ENDORA_INSTANCE_ROOT: deploymentRoot,
  });
  const ids = new Set([OWNER, DEPENDENT]);
  overlayEntries = composition.modules.filter((entry) => ids.has(entry.id));
  const resolved = composition.manifests.filter((entry) => ids.has(entry.manifest.id));
  overlayManifests = resolved.map((entry) => entry.manifest);
  registry = {
    modules: new Map(
      resolved.map((entry) => [entry.manifest.id, { manifest: entry.manifest, filePath: entry.filePath }]),
    ),
    graph: new ModuleDepGraph(overlayManifests),
    participants: [],
  };
});

afterAll(() => {
  rmSync(deploymentRoot, { recursive: true, force: true });
  registryCache.__resetForTesting();
});

// ---------------------------------------------------------------------------
// In-memory stand-ins: the orchestrator's row store, lock and audit log.
// ---------------------------------------------------------------------------

interface Row {
  moduleId: string;
  state: string;
  version: string;
}

class RowStore {
  constructor(public rows: Row[]) {}
  async find(_entity: unknown, where: Record<string, unknown> = {}): Promise<Row[]> {
    return this.rows.filter((row) =>
      Object.entries(where).every(([key, value]) => {
        const actual = (row as unknown as Record<string, unknown>)[key];
        if (value !== null && typeof value === 'object' && '$in' in value) {
          return (value as { $in: unknown[] }).$in.includes(actual);
        }
        return actual === value;
      }),
    );
  }
  async findOne(_entity: unknown, where: { moduleId: string }): Promise<Row | null> {
    return this.rows.find((row) => row.moduleId === where.moduleId) ?? null;
  }
}

class Lock {
  private held: string | null = null;
  async set(_key: string, value: string): Promise<'OK' | null> {
    if (this.held !== null) return null;
    this.held = value;
    return 'OK';
  }
  async get(): Promise<string | null> {
    return this.held;
  }
  async eval(_script: string, _n: number, _key: string, value: string): Promise<number> {
    if (this.held === value) this.held = null;
    return 1;
  }
}

function orchestratorOver(rows: Row[]): {
  orchestrator: ModuleLifecycleOrchestrator;
  audit: Array<Record<string, unknown>>;
} {
  const store = new RowStore(rows);
  const audit: Array<Record<string, unknown>> = [];
  return {
    audit,
    orchestrator: new ModuleLifecycleOrchestrator({
      orm: {} as never,
      redis: new Lock() as never,
      em: () => store as never,
      auditLog: { record: async (entry: Record<string, unknown>) => void audit.push(entry) } as never,
      registry,
      migrationOwnership: {
        migrationNamesFor: () => [],
        coveredModuleIds: new Set([OWNER, DEPENDENT]),
      },
      log: { info: () => {}, warn: () => {}, error: () => {} } as never,
    }),
  };
}

async function refusalOf(work: Promise<unknown>): Promise<LifecycleError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof LifecycleError) return error;
    throw error;
  }
  throw new Error('expected a LifecycleError, and the operation went through');
}

const installed = (...ids: string[]): Row[] =>
  ids.map((moduleId) => ({ moduleId, state: 'installed', version: '1.0.0' }));

describe('a dependency between two overlay modules (FR-072)', () => {
  it('reaches the resolved registry from the deployment root, with the edge', () => {
    expect(overlayEntries.map((entry) => [entry.id, entry.overlay])).toEqual([
      [OWNER, true],
      [DEPENDENT, true],
    ]);
    expect(registry.graph.dependentsOf(OWNER)).toEqual([DEPENDENT]);
    const order = registry.graph.topologicalOrder();
    expect(order.indexOf(OWNER)).toBeLessThan(order.indexOf(DEPENDENT));
  });

  it('composes: the dependent resolves the port its sibling provides', () => {
    // `providePort` gates on the owner's effective state, so both are present.
    registryCache.__setEnabledForTesting([OWNER, DEPENDENT]);
    const container = createRootContainer();
    composeModules(overlayEntries, {
      container,
      eventBus: new EventBus(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const reports = container.resolve<{ pointsOf(id: string): number }>('acmeReportsService');
    expect(reports.pointsOf('c-1')).toBe(42);
  });

  it('install refuses the dependent while its sibling is not installed (`missing-deps`)', async () => {
    const { orchestrator, audit } = orchestratorOver([]);
    const refusal = await refusalOf(orchestrator.install(DEPENDENT));
    expect(refusal.kind).toBe('missing-deps');
    expect(refusal.details).toEqual({ missing: [OWNER] });
    expect(refusal.message).toContain(OWNER);
    expect(audit.map((entry) => entry['action'])).toEqual(['module.dependency_blocked']);
  });

  it('disabling the sibling is refused naming the dependent — the platform axis', async () => {
    const { orchestrator } = orchestratorOver(installed(OWNER, DEPENDENT));
    const refusal = await refusalOf(orchestrator.disable(OWNER));
    expect(refusal.kind).toBe('dependents-block');
    expect(refusal.details).toEqual({ dependents: [DEPENDENT] });
    expect(refusal.message).toContain(DEPENDENT);
  });

  it('switching the sibling off is refused naming the dependent — the operator axis', () => {
    registryCache.__setEnabledForTesting([OWNER, DEPENDENT]);
    registryCache.setActivationDeclarations(activationDeclarationsFrom(overlayManifests));
    installGatingGraph(overlayManifests);
    let refusal: unknown = null;
    try {
      assertActivationWritable(OWNER, false);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(HttpError);
    expect((refusal as HttpError).details).toEqual({ moduleId: OWNER, blockedBy: [DEPENDENT] });
    // With the dependent switched off first, the same flip goes through.
    registryCache.__setEnabledForTesting([OWNER, DEPENDENT], { deactivated: [DEPENDENT] });
    expect(assertActivationWritable(OWNER, false)).toBe(`${OWNER}.enabled`);
  });

  it('switching the dependent on is refused while its sibling is off', () => {
    registryCache.__setEnabledForTesting([OWNER, DEPENDENT], { deactivated: [OWNER] });
    registryCache.setActivationDeclarations(activationDeclarationsFrom(overlayManifests));
    installGatingGraph(overlayManifests);
    let refusal: unknown = null;
    try {
      assertActivationWritable(DEPENDENT, true);
    } catch (error) {
      refusal = error;
    }
    expect((refusal as HttpError).details).toEqual({ moduleId: DEPENDENT, missing: [OWNER] });
  });

  it('a hard uninstall of the sibling is refused while the dependent is installed (`dependents-block`)', async () => {
    const { orchestrator } = orchestratorOver(installed(OWNER, DEPENDENT));
    const refusal = await refusalOf(orchestrator.uninstall(OWNER, { hard: true }));
    expect(refusal.kind).toBe('dependents-block');
    expect(refusal.details).toEqual({ dependents: [DEPENDENT] });
  });
});
