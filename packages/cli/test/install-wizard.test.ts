/**
 * The install wizard — `endora install`'s questions, asked only on a terminal
 * (`specs/125-first-mile-install/spec.md` §6, FR-145…FR-152, SC-107, SC-108;
 * `tasks.md` Phase 4, T4-B…T4-I).
 *
 * ## The permission, and the owner's acceptance it rests on
 *
 * `cli-product.md` R2.5f — 125's PR-1(b), accepted by the owner on 2026-09-25
 * (`specs/136-open-source-publication/spec.md`: *"so are 125's PR-1 … PR-4 as
 * recommended"*) and placed as D-269. Its five clauses are asserted below; the
 * spawned half of T4-A — a real pseudo-terminal, because a hang is only
 * observable from outside the process — is `install-wizard-tty.test.ts`.
 *
 * ## How the cases drive it
 *
 * In process, with the two seams `runInstall` takes for exactly this: the
 * interactivity facts (so a case says *"both descriptors are terminals"*
 * without being on one) and the streams (so the answers are a string written
 * to a `PassThrough`). The pipeline runner is the recorder `install.test.ts`
 * uses, so nothing here runs a package manager.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { runInstall, type InstallStep } from '../src/install/index.js';
import {
  INSTALL_QUESTIONS,
  answersLine,
  askWizard,
  checklistRows,
  selectionToFlags,
} from '../src/install/wizard.js';
import { runNewInstance } from '../src/new-instance/index.js';
import { MEMBER_VOCABULARY } from '../src/new-instance/template.js';
import { main } from '../src/bin/endora.js';

import { ADMIN, cleanScratch, host } from './support/install-host.js';

afterEach(cleanScratch);

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Both descriptors terminals, nothing suppressing the questions. */
const AT_A_TERMINAL = {
  stdinIsTty: true,
  stdoutIsTty: true,
  nonInteractive: false,
  dryRun: false,
  environment: {},
} as const;

/** A terminal the answers are typed into, and the screen they are read off. */
function terminal(answers: readonly string[]): {
  readonly io: { input: PassThrough; output: PassThrough; terminal: false };
  readonly screen: () => string;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk: Buffer) => (text += chunk.toString()));
  input.end(answers.map((line) => `${line}\n`).join(''));
  return { io: { input, output, terminal: false }, screen: () => text };
}

function recorder(): { readonly steps: InstallStep[]; readonly run: (step: InstallStep) => Promise<number> } {
  const steps: InstallStep[] = [];
  return { steps, run: async (step) => (steps.push(step), 0) };
}

const NO_STOREFRONT_HERE = {
  available: false,
  reason: 'copied out of a checkout of the platform repository, and there is none here',
};

/** Every file under a tree, relative, with `.env`'s generated values masked. */
function snapshot(root: string, generated: readonly string[]): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else {
        let text = readFileSync(path, 'utf8');
        for (const name of generated) {
          text = text.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=<generated>`);
        }
        files.set(relative(root, path), text);
      }
    }
  };
  walk(root);
  return files;
}

describe('T4-A — at a terminal, with no flags, it asks §6.2\'s questions in order', () => {
  it('asks all seven, Enter takes a recommendation, and the demo question has none', async () => {
    const { io, screen } = terminal([
      '', // Q1 — the recommended directory
      '', // Q2 — every part
      '', // Q3 — yes, start the services
      '', // Q4 — no Enter answer (PR-2 (c)): it asks again
      'n',
      'owner@example.com',
      'a-password-they-remember',
      'Ada',
      'Lovelace',
    ]);
    const outcome = await askWizard({}, io, {
      vocabulary: MEMBER_VOCABULARY,
      storefront: NO_STOREFRONT_HERE,
    });
    const text = screen();
    const order = [
      'Where should the instance go?',
      'Which parts do you want?',
      'Start PostgreSQL, Redis, Meilisearch and a mail catcher',
      'Install demo data?',
      'Administrator e-mail',
      'Administrator password',
      'Administrator first name',
      'Administrator last name',
    ].map((question) => text.indexOf(question));
    expect(order.every((index) => index >= 0), text).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // D-269 / 125 PR-2 (c) — Enter on the demo question is not an answer: it
    // was asked twice, and the answer is the one typed.
    expect(text.split('Install demo data?').length - 1).toBe(2);
    expect(outcome.answers).toMatchObject({
      dir: './endora-commerce',
      without: [],
      storefront: false,
      services: true,
      demo: false,
      adminEmail: 'owner@example.com',
      adminFirstName: 'Ada',
      adminLastName: 'Lovelace',
    });
    expect(outcome.recommended).toEqual(['directory', 'parts', 'services']);
  });

  it('answers that stop arriving are a refusal naming the flag, never a wait', async () => {
    const { io } = terminal(['', '', '']);
    await expect(
      askWizard({}, io, { vocabulary: MEMBER_VOCABULARY, storefront: NO_STOREFRONT_HERE }),
    ).rejects.toThrow(/--demo \/ --no-demo/);
  });
});

describe('T4-B / SC-107 — the question set is the flag set, and both reach one tree', () => {
  it('every question in §6.2 has a flag that answers it', () => {
    expect(INSTALL_QUESTIONS.map((question) => question.id)).toEqual([
      'directory',
      'parts',
      'services',
      'demo',
      'admin-email',
      'admin-password',
      'admin-name',
    ]);
    for (const question of INSTALL_QUESTIONS) expect(question.flags.length).toBeGreaterThan(0);
  });

  it('the wizard and `--non-interactive` with the same answers write byte-identical trees', async () => {
    const answersTyped = ['acme-shop', '2', '', 'n', 'y', ...Object.values(ADMIN)];
    const wizardRoot = host();
    const { io } = terminal(answersTyped);
    const wizard = await runInstall({
      cwd: wizardRoot,
      interactivity: AT_A_TERMINAL,
      io,
      dockerReachable: true,
      run: recorder().run,
    });

    const flagsRoot = host();
    const flags = await runInstall({
      dir: 'acme-shop',
      cwd: flagsRoot,
      without: ['docs'],
      storefront: false,
      services: false,
      demo: true,
      ...ADMIN,
      nonInteractive: true,
      dockerReachable: true,
      run: recorder().run,
    });

    expect(wizard.exitCode).toBe(0);
    expect(flags.exitCode).toBe(0);
    const generated = [...wizard.instance.resolved, ...flags.instance.resolved]
      .filter((entry) => entry.provenance === 'generated')
      .map((entry) => entry.name);
    expect(snapshot(wizard.targetDir, generated)).toEqual(snapshot(flags.targetDir, generated));
    expect(wizard.instance.plan.members).not.toContain('docs');
  });
});

describe('T4-C / FR-147 — a supplied flag is reported, not re-asked', () => {
  it('one line names the flags and how many answers they gave; their questions are not asked', async () => {
    const { io, screen } = terminal(['y', 'owner@example.com', 'pw', 'Ada', 'Lovelace']);
    await askWizard(
      { dir: 'acme-shop', services: false, without: ['admin'] },
      io,
      { vocabulary: MEMBER_VOCABULARY, storefront: NO_STOREFRONT_HERE },
    );
    const text = screen();
    const first = text.split('\n')[0]!;
    expect(first).toContain('--without admin');
    expect(first).toContain('--no-services');
    expect(first).toContain('3 of 7 answers came from flags');
    expect(text).not.toContain('Where should the instance go?');
    expect(text).not.toContain('Which parts do you want?');
    expect(text).not.toContain('Start PostgreSQL');
  });
});

describe('T4-D / R6.3a — the checklist is the template\'s member vocabulary', () => {
  it('a member added to the vocabulary appears, pre-checked, with no wizard edit', async () => {
    const vocabulary = [
      ...MEMBER_VOCABULARY,
      { name: 'analytics', describes: 'a member the template gained next year', fixed: null },
    ];
    const { io, screen } = terminal(['', '', '', 'n', 'e@x.io', 'pw', 'A', 'B']);
    const outcome = await askWizard({}, io, { vocabulary, storefront: NO_STOREFRONT_HERE });
    expect(screen()).toMatch(/\d\. \[x\] analytics — a member the template gained next year/);
    expect(outcome.answers.without).toEqual([]);
  });

  it('the wizard names no member of its own', () => {
    const source = readFileSync(join(PACKAGE_ROOT, 'src/install/wizard.ts'), 'utf8');
    for (const member of MEMBER_VOCABULARY) {
      expect(source, `wizard.ts spells the member '${member.name}'`).not.toContain(
        `'${member.name}'`,
      );
    }
  });
});

describe('T4-E / SC-108 — everything checked passes no `--without` at all', () => {
  it('the common case writes the plan a bare `endora new instance <dir>` writes', async () => {
    const wizardRoot = host();
    const { io } = terminal(['acme-shop', '', 'n', 'n', ...Object.values(ADMIN)]);
    const wizard = await runInstall({
      cwd: wizardRoot,
      interactivity: AT_A_TERMINAL,
      io,
      run: recorder().run,
    });
    const bareRoot = host();
    const bare = await runNewInstance({ dir: 'acme-shop', cwd: bareRoot });
    const paths = (files: readonly { path: string }[]): string[] => files.map((file) => file.path);
    expect(paths(wizard.instance.plan.files)).toEqual(paths(bare.plan.files));
    expect(wizard.instance.plan.members).toEqual(bare.plan.members);
    expect(selectionToFlags(checklistRows(MEMBER_VOCABULARY, NO_STOREFRONT_HERE), new Set()).without).toEqual([]);
  });
});

describe('T4-F / FR-152 — no positive selector anywhere, and the backend is a fixed row', () => {
  it('the flag vocabulary holds no positive member selector', async () => {
    for (const flag of ['--only', '--with-admin', '--member', '--headless']) {
      expect(await main(['install', 'x', flag, 'admin'], PACKAGE_ROOT), flag).toBe(1);
    }
  });

  it('`--without backend` stays refused, and the checklist renders the backend unnumbered with its reason', async () => {
    expect(await main(['new', 'instance', 'x', '--without', 'backend'], PACKAGE_ROOT)).toBe(1);
    const { io, screen } = terminal(['', '', '', 'n', 'e@x.io', 'pw', 'A', 'B']);
    await askWizard({}, io, { vocabulary: MEMBER_VOCABULARY, storefront: NO_STOREFRONT_HERE });
    const backendLine = screen()
      .split('\n')
      .find((line) => line.includes('backend —'))!;
    expect(backendLine).not.toMatch(/\d\./);
    expect(backendLine).toContain('composes the platform');
  });
});

describe('T4-G / FR-151 — the storefront row dispatches to the other mechanism', () => {
  it('unchecked is `--no-storefront`, never `--without storefront`', () => {
    const rows = checklistRows(MEMBER_VOCABULARY, { available: true, reason: '' });
    const selection = selectionToFlags(rows, new Set(['storefront', 'admin']));
    expect(selection.storefront).toBe(false);
    expect(selection.without).toEqual(['admin']);
    expect(selection.without).not.toContain('storefront');
  });

  it('where no storefront can be written, the row is fixed and says why', async () => {
    const { io, screen } = terminal(['', '', '', 'n', 'e@x.io', 'pw', 'A', 'B']);
    const outcome = await askWizard({}, io, {
      vocabulary: MEMBER_VOCABULARY,
      storefront: NO_STOREFRONT_HERE,
    });
    const line = screen()
      .split('\n')
      .find((row) => row.includes('storefront —'))!;
    expect(line).toContain('[ ]');
    expect(line).not.toMatch(/\d\./);
    expect(line).toContain('checkout');
    expect(outcome.answers.storefront).toBe(false);
  });
});

describe('T4-H / FR-149 — a `.env` already in the target answers its inputs', () => {
  it('its values are neither asked nor written over', async () => {
    const root = host();
    const target = join(root, 'acme-shop');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.env'), 'DATABASE_URL=postgres://mine@db/acme\n', 'utf8');
    const { io, screen } = terminal(['', 'n', 'n', ...Object.values(ADMIN)]);
    const result = await runInstall({
      dir: 'acme-shop',
      cwd: root,
      interactivity: AT_A_TERMINAL,
      io,
      run: recorder().run,
    });
    expect(result.exitCode).toBe(0);
    expect(screen()).not.toContain('DATABASE_URL');
    expect(readFileSync(join(target, '.env'), 'utf8')).toContain(
      'DATABASE_URL=postgres://mine@db/acme',
    );
  });
});

describe('T4-I — no new runtime dependency', () => {
  it('`dependencies` is what it was before the wizard', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@endora-commerce/contracts',
      'typescript',
    ]);
  });
});

describe('R2.5f (iv) — an Enter answer is a recommendation, counted and reversible', () => {
  it('the `[answers]` line names each recommendation and keeps `defaulted=0`', async () => {
    const root = host();
    const { io } = terminal(['acme-shop', '', '', 'y', ...Object.values(ADMIN)]);
    const { run } = recorder();
    const result = await runInstall({
      cwd: root,
      interactivity: AT_A_TERMINAL,
      io,
      dockerReachable: true,
      run,
    });
    const text = result.output.join('\n');
    expect(text).toContain(
      '[answers] resolved: total=7 flags=0 prompted=5 recommended=2 (parts, services) defaulted=0',
    );
    // …and the closing block says which answers were recommendations, each
    // with what reverses it.
    expect(text).toContain('pnpm run dev:services:down');
    expect(text).toMatch(/recommend/i);
  });

  it('a non-interactive run accounts for the same seven, all from flags or recommendations', () => {
    expect(
      answersLine({
        fromFlags: new Map([['demo', '--demo']]),
        prompted: [],
        recommended: ['parts'],
      }),
    ).toBe('[answers] resolved: total=7 flags=1 prompted=0 recommended=1 (parts) defaulted=0');
  });
});

describe('R2.5f (i) — no terminal pair, no question', () => {
  it('with the facts saying "not a terminal", nothing is read and the refusal is the one it was', async () => {
    const root = host();
    const input = new PassThrough();
    const output = new PassThrough();
    let written = '';
    output.on('data', (chunk: Buffer) => (written += chunk.toString()));
    await expect(
      runInstall({
        dir: 'acme-shop',
        cwd: root,
        storefront: false,
        services: false,
        interactivity: { ...AT_A_TERMINAL, stdoutIsTty: false },
        io: { input, output, terminal: false },
      }),
    ).rejects.toThrow(/--admin-email/);
    expect(written).toBe('');
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
  });
});
