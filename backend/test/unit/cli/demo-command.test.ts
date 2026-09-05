import { describe, expect, it } from 'vitest';
import {
  DEMO_HOST_COMMANDS,
  demoEntriesFrom,
  demoHelpFor,
  formatHostCommandList,
  isDemoInvocation,
  parseDemoVerb,
  ShadowedHostCommandError,
} from '../../../src/cli/demo-command.js';
import { UnknownCommandError } from '../../../src/cli/module-commands.js';
import type { ModuleManifest } from '@endora-commerce/contracts';

/**
 * Feature 113 Phase 0 — the host's side of `endora demo seed|reset`
 * (`contracts/module-demo-data-layer.md` §3.1, §3.2).
 *
 * Everything decidable without a database lives here so it can be driven from a
 * test, exactly as `module-commands.ts` splits itself from `cli.ts`. What is
 * **not** here is the guard call, the composition and the scope: those are the
 * entry point's, in that order, and §3.3 is about where they sit relative to
 * each other rather than about anything this file can decide.
 */
function manifest(id: string, demo?: ModuleManifest['demo']): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    dependencies: [],
    ...(demo === undefined ? {} : { demo }),
  } as ModuleManifest;
}

describe('parseDemoVerb (§3.1)', () => {
  it('accepts the two verbs', () => {
    expect(parseDemoVerb('seed')).toBe('seed');
    expect(parseDemoVerb('reset')).toBe('reset');
  });

  it('refuses anything else, naming what it does offer', () => {
    expect(() => parseDemoVerb('wipe')).toThrow(UnknownCommandError);
    expect(() => parseDemoVerb('wipe')).toThrow(/seed, reset/);
  });

  it('refuses a missing verb rather than choosing one', () => {
    expect(() => parseDemoVerb(undefined)).toThrow(UnknownCommandError);
  });
});

describe('isDemoInvocation', () => {
  it('recognises the host verb', () => {
    expect(isDemoInvocation('demo')).toBe(true);
    expect(isDemoInvocation('catalog')).toBe(false);
  });
});

describe('demoEntriesFrom — the runner\'s input (§3.5)', () => {
  it('carries each module\'s id, dependencies and demo declaration', () => {
    const entries = demoEntriesFrom([
      { manifest: manifest('catalog') },
      { manifest: { ...manifest('inventory'), dependencies: ['catalog'] } },
      { manifest: manifest('health_checks', false) },
    ]);
    expect(entries).toEqual([
      { id: 'catalog', dependencies: [] },
      { id: 'inventory', dependencies: ['catalog'] },
      { id: 'health_checks', dependencies: [], demo: false },
    ]);
  });

  it('refuses a module whose id shadows the host verb', () => {
    // A module id is `moduleIdRe`, which admits `demo`, and the host verb is
    // read before module dispatch — so such a module's commands would be
    // silently unreachable. Refused rather than shadowed (D-157.8's *"command
    // silently not found"* is the failure mode this whole family avoids).
    expect(() => demoEntriesFrom([{ manifest: manifest('demo') }])).toThrow(
      ShadowedHostCommandError,
    );
  });
});

describe('the listing and the help', () => {
  it('offers exactly the two commands, addressed as the operator types them', () => {
    expect(DEMO_HOST_COMMANDS.map((c) => c.address)).toEqual(['demo seed', 'demo reset']);
  });

  it('formats the host commands in the module listing\'s shape', () => {
    const listing = formatHostCommandList(DEMO_HOST_COMMANDS);
    expect(listing).toContain('demo seed');
    expect(listing).toContain('demo reset');
    expect(listing.endsWith('\n')).toBe(true);
  });

  it('answers `--help` from the declaration alone', () => {
    // The same property `helpFor` has and for the same reason: a tool has to be
    // able to say what it does before it can do it, and this one refuses to run
    // against a production database at all.
    expect(demoHelpFor('seed')).toMatch(/demo seed/);
    expect(demoHelpFor('reset')).toMatch(/demo reset/);
    expect(demoHelpFor('seed')).toMatch(/production/i);
  });
});
