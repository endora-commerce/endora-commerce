import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';
import { publishedDocBlock } from '../../helpers/published-port-source.js';

/**
 * D-99.7 — the refund seam publishes the name an implementer resolves, and the
 * gated pull is not published at all.
 *
 * The registry has two directions and they need opposite treatment. The
 * **push** — `gatewayRefundRegistry`, a plain `di.register` — is what the four
 * gateways contribute their handler through from a boot hook, and it is ungated
 * on purpose: a gate there refuses the contribution rather than deferring it.
 * The **pull** was published as `gatewayRefundRegistryPort` and resolved by
 * nobody; an outside author following that doc block would resolve a gated
 * registration from a boot hook and get `process.exit(1)`.
 *
 * A rule stated only in a comment in `payments/backend.ts` ships in no package
 * (D-99.8 item 4), so the asymmetry has to be in the contract.
 */
const CONTRACT = 'payments.ts';
const PORT = 'GatewayRefundRegistryPort';

/**
 * Where modules live is **resolved**, never spelled.
 *
 * This file used to walk `backend/src/modules`, which has held nothing but a
 * `README.md` since every module became a package: the sweep below read zero
 * files and passed, answering "nobody registers the unpublished pull" by not
 * looking. The layout is the derivation the checks use, so a module that moves
 * is followed; the overlay tree is added because a deployment's module can
 * register a name as easily as a core one can.
 */
const layout = await requireModuleLayout('[published-refund-registry-surface]');

/** Every module source file, tests and build output excluded. */
function moduleSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
    }
  };
  for (const root of [...layout.moduleWalkRoots, layout.overlayRoot]) {
    if (existsSync(root)) walk(root);
  }
  return out;
}

/** The files that name `name` as a quoted container key. */
function filesNaming(files: readonly string[], name: string): string[] {
  return files.filter((file) => readFileSync(file, 'utf8').includes(`'${name}'`));
}

describe('the published gateway refund registry surface (D-99.7)', () => {
  it('names the push registration, which is the name an implementer resolves', () => {
    expect(publishedDocBlock(CONTRACT, PORT)).toMatch(
      /Container name: `gatewayRefundRegistry`\. Owner: `payments`\./,
    );
  });

  it('states that the push is ungated and what a gate there would cost', () => {
    const doc = publishedDocBlock(CONTRACT, PORT);
    expect(doc).toMatch(/ungated/i);
    expect(doc).toMatch(/boot hook/i);
    expect(doc).toMatch(/restart/i);
  });

  it('states the absent-owner policy an implementer inherits', () => {
    expect(publishedDocBlock(CONTRACT, PORT)).toContain('pending_manual');
  });

  /**
   * The floor under the sweep below. An empty population satisfies "no
   * offender" trivially, so the walk has to prove it reached the place a
   * registration would be written before its silence means anything: the
   * owner's own composition file, and a consumer that resolves the published
   * name by its quoted key.
   */
  it('sweeps a population that holds the owner and a consumer of the seam', () => {
    const files = moduleSources();
    const owner = layout.moduleDirectoryOf('payments');

    expect(files.length, 'the module walk produced no file').toBeGreaterThan(0);
    expect(owner, '`payments` is not a module the layout knows').not.toBeNull();
    expect(files).toContain(join(owner!, 'src', 'backend', 'index.ts'));
    expect(
      filesNaming(files, 'gatewayRefundRegistry').map((file) => layout.displayOf(file)),
      'nothing in the walk resolves the published name, so the walk cannot see a registration',
    ).not.toEqual([]);
  });

  it('publishes no gated pull under a second name', () => {
    const files = moduleSources();
    // Stated here as well as above: this case must not be green over nothing
    // even when it is the only one selected.
    expect(files.length, 'the module walk produced no file').toBeGreaterThan(0);

    const offenders = filesNaming(files, 'gatewayRefundRegistryPort');
    expect(
      offenders.map((file) => layout.displayOf(file)),
      'the unpublished pull still has a registration',
    ).toEqual([]);
  });
});
