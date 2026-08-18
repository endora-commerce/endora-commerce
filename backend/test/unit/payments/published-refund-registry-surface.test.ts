import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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

const MODULES_ROOT = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  '..',
  'src',
  'modules',
);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
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

  it('publishes no gated pull under a second name', () => {
    const offenders = sources(MODULES_ROOT).filter((file) =>
      readFileSync(file, 'utf8').includes("'gatewayRefundRegistryPort'"),
    );
    expect(offenders, 'the unpublished pull still has a registration').toEqual([]);
  });
});
