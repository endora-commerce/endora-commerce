/**
 * `endora new instance --without <member>` — the member axis the install wizard
 * drives (`specs/118-instance-member-selection/contracts/instance-members.md`
 * §3.3 R3.5a–d, ruled by D-215; `specs/125-first-mile-install/spec.md` §6.3).
 *
 * ## Why it arrives with the wizard
 *
 * 125's checklist hands the scaffolder `--without <member>` for every row left
 * unchecked (FR-150), and D-215 ruled that flag in 2026-09 while nothing built
 * it. A wizard with no mechanism under its rows would be a checklist that
 * cannot uncheck anything, so the smallest part of 118 the wizard stands on —
 * the flag, its closed vocabulary and its two refusals — is built here and
 * nothing else of that feature is: completion (R3.6), the `generate` agreement
 * report (R2.2) and the doctor's answer (R4.4) stay 118's.
 *
 * ## What each block pins
 *
 * The vocabulary is **the template's**, never a list here or in the wizard
 * (R3.5a, R6.3a); a declined member writes no directory and no package (R3.5c);
 * `backend` and a name outside the vocabulary are refused before anything is
 * resolved (F10, F11); and an omission prints **every** reason that holds
 * (R4.1), because *declined* and *unavailable* have different remedies.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InstanceInputError, runNewInstance } from '../src/new-instance/index.js';
import {
  MEMBER_VOCABULARY,
  memberRefusal,
  planInstance,
  type PlanInput,
} from '../src/new-instance/template.js';

const SCOPE = '@endora-commerce/';

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

/** The plan input with both optional members written — the full instance. */
function fullInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    name: 'acme-shop',
    deployment: 'acme-shop',
    scope: SCOPE,
    platformVersion: '1.2.3',
    enginesNode: '>=22.17.0',
    packageManager: undefined,
    modules: [{ id: 'settings', packageName: `${SCOPE}mod-settings`, version: '0.4.5' }],
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
    adminPeers: new Map([['@measured/puck', '^0.20.0']]),
    cliVersion: '1.2.3',
    docsRanges: new Map([
      ['@docusaurus/core', '^3.10.0'],
      ['@docusaurus/preset-classic', '^3.10.0'],
    ]),
    declaredRanges: new Map([
      ['@mikro-orm/core', '^6'],
      ['@mikro-orm/postgresql', '^6'],
      ['fastify', '^5'],
      ['zod', '^4'],
      ['ioredis', '^5.10.1'],
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

describe('R3.5a — the vocabulary is the template\'s own member set', () => {
  it('names every workspace member the template can write, and the backend is fixed', () => {
    const plan = planInstance(fullInput());
    const written = plan.members.filter((member) => member !== 'root' && member !== 'deployment');
    // Every member a full plan writes is reachable by a `--without` name — the
    // T5 property of 118 §5.7: a member acquires its flag by existing.
    expect(MEMBER_VOCABULARY.map((entry) => entry.name).sort()).toEqual([...written].sort());
    const backend = MEMBER_VOCABULARY.find((entry) => entry.name === 'backend')!;
    expect(backend.fixed).toMatch(/composes the platform/);
    for (const entry of MEMBER_VOCABULARY.filter((row) => row.name !== 'backend')) {
      expect(entry.fixed, `${entry.name} must be declinable`).toBeNull();
    }
  });
});

describe('R3.5c — a declined member writes no directory and no package', () => {
  it('`--without admin` writes no admin/ and no admin package, and keeps the module list', () => {
    const full = planInstance(fullInput());
    const headless = planInstance(fullInput({ without: new Set(['admin']) }));
    expect(headless.members).not.toContain('admin');
    expect(headless.files.some((file) => file.path.startsWith('admin/'))).toBe(false);
    // The optional peers the admin composes are declared at the root only when
    // it is written; declining it removes them with it.
    expect(headless.dependencies.has('@measured/puck')).toBe(false);
    expect(full.dependencies.has('@measured/puck')).toBe(true);
    // R3.5e — the module list is the same list either way.
    const modules = (plan: typeof full): string[] =>
      [...plan.dependencies.keys()].filter((name) => name.startsWith(`${SCOPE}mod-`));
    expect(modules(headless)).toEqual(modules(full));
    // …and the root scripts forget the member too: nothing filters on a
    // directory that is not there.
    const root = JSON.parse(headless.files.find((file) => file.path === 'package.json')!.content) as {
      scripts: Record<string, string>;
    };
    expect(Object.values(root.scripts).join('\n')).not.toMatch(/-C admin\b/);
  });

  it('`--without docs` writes no docs/ member', () => {
    const plan = planInstance(fullInput({ without: new Set(['docs']) }));
    expect(plan.members).not.toContain('docs');
    expect(plan.files.some((file) => file.path.startsWith('docs/'))).toBe(false);
    expect(plan.members).toContain('admin');
  });

  it('no `--without` at all is byte-identical to an empty one (R6.3b\'s other half)', () => {
    expect(planInstance(fullInput({ without: new Set() })).files).toEqual(
      planInstance(fullInput()).files,
    );
  });
});

describe('R4.1 — an omission names every reason that holds', () => {
  it('declined alone reads as a choice, with its own remedy', () => {
    const plan = planInstance(fullInput({ without: new Set(['admin']) }));
    const omission = plan.omitted.find((entry) => entry.path === 'admin/')!;
    expect(omission.reason).toContain('declined: you passed --without admin');
    expect(omission.reason).not.toContain('unavailable');
  });

  it('declined and unavailable at once prints both', () => {
    const plan = planInstance(
      fullInput({ without: new Set(['admin']), adminShellVersion: null }),
    );
    const omission = plan.omitted.find((entry) => entry.path === 'admin/')!;
    expect(omission.reason).toContain('declined');
    expect(omission.reason).toContain('unavailable');
    expect(omission.reason).toContain(`${SCOPE}admin-shell`);
  });
});

describe('F10 / F11 — the two refusals, before anything is resolved', () => {
  it('F11 — `--without backend` is refused with the topology remedy', () => {
    const refusal = memberRefusal(['backend']);
    expect(refusal).toContain('--without backend');
    expect(refusal).toContain('second host');
  });

  it('F10 — a name outside the vocabulary is refused naming the vocabulary', () => {
    const refusal = memberRefusal(['search']);
    for (const entry of MEMBER_VOCABULARY) expect(refusal).toContain(entry.name);
  });

  it('F10 — `storefront` is not a member, and the refusal names the command that writes it', () => {
    const refusal = memberRefusal(['storefront']);
    expect(refusal).toContain('endora new storefront');
    expect(refusal).toContain('--no-storefront');
  });

  it('a vocabulary name is no refusal, and neither is nothing', () => {
    expect(memberRefusal(['admin', 'docs'])).toBeNull();
    expect(memberRefusal([])).toBeNull();
  });

  it('`runNewInstance` refuses under its own class, having written nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ni-members-'));
    scratch.push(root);
    for (const [without, refusal] of [
      [['backend'], 'F11'],
      [['storefront'], 'F10'],
    ] as const) {
      const thrown = await runNewInstance({ dir: join(root, 'shop'), cwd: root, without }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(thrown).toBeInstanceOf(InstanceInputError);
      expect((thrown as InstanceInputError).refusal).toBe(refusal);
    }
  });
});
