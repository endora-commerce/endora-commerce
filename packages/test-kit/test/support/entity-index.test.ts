/**
 * `./support`'s entity-index half — the helper and the index's *type*, and
 * nothing that names a module (feature 109, T065; `contracts/test-kit-package.md`
 * R2.2, FR-001).
 *
 * ## What is being separated, and why the kit may hold only one side of it
 *
 * An entity index is *which modules this deployment installed, and which entity
 * classes each of them published*. The second half is a fact about a package;
 * the **first** is a fact about one host's `node_modules`, and it is the single
 * fact a package that may name no module is forbidden to know. So the kit
 * carries the **shape** — {@link InstalledEntityIndex} — and the **lookup** —
 * {@link entityNamedIn} — and the population arrives as an argument, rendered
 * by the host's own generator (`@endora-commerce/cli/lib/entity-index-artefact.js`).
 *
 * That is `module-package-layout.md` R10's closing paragraph read from the other
 * side: `backend/test/helpers/package-entities.ts` is permanently host-owned
 * because it *is* a population, and the successor that gives a stranger's host
 * an index is a generated per-host artefact plus this.
 *
 * ## The fixtures enter at the top
 *
 * Issue #130. Nothing below hands the helper a pre-resolved class: every case
 * builds a real array of real classes, in the shape a module package's `./backend`
 * publishes it, and asks for one by name.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  entityNamedIn,
  ModuleNotInstalledError,
  type InstalledEntityIndex,
} from '../../src/support/index.js';

/** A module package's entity class, as a published `entities` array holds it. */
class Widget {
  id!: string;
  sku!: string;
}

class WidgetRevision {
  id!: string;
  widget!: Widget;
}

class Invoice {
  id!: string;
  total!: number;
}

/** What one host's generator emits: module id → that module's published array. */
const index: InstalledEntityIndex = {
  widgets: [Widget, WidgetRevision],
  billing: [Invoice],
};

describe('entityNamedIn', () => {
  it('returns the very class the installed module published, never a copy', () => {
    // Identity, not structural equality: D-160.6.1's whole point is that the
    // ORM keys its metadata on the class object, so a second copy of a
    // structurally identical class is a class it never discovered.
    expect(entityNamedIn<Widget>(index, 'widgets', 'Widget')).toBe(Widget);
    expect(entityNamedIn<WidgetRevision>(index, 'widgets', 'WidgetRevision')).toBe(WidgetRevision);
    expect(entityNamedIn<Invoice>(index, 'billing', 'Invoice')).toBe(Invoice);
  });

  it('builds a row of the class it returned', () => {
    const Klass = entityNamedIn<Widget>(index, 'widgets', 'Widget');
    const row = new (Klass as unknown as new () => Widget)();
    row.id = 'w-1';
    row.sku = 'SKU-1';
    expect(row).toBeInstanceOf(Widget);
    expect(row.sku).toBe('SKU-1');
  });

  it('resolves by name and never by position', () => {
    // A tuple index compiles for any ordering, so re-ordering the array in the
    // package would silently re-point every caller at another table.
    const reordered: InstalledEntityIndex = { widgets: [WidgetRevision, Widget] };
    expect(entityNamedIn<Widget>(reordered, 'widgets', 'Widget')).toBe(Widget);
  });

  it('refuses a module this host did not install, naming the ones it did', () => {
    let thrown: unknown;
    try {
      entityNamedIn(index, 'shipments', 'Shipment');
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ModuleNotInstalledError);
    const error = thrown as ModuleNotInstalledError;
    expect(error.moduleId).toBe('shipments');
    expect(error.installed).toEqual(['billing', 'widgets']);
    // The subject and the remedy, `cli-surface.md` §2's requirement of every
    // refusal: which module was asked for, which this host has, and the one
    // action that changes the answer.
    expect(error.message).toContain("'shipments'");
    expect(error.message).toContain('billing');
    expect(error.message).toContain('widgets');
    expect(error.message).toMatch(/install/i);
  });

  /**
   * An inherited property is not an installed module.
   *
   * The index is a plain object rendered by a generator, so `index['toString']`
   * answers with `Function.prototype.toString` — a value, and therefore a
   * truthy one. Without an own-property test the lookup would then call
   * `entityNamed` with a function where an array belongs and fail somewhere
   * else, or worse, on a `constructor` key, succeed at finding nothing.
   */
  it('refuses a prototype key rather than reading one', () => {
    for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(() => entityNamedIn(index, key, 'Widget')).toThrow(ModuleNotInstalledError);
    }
  });

  it('refuses a class the installed module does not publish, naming the module', () => {
    // Delegated to the platform's own `entityNamed` — one lookup, one message,
    // and the `source` it prints says which module was asked.
    expect(() => entityNamedIn(index, 'billing', 'Widget')).toThrow(/billing/);
    expect(() => entityNamedIn(index, 'billing', 'Widget')).toThrow(/Invoice/);
  });

  it('accepts an empty index and says so rather than reading undefined', () => {
    // Seven of this repository's own module packages publish an empty
    // `entities` array, and a host that installed no module at all has an empty
    // index. Both are legal states with loud answers.
    expect(() => entityNamedIn({}, 'widgets', 'Widget')).toThrow(ModuleNotInstalledError);
    expect(() => entityNamedIn({ widgets: [] }, 'widgets', 'Widget')).toThrow(/empty/);
  });
});

/**
 * The source half of *"the kit names no module"*.
 *
 * `manifest-names-no-module.test.ts` asks the manifest; this asks the **source
 * text** of the file that would be tempted, and it is the file that would be
 * tempted because the whole subject is a population of module packages. The
 * estate's instrument for this is `kit-names-a-module` (contract §7, T052) and
 * it does not exist yet; until it does, the one file whose defect it would catch
 * carries the assertion itself rather than nothing.
 */
describe('the entity index names no module package', () => {
  it('holds no module specifier and no module id', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '..', '..', 'src', 'support', 'entity-index.ts'), 'utf8');
    // A module package is `@endora-commerce/mod-<id>` — the naming rule
    // `manifests:generate` renders, not a list of today's modules.
    expect(source).not.toMatch(/@endora-commerce\/mod-/);
    // And no `entities` array named after one: a default, a fallback or an
    // example would each put one module's id into a package that may know none.
    expect(source).not.toMatch(/\bcatalog\b|\borders\b|\bquote_requests\b/);
  });
});
