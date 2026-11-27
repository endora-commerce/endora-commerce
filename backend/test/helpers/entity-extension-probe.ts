import { asValue } from 'awilix';
import { vi } from 'vitest';
import { z } from 'zod';
import type { MikroORM } from '@mikro-orm/postgresql';
import {
  EntityExtensionLoaderRegistry,
  composeModules,
  createEntityExtensionReads,
  createRootContainer,
  type KernelContainer,
} from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
import type { EntityExtensionReads } from '@endora-commerce/platform/kernel';

/**
 * A side-table extension probe for a host read port's contract test
 * (`specs/187-side-table-extensions/` Phase B2, FR-054 – FR-058).
 *
 * The module `acme_probe` declares `extends` on one host and registers one
 * loader through `ctx.entityExtensionLoaders`, composed by `composeModules`
 * against a real `EntityExtensionLoaderRegistry`, exactly as a root composes a
 * module. Its loader issues **one** statement per call, tagged
 * `/* acme_probe *\/` so a test can count it, and answers `{ marker }` for each
 * id it was handed that the host table holds. It reads the host table rather
 * than a side table of its own so that the shared run database gains no table;
 * what is under test is the host port — which ids it hands over, on which
 * entity manager, and what it returns — not the loader.
 *
 * {@link withProbeReads} lets the composition's **real** port use it: the port
 * resolves `entityExtensionReads` from the container per read
 * (`lazyEntityExtensionReads`), so the probe's reads service is registered under
 * that name for the duration of a call and the kernel's is put back after.
 */

export const PROBE_MODULE = 'acme_probe';
export const ProbeValueSchema = z.object({ marker: z.string() });

export interface EntityExtensionProbe {
  readonly reads: EntityExtensionReads;
  /** The ids of each loader call, in order. */
  readonly calls: string[][];
  /** Whether `acme_probe` is present; flip it to observe the off state. */
  present: boolean;
}

export function entityExtensionProbe(host: string, hostTable: string): EntityExtensionProbe {
  const calls: string[][] = [];
  const registry = new EntityExtensionLoaderRegistry({
    declarations: [{ moduleId: PROBE_MODULE, entity: host, table: `${PROBE_MODULE}_refs` }],
  });
  composeModules(
    [
      {
        id: PROBE_MODULE,
        version: '1.0.0',
        registerModule: (ctx) =>
          ctx.entityExtensionLoaders([
            {
              host,
              schema: ProbeValueSchema,
              load: async (ids, { em }) => {
                calls.push([...ids]);
                const rows = (await em
                  .getConnection()
                  .execute(`select "id" from "${hostTable}" /* ${PROBE_MODULE} */ where "id" in (?)`, [ids])) as {
                  id: string;
                }[];
                return new Map(rows.map((row) => [row.id, { marker: `probe:${row.id}` }]));
              },
            },
          ]),
      },
    ],
    {
      container: createRootContainer(),
      eventBus: new EventBus(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
      entityExtensionLoaderRegistry: registry,
    },
  );
  const probe: EntityExtensionProbe = {
    calls,
    present: true,
    reads: createEntityExtensionReads({
      registry,
      state: { isPresent: (moduleId) => moduleId !== PROBE_MODULE || probe.present },
    }),
  };
  return probe;
}

/** Run `body` with the probe's reads service as the composition's `entityExtensionReads`. */
export async function withProbeReads<T>(
  container: KernelContainer,
  probe: EntityExtensionProbe,
  body: () => Promise<T>,
): Promise<T> {
  const kernel = container.resolve<EntityExtensionReads>('entityExtensionReads');
  container.register({ entityExtensionReads: asValue(probe.reads) });
  try {
    return await body();
  } finally {
    container.register({ entityExtensionReads: asValue(kernel) });
  }
}

/** The statements `run` issued on `orm`, and its answer. */
export async function statementsOf<T>(orm: MikroORM, run: () => Promise<T>): Promise<{ result: T; statements: string[] }> {
  const logger = orm.config.getLogger();
  const spy = vi.spyOn(logger, 'logQuery');
  try {
    const result = await run();
    return { result, statements: spy.mock.calls.map(([context]) => String(context.query)) };
  } finally {
    spy.mockRestore();
  }
}

/** The probe loader's statements among `statements`. */
export const probeStatements = (statements: readonly string[]): string[] =>
  statements.filter((statement) => statement.includes(`/* ${PROBE_MODULE} */`));
