import { describe, expect, it } from 'vitest';

import {
  checkQueueNames,
  QUEUE_NAME_CLASSES,
  remedyFor,
  type QueueNamesResult,
} from '../../../scripts/check-queue-names.js';

/**
 * `check:queue-names` — a BullMQ queue name may not contain `:`.
 *
 * The defect it was written from is `comarch_xl`'s three queues, named
 * `comarch_xl:detect` / `:sync` / `:shop-export`. BullMQ owns `:` as its Redis
 * key-namespace separator and `new QueueBase` throws
 * `Queue name cannot contain :` before it reaches Redis, so `startWorkers`
 * threw, the plugin never finished loading, and the backend never listened.
 * `boot-gate` reported *"the positive container never logged backend
 * listening"*, `acceptance:package-schema` A6 reported **inconclusive** with
 * the throw in its *gate-off* phase, and neither named a queue.
 *
 * Every fixture below enters as **source text** — the top of the analysis
 * (issue #130). The resolution chain is the whole of what makes the check see
 * the real defect: `comarch_xl` does not write the name at the construction
 * site, it writes `new Queue(COMARCH_XL_DETECT_QUEUE, …)`, so a proof handing
 * in a resolved name would exercise the predicate and leave the resolver — the
 * part that could stop working — unproven.
 */

const run = (sources: Record<string, string>): QueueNamesResult =>
  checkQueueNames({ sources: new Map(Object.entries(sources)) });

const BULLMQ_IMPORT = "import { Queue, Worker } from 'bullmq';\n";

describe('check:queue-names — the colon', () => {
  it('refuses a literal queue name containing a colon', () => {
    const result = run({
      'modules/inventory/queues/sync-queue.ts':
        `${BULLMQ_IMPORT}export const q = new Queue('inventory:sync', { connection });`,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.kind).toBe('colon-in-queue-name');
    expect(result.findings[0]?.name).toBe('inventory:sync');
    expect(result.sites[0]?.resolution).toBe('literal');
  });

  it('refuses a name reached through a constant in the same file — the real defect', () => {
    // `comarch_xl`'s shape, byte for byte in its essentials: the literal is on
    // a `const` and the construction names the identifier. A check keyed on the
    // construction site's text alone sees `COMARCH_XL_DETECT_QUEUE` and nothing
    // wrong with it.
    const result = run({
      'modules/comarch_xl/queues/xl-sync-queues.ts':
        `${BULLMQ_IMPORT}` +
        "export const COMARCH_XL_DETECT_QUEUE = 'comarch_xl:detect';\n" +
        'export function createDetectQueue(redis) {\n' +
        '  return new Queue(COMARCH_XL_DETECT_QUEUE, { connection: redis });\n' +
        '}',
    });

    expect(result.findings).toHaveLength(1);
    expect(result.sites[0]?.resolution).toBe('same-file-constant');
    // The remedy points at the declaration, not at the construction: that is
    // where the rename goes, and a message pointing at the `new Queue(` line
    // sends the reader to a line with no string in it.
    expect(result.sites[0]?.declaredAt).toBe(
      'modules/comarch_xl/queues/xl-sync-queues.ts:2',
    );
  });

  it('refuses a name reached through a constant imported from another file', () => {
    // `infakt`'s shape: `workers/queue-names.ts` declares and the worker file
    // constructs. One hop, and the specifier is the ESM-correct `.js`.
    const result = run({
      'modules/infakt/workers/queue-names.ts':
        "export const INFAKT_DELIVERY_QUEUE = 'infakt:delivery';",
      'modules/infakt/workers/delivery-worker.ts':
        `${BULLMQ_IMPORT}` +
        "import { INFAKT_DELIVERY_QUEUE } from './queue-names.js';\n" +
        'export const w = new Worker(INFAKT_DELIVERY_QUEUE, processor);',
    });

    expect(result.findings).toHaveLength(1);
    expect(result.sites[0]?.resolution).toBe('imported-constant');
    expect(result.sites[0]?.declaredAt).toBe('modules/infakt/workers/queue-names.ts:1');
    expect(result.sites[0]?.className).toBe('Worker');
  });

  it('accepts the tree’s own convention', () => {
    const result = run({
      'modules/dhl_parcel/queues/tracking-queue.ts':
        `${BULLMQ_IMPORT}` +
        "export const DHL_PARCEL_TRACKING_QUEUE = 'dhl_parcel.tracking';\n" +
        'export const q = new Queue(DHL_PARCEL_TRACKING_QUEUE, { connection });',
    });

    expect(result.findings).toHaveLength(0);
    expect(result.resolved).toHaveLength(1);
  });

  it('suggests the dot spelling of the name it refused', () => {
    const result = run({
      'modules/inventory/queues/sync-queue.ts':
        `${BULLMQ_IMPORT}export const q = new Queue('inventory:sync', {});`,
    });
    const finding = result.findings[0];
    expect(finding).toBeDefined();
    expect(remedyFor(finding as NonNullable<typeof finding>)).toContain('inventory.sync');
  });
});

describe('check:queue-names — what is and is not a site', () => {
  it('follows the import alias rather than the class’s own name', () => {
    const result = run({
      'modules/inventory/queues/sync-queue.ts':
        "import { Queue as BullQueue } from 'bullmq';\n" +
        "export const q = new BullQueue('inventory:sync', {});",
    });

    expect(result.findings).toHaveLength(1);
    // The site reports the *imported* name, so a reader is told which BullMQ
    // class it was whatever the file called it.
    expect(result.sites[0]?.className).toBe('Queue');
  });

  it('is not fooled by a `Queue` that did not come from bullmq', () => {
    // The population is the import, never the identifier: a `Queue` of our own
    // has no `QueueBase` under it and no colon rule.
    const result = run({
      'modules/inventory/services/work-queue.ts':
        "import { Queue } from '../../../lib/priority-queue.js';\n" +
        "export const q = new Queue('inventory:sync');",
    });

    expect(result.sites).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
  });

  it('leaves a permission code alone — the colon is correct in that namespace', () => {
    // `comarch_xl:read` sits three lines from `comarch_xl.detect` in the real
    // module. A rule keyed on "a string with a colon" would refuse the whole
    // permission catalogue.
    const result = run({
      'modules/comarch_xl/routes.admin.ts':
        "const READ_PERMISSION = 'comarch_xl:read';\n" +
        'requireAdmin(READ_PERMISSION);',
    });

    expect(result.sites).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
  });

  it('counts a name it cannot resolve as a site and judges nothing', () => {
    // `createComarchXlWorker(queueName, …)` — the name is a parameter. The site
    // is read, so the read line discloses it, and no finding is invented.
    const result = run({
      'modules/comarch_xl/queues/xl-sync-queues.ts':
        `${BULLMQ_IMPORT}` +
        'export function createWorker(queueName, redis, processor) {\n' +
        '  return new Worker(queueName, processor, { connection: redis });\n' +
        '}',
    });

    expect(result.sites).toHaveLength(1);
    expect(result.sites[0]?.resolution).toBe('unresolved');
    expect(result.resolved).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
  });

  it('does not guess at a template with a substitution', () => {
    const result = run({
      'modules/inventory/queues/sync-queue.ts':
        `${BULLMQ_IMPORT}export const q = new Queue(\`inventory:\${shard}\`, {});`,
    });

    expect(result.sites).toHaveLength(1);
    expect(result.sites[0]?.resolution).toBe('unresolved');
    expect(result.findings).toHaveLength(0);
  });

  it('reads a substitution-free template as the literal it is', () => {
    const result = run({
      'modules/inventory/queues/sync-queue.ts':
        `${BULLMQ_IMPORT}export const q = new Queue(\`inventory:sync\`, {});`,
    });

    expect(result.sites[0]?.resolution).toBe('literal');
    expect(result.findings).toHaveLength(1);
  });

  it('covers every queue-name class the vocabulary names, not only Queue', () => {
    // The set is written down, which is a liability the host's floor answers.
    // What this asserts is that it is *used*: a class in the set that the walk
    // does not recognise at a construction site would make the entry decorative.
    for (const className of QUEUE_NAME_CLASSES) {
      const result = run({
        'modules/inventory/queues/sync-queue.ts':
          `import { ${className} } from 'bullmq';\n` +
          `export const x = new ${className}('inventory:sync', {});`,
      });
      expect(result.findings, `${className} is in the vocabulary but read no site`).toHaveLength(
        1,
      );
    }
  });
});

describe('check:queue-names — the floor the host enforces', () => {
  it('resolves nothing over a tree that constructs no queue', () => {
    // The host exits 2 on this, because *this* tree is known to hold queues: a
    // renamed bullmq export or a walk that stopped reaching the module packages
    // would otherwise print `findings=0` over an unprotected tree (issue #113).
    const result = run({
      'modules/inventory/services/stock-service.ts': 'export class StockService {}',
    });

    expect(result.sites).toHaveLength(0);
    expect(result.resolved).toHaveLength(0);
  });

  it('separates “read a site” from “judged a name”', () => {
    // The floor is keyed on `resolved`, not on `sites`: a run that finds every
    // construction and can resolve none of their names has judged nothing, and
    // `sites > 0` would let it pass.
    const result = run({
      'modules/inventory/queues/sync-queue.ts':
        `${BULLMQ_IMPORT}export const make = (name) => new Queue(name, {});`,
    });

    expect(result.sites).toHaveLength(1);
    expect(result.resolved).toHaveLength(0);
  });
});
