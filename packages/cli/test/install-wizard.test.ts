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
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { runInstall, type InstallStep } from '../src/install/index.js';
import { EVERYTHING, resolveSelection } from '../src/install/selection.js';
import {
  INSTALL_QUESTIONS,
  answersLine,
  askWizard,
  checklistRows,
  installQuestions,
  selectionToFlags,
} from '../src/install/wizard.js';
import { runNewInstance } from '../src/new-instance/index.js';
import { MEMBER_VOCABULARY } from '../src/new-instance/template.js';
import { main } from '../src/bin/endora.js';

import { writePackagedReference } from '../src/new-storefront/packaged.js';

import { ADMIN, cleanScratch, host, temp } from './support/install-host.js';

afterEach(cleanScratch);

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** No port on this machine is taken — what a hermetic case answers the probe with. */
const NO_PORT_TAKEN = async (): Promise<boolean> => false;

/**
 * A directory holding no packaged reference storefront, so the checklist's
 * storefront row is what this file's cases were written against rather than
 * whatever this checkout's last build left in `dist`.
 */
const NO_PACKAGED_REFERENCE = join(tmpdir(), 'endora-no-packaged-reference-here');

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
      'Which directory should it be written to?',
      'Which parts should this machine run?',
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
    // Rows: 1 api, 2 admin, 3 docs — the storefront is fixed where none can be written.
    const answersTyped = ['acme-shop', '3', '', 'n', 'y', ...Object.values(ADMIN)];
    const wizardRoot = host();
    const { io } = terminal(answersTyped);
    const wizard = await runInstall({
      cwd: wizardRoot,
      interactivity: AT_A_TERMINAL,
      portInUse: NO_PORT_TAKEN,
      packagedReferenceDir: NO_PACKAGED_REFERENCE,
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
      // The same machine as the wizard's run above: unanswered, this one asked
      // the real one, and a taken 3001 there put a `PORT` line in one tree only.
      portInUse: NO_PORT_TAKEN,
      run: recorder().run,
    });

    expect(wizard.exitCode).toBe(0);
    expect(flags.exitCode).toBe(0);
    const generated = [...wizard.instance!.resolved, ...flags.instance!.resolved]
      .filter((entry) => entry.provenance === 'generated')
      .map((entry) => entry.name);
    expect(snapshot(wizard.targetDir, generated)).toEqual(snapshot(flags.targetDir, generated));
    expect(wizard.instance!.plan.members).not.toContain('docs');
  });
});

describe('T4-C / FR-147 — a supplied flag is reported, not re-asked', () => {
  it('one line names the flags and how many answers they gave; their questions are not asked', async () => {
    const { io, screen } = terminal(['y', 'owner@example.com', 'a-long-enough-pw', 'Ada', 'Lovelace']);
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
    expect(text).not.toContain('Which parts should this machine run?');
    expect(text).not.toContain('Start PostgreSQL');
  });
});

describe('T4-D / R6.3a — the checklist is the template\'s member vocabulary', () => {
  it('a member added to the vocabulary appears, pre-checked, with no wizard edit', async () => {
    const vocabulary = [
      ...MEMBER_VOCABULARY,
      { name: 'analytics', describes: 'a member the template gained next year', fixed: null },
    ];
    const { io, screen } = terminal(['', '', '', 'n', 'e@x.io', 'a-long-enough-pw', 'A', 'B']);
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
      portInUse: NO_PORT_TAKEN,
      packagedReferenceDir: NO_PACKAGED_REFERENCE,
      io,
      run: recorder().run,
    });
    const bareRoot = host();
    const bare = await runNewInstance({ dir: 'acme-shop', cwd: bareRoot });
    const paths = (files: readonly { path: string }[]): string[] => files.map((file) => file.path);
    expect(paths(wizard.instance!.plan.files)).toEqual(paths(bare.plan.files));
    expect(wizard.instance!.plan.members).toEqual(bare.plan.members);
    // …and no `only` either: Enter on the untouched list is the argv of a run
    // with no selection flag (138 FR-017).
    expect(selectionToFlags(checklistRows(MEMBER_VOCABULARY, NO_STOREFRONT_HERE), new Set())).toEqual({
      without: [],
      storefront: false,
    });
    expect(
      selectionToFlags(checklistRows(MEMBER_VOCABULARY, { available: true, reason: '' }), new Set()),
    ).toEqual({ without: [], storefront: true });
  });
});

describe('T4-F / FR-152 — no positive MEMBER selector, and the backend cannot leave the tree', () => {
  /**
   * FR-152 refused a positive selector over the tree's members, and that
   * stands. `--only` (`specs/138-separate-components/`, D-284) is not one: its
   * vocabulary is the three components a **run** stands up, so a member's name
   * is refused by it exactly as an invented flag is.
   */
  it('the flag vocabulary holds no positive member selector', async () => {
    for (const flag of ['--with-admin', '--member', '--headless']) {
      expect(await main(['install', 'x', flag, 'admin'], PACKAGE_ROOT), flag).toBe(1);
    }
    for (const member of ['backend', 'docs']) {
      const selection = resolveSelection([member], [], undefined);
      expect('refusals' in selection, `--only ${member}`).toBe(true);
    }
  });

  it('`--without backend` stays refused, and the checklist has no backend row to uncheck', async () => {
    expect(await main(['new', 'instance', 'x', '--without', 'backend'], PACKAGE_ROOT)).toBe(1);
    const { io, screen } = terminal(['', '', '', 'n', 'e@x.io', 'a-long-enough-pw', 'A', 'B']);
    await askWizard({}, io, { vocabulary: MEMBER_VOCABULARY, storefront: NO_STOREFRONT_HERE });
    expect(screen()).not.toContain('backend —');
    // What the run stands up is the `api` row; unchecking it leaves the member
    // in the tree (D-284 clause 2), which `selection.ts` decides.
    expect(screen()).toMatch(/^\s+1\. \[x\] api — /m);
    const adminAlone = resolveSelection(['admin'], [], undefined);
    expect('refusals' in adminAlone ? null : adminAlone.without).toEqual([]);
  });
});

describe('T4-G / FR-151 — the checklist dispatches each row to its own axis', () => {
  const rows = checklistRows(MEMBER_VOCABULARY, { available: true, reason: '' });

  it('the rows are the three components, then the members that are not one', () => {
    expect(rows.map((row) => [row.name, row.dispatch])).toEqual([
      ['api', 'component'],
      ['admin', 'component'],
      ['storefront', 'component'],
      ['docs', 'member'],
    ]);
    expect(rows.every((row) => row.fixed === null)).toBe(true);
  });

  it('an unchecked component is `only` over the rest, never `--without storefront`', () => {
    expect(selectionToFlags(rows, new Set(['storefront', 'admin']))).toEqual({
      without: [],
      storefront: false,
      only: ['api'],
    });
    expect(selectionToFlags(rows, new Set(['api', 'docs']))).toEqual({
      without: ['docs'],
      storefront: true,
      only: ['admin', 'storefront'],
    });
  });

  it('an unchecked member alone is `--without`, and no `only`', () => {
    expect(selectionToFlags(rows, new Set(['docs']))).toEqual({ without: ['docs'], storefront: true });
  });

  it('none of the three components is no selection at all', () => {
    expect(selectionToFlags(rows, new Set(['api', 'admin', 'storefront']))).toBeNull();
  });

  it('where no storefront can be written, the row is fixed and says why', async () => {
    const { io, screen } = terminal(['', '', '', 'n', 'e@x.io', 'a-long-enough-pw', 'A', 'B']);
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
    // The untouched list is still the run with no selection flag.
    expect(outcome.answers.only).toBeUndefined();
  });
});

/**
 * `specs/138-separate-components/` T07 — the parts question is about what this
 * machine runs, and a strict subset is asked where the other machines are.
 */
describe('138 FR-017 / FR-018 — one component, and the questions that follow from it', () => {
  const HERE = { vocabulary: MEMBER_VOCABULARY, storefront: { available: true, reason: '' } };
  const asked = (text: string, question: string): number => text.split(question).length - 1;

  it('the list is api, admin, storefront, docs — numbered, pre-checked, worded as the plan words it', async () => {
    const { io, screen } = terminal(['', '', '', 'n', 'e@x.io', 'a-long-enough-pw', 'A', 'B']);
    await askWizard({}, io, HERE);
    expect(screen()).toContain(
      [
        'Which parts should this machine run? Type the numbers to toggle, Enter to accept.',
        '   1. [x] api — the API and the workers — the part every other one talks to',
        '   2. [x] admin — the operator interface, built as its own artefact',
        '   3. [x] storefront — the shop, as its own repository beside the instance',
        '   4. [x] docs — a documentation site rendering your modules\' own pages',
      ].join('\n'),
    );
  });

  it('Enter on everything is the answers of a flagless run: no `only`, and the seven questions', async () => {
    const { io, screen } = terminal(['', '', '', 'n', 'e@x.io', 'a-long-enough-pw', 'A', 'B']);
    const outcome = await askWizard({}, io, HERE);
    expect(outcome.answers.only).toBeUndefined();
    expect(outcome.answers).toMatchObject({ without: [], storefront: true, services: true, demo: false });
    expect(outcome.recommended).toEqual(['directory', 'parts', 'services']);
    for (const question of ['Where is the API?', 'Where will', 'Sales channel', 'REVALIDATE_SECRET']) {
      expect(screen(), question).not.toContain(question);
    }
  });

  it('none of the three checked re-asks, and says why', async () => {
    const { io, screen } = terminal(['acme', '1 2 3', '', '1', '', '', '', '', '', '', 'n', 'e@x.io', 'a-long-enough-pw', 'A', 'B']);
    const outcome = await askWizard({}, io, HERE);
    expect(screen()).toContain('  keep at least one of api, admin, storefront.');
    expect(outcome.answers.only).toEqual(['api']);
  });

  it('the admin alone: where the API is, and nothing about a database or an administrator', async () => {
    const { io, screen } = terminal(['acme', '1 3', '', '', '', 'api.example.com', 'https://api.example.com']);
    const outcome = await askWizard({}, io, HERE);
    const text = screen();
    // An empty required answer re-asks, and so does a value that is not an origin.
    expect(asked(text, 'Where is the API? Its public origin, e.g. https://api.example.com: ')).toBe(3);
    expect(text).toContain('  that is not an origin: scheme and host, an optional port, no path.');
    for (const question of [
      'Start PostgreSQL',
      'Install demo data?',
      'Administrator',
      'Where will',
      'Sales channel',
      'REVALIDATE_SECRET',
    ]) {
      expect(text, question).not.toContain(question);
    }
    expect(outcome.answers).toMatchObject({ dir: 'acme', only: ['admin'], apiUrl: 'https://api.example.com' });
    expect(outcome.prompted).toEqual(['directory', 'parts', 'api-url']);
    expect(outcome.recommended).toEqual([]);
  });

  it('the storefront alone: the API, its own origin, the channel and the secret', async () => {
    const answers = ['acme', '1 2', '', '', 'https://api.example.com', 'https://shop.example.com', '', '', 's3cret-the-api-holds'];
    const { io, screen } = terminal(answers);
    const outcome = await askWizard({}, io, HERE);
    const text = screen();
    const order = [
      'Where is the API?',
      'Where will this storefront be served? Its public origin, e.g. https://shop.example.com: ',
      'Sales channel code [default]: ',
      "REVALIDATE_SECRET, as the API's .env has it (not shown): ",
    ].map((question) => text.indexOf(question));
    expect(order.every((index) => index >= 0), text).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // An empty line is not a secret: it was asked twice. That it is read
    // without echo is a terminal's property, so the spawned case in
    // `install-wizard-tty.test.ts` is the one that asserts it.
    expect(asked(text, 'REVALIDATE_SECRET, as the API')).toBe(2);
    for (const question of ['Start PostgreSQL', 'Install demo data?', 'Administrator']) {
      expect(text, question).not.toContain(question);
    }
    expect(outcome.answers).toMatchObject({
      only: ['storefront'],
      apiUrl: 'https://api.example.com',
      storefrontUrl: 'https://shop.example.com',
      revalidateSecret: 's3cret-the-api-holds',
    });
    expect(outcome.answers.salesChannel).toBeUndefined();
    expect(outcome.recommended).toEqual(['sales-channel']);
  });

  it('the storefront alone, with `docs` unchecked too: no `--without` for a tree nobody writes', async () => {
    // The checklist's member rows are about the instance tree. A selection
    // that writes none has no member to leave out, and handing the command
    // `--without docs` would be the wizard producing a flag the command then
    // refuses — after every question had been answered.
    const { io } = terminal(['acme', '1 2 4', '', '', 'https://api.example.com', 'https://shop.example.com', '', 's']);
    const outcome = await askWizard({}, io, HERE);
    expect(outcome.answers.only).toEqual(['storefront']);
    expect(outcome.answers.without).toEqual([]);
  });

  it('once neither the API nor the admin is checked, `docs` is shown unchecked and says why', async () => {
    // It is a member of the instance tree. Left `[x]` beside a storefront-only
    // selection it promised a documentation site nothing would write.
    const { io, screen } = terminal(['acme', '1 2', '', '', 'https://api.example.com', 'https://shop.example.com', '', 's']);
    await askWizard({}, io, HERE);
    const renders = screen().split('Which parts should this machine run?');
    // The first render: every row checked. The second, after `1 2`: the tree is gone.
    expect(renders[1]).toContain("[x] docs — a documentation site rendering your modules' own pages\n");
    expect(renders[2]).toContain(
      "[ ] docs — a documentation site rendering your modules' own pages " +
        '(part of the instance tree, which this selection does not write)',
    );
    expect(renders[2]).not.toContain('[x] docs');
  });

  it('the first line states a total only where the flags already fixed the selection', async () => {
    // Before the checklist is answered the number of questions is not known: it
    // said "0 of 7" above a run whose `[answers]` line then said `total=3`.
    const { io, screen } = terminal(['acme', '1 3', '', '', 'https://api.example.com']);
    await askWizard({}, io, HERE);
    const first = screen().split('\n')[0]!;
    expect(first).toBe('no flags given; 0 answers came from flags.');
    // And the directory question does not call it an instance yet.
    expect(screen()).toContain('Which directory should it be written to? [./endora-commerce] ');
    expect(screen()).not.toContain('Where should the instance go?');
  });

  it('with the parts given as flags, the directory question names what `<dir>` is', async () => {
    const alone = terminal(['shop', '', 'https://api.example.com', 'https://shop.example.com', '', 's']);
    await askWizard({ only: ['storefront'] }, alone.io, HERE);
    expect(alone.screen()).toContain('Where should the storefront go?');
    expect(alone.screen().split('\n')[0]).toContain('1 of 6 answers came from flags');
  });

  it('the API alone: the three origins are offered, Enter takes each recommendation and writes nothing', async () => {
    const { io, screen } = terminal([
      'acme',
      '2 3',
      '',
      '', // the layout: one address each
      '', // this API: the recommendation
      'https://admin.example.com/', // not an origin: asked again
      'https://admin.example.com',
      '', // the storefront: the recommendation
      'n',
      'n',
      'e@x.io',
      'a-long-enough-pw',
      'A',
      'B',
    ]);
    const outcome = await askWizard({}, io, HERE);
    const text = screen();
    expect(text).toContain('Where is this API reachable from the other machines? [http://localhost:3001] ');
    expect(asked(text, 'Where will the admin be served? [http://localhost:3002] ')).toBe(2);
    expect(text).toContain('Where will the storefront be served? [http://localhost:3000] ');
    expect(text.indexOf('Where will the storefront be served?')).toBeLessThan(text.indexOf('Start PostgreSQL'));
    expect(outcome.answers).toMatchObject({ only: ['api'], adminUrl: 'https://admin.example.com' });
    expect(outcome.answers.apiUrl).toBeUndefined();
    expect(outcome.answers.storefrontUrl).toBeUndefined();
    expect(outcome.recommended).toEqual(['api-url', 'storefront-url']);
    expect(outcome.prompted).toContain('admin-url');
  });

  it('FR-030 — the layout is asked before any address, and Enter is one address each', async () => {
    const { io, screen } = terminal(['acme', '1 3', '', '', 'https://api.example.com']);
    const outcome = await askWizard({}, io, HERE);
    const text = screen();
    expect(text).toContain(
      [
        'How are the API, the admin and the storefront reached?',
        '   1. one address each — api.example.com, admin.example.com, shop.example.com',
        '   2. one address, with paths — the storefront at /, the admin under /admin, the API under /api',
        '[1] ',
      ].join('\n'),
    );
    expect(text.indexOf('How are the API')).toBeLessThan(text.indexOf('Where is the API?'));
    expect(outcome.answers.publicUrl).toBeUndefined();
    expect(outcome.answers.apiUrl).toBe('https://api.example.com');
  });

  it('FR-030 — "one address, with paths" is one question, and none of the three address questions', async () => {
    const { io, screen } = terminal([
      'acme',
      '2 3', // the API alone
      '',
      '3', // not a choice: asked again
      '2',
      'https://example.com/shop', // not an origin: asked again
      'https://example.com',
      'n',
      'n',
      'e@x.io',
      'a-long-enough-pw',
      'A',
      'B',
    ]);
    const outcome = await askWizard({}, io, HERE);
    const text = screen();
    expect(text).toContain('  type 1 or 2.');
    expect(asked(text, 'The address, e.g. https://example.com: ')).toBe(2);
    for (const question of ['Where is this API reachable', 'Where will the admin', 'Where will the storefront']) {
      expect(text, question).not.toContain(question);
    }
    expect(outcome.answers).toMatchObject({ only: ['api'], publicUrl: 'https://example.com' });
    expect(outcome.answers.apiUrl).toBeUndefined();
    expect(outcome.prompted).toEqual(expect.arrayContaining(['api-url', 'admin-url', 'storefront-url']));
    expect(outcome.recommended).toEqual([]);
  });

  it('FR-030 — the storefront alone under one address is still asked the channel and the secret', async () => {
    const { io, screen } = terminal(['acme', '1 2', '', '2', 'https://example.com', '', 's3cret']);
    const outcome = await askWizard({}, io, HERE);
    expect(screen()).not.toContain('Where is the API?');
    expect(screen()).toContain('Sales channel code [default]: ');
    expect(outcome.answers).toMatchObject({ publicUrl: 'https://example.com', revalidateSecret: 's3cret' });
  });

  it('FR-030 — an address flag answers the layout: it is not asked', async () => {
    const { io, screen } = terminal(['acme', '1 3', '']);
    await askWizard({ apiUrl: 'https://api.example.com' }, io, HERE);
    expect(screen()).not.toContain('How are the API');
    const second = terminal(['acme', '1 3', '']);
    const outcome = await askWizard({ publicUrl: 'https://example.com' }, second.io, HERE);
    expect(second.screen()).not.toContain('How are the API');
    expect(second.screen()).not.toContain('Where is the API?');
    expect(outcome.answers.publicUrl).toBe('https://example.com');
  });

  it('a question whose flag was given is not asked', async () => {
    const { io, screen } = terminal([]);
    const outcome = await askWizard(
      { dir: 'acme', only: ['admin'], apiUrl: 'https://api.example.com' },
      io,
      HERE,
    );
    const text = screen();
    expect(text.split('\n')[0]).toContain('3 of 3 answers came from flags');
    expect(text).not.toContain('Where is the API?');
    expect(text).not.toContain('Which parts');
    expect(outcome.prompted).toEqual([]);
  });

  it('FR-019 — the count of questions is a function of the selection', () => {
    const count = (only: readonly string[] | undefined): number => {
      const selection = resolveSelection(only, [], undefined);
      return installQuestions('refusals' in selection ? EVERYTHING : selection).length;
    };
    expect(count(undefined)).toBe(7);
    expect(count(['admin'])).toBe(3);
    expect(count(['storefront'])).toBe(6);
    expect(count(['api'])).toBe(10);
    // Every one of them has a flag (R2.5f ii).
    for (const only of [undefined, ['api'], ['admin'], ['storefront']] as const) {
      const selection = resolveSelection(only, [], undefined);
      for (const question of installQuestions('refusals' in selection ? EVERYTHING : selection)) {
        expect(question.flags.length, question.id).toBeGreaterThan(0);
      }
    }
  });

  it('SC-107 — the wizard and `--non-interactive` write the same admin-only tree', async () => {
    const wizardRoot = host({ admin: true });
    // Rows: 1 api, 2 admin, 3 docs — no storefront can be written from here.
    const { io } = terminal(['acme-shop', '1', '', '', 'https://api.example.com']);
    const wizardSteps = recorder();
    const wizard = await runInstall({
      cwd: wizardRoot,
      interactivity: AT_A_TERMINAL,
      portInUse: NO_PORT_TAKEN,
      packagedReferenceDir: NO_PACKAGED_REFERENCE,
      io,
      dockerReachable: false,
      run: wizardSteps.run,
    });
    const flagsRoot = host({ admin: true });
    const flags = await runInstall({
      dir: 'acme-shop',
      cwd: flagsRoot,
      only: ['admin'],
      apiUrl: 'https://api.example.com',
      nonInteractive: true,
      portInUse: NO_PORT_TAKEN,
      run: recorder().run,
    });
    expect(wizardSteps.steps.map((step) => step.id)).toEqual(['install', 'build-admin']);
    const generated = [...wizard.instance!.resolved, ...flags.instance!.resolved]
      .filter((entry) => entry.provenance === 'generated')
      .map((entry) => entry.name);
    expect(snapshot(wizard.targetDir, generated)).toEqual(snapshot(flags.targetDir, generated));
    expect(wizard.answers).toBe('[answers] resolved: total=3 flags=0 prompted=3 recommended=0 defaulted=0');
    expect(flags.answers).toBe('[answers] resolved: total=3 flags=3 prompted=0 recommended=0 defaulted=0');
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
      portInUse: NO_PORT_TAKEN,
      packagedReferenceDir: NO_PACKAGED_REFERENCE,
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
      portInUse: NO_PORT_TAKEN,
      packagedReferenceDir: NO_PACKAGED_REFERENCE,
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

describe('the closing block says where the password came from', () => {
  it('typed at the prompt: it does not claim the command line', async () => {
    const root = host();
    const { io } = terminal(['acme-shop', '', 'n', 'n', ...Object.values(ADMIN)]);
    const result = await runInstall({
      cwd: root,
      interactivity: AT_A_TERMINAL,
      portInUse: NO_PORT_TAKEN,
      packagedReferenceDir: NO_PACKAGED_REFERENCE,
      io,
      run: recorder().run,
    });
    const text = result.output.join('\n');
    expect(text).not.toContain('passed on the command line');
    expect(text).toContain('with the password you entered above');
  });

  it('given as --admin-password: it names the command line', async () => {
    const root = host();
    const { io } = terminal(['acme-shop', '', 'n', 'n', ADMIN.adminEmail, 'Ada', 'Lovelace']);
    const result = await runInstall({
      cwd: root,
      interactivity: AT_A_TERMINAL,
      portInUse: NO_PORT_TAKEN,
      packagedReferenceDir: NO_PACKAGED_REFERENCE,
      io,
      adminPassword: ADMIN.adminPassword,
      run: recorder().run,
    });
    expect(result.output.join('\n')).toContain('with the password you passed on the command line');
  });
});

describe('the storefront row, outside a checkout', () => {
  /** A packaged reference, built from a one-page checkout the way the package's build does it. */
  async function packagedReference(): Promise<string> {
    const checkout = temp('endora-wizard-checkout-');
    writeFileSync(join(checkout, 'pnpm-workspace.yaml'), 'packages:\n  - shop\n');
    writeFileSync(
      join(checkout, 'package.json'),
      JSON.stringify({ name: 'fixture-root', private: true, packageManager: 'pnpm@9.15.0' }),
    );
    mkdirSync(join(checkout, 'shop', 'app'), { recursive: true });
    writeFileSync(
      join(checkout, 'shop', 'package.json'),
      JSON.stringify({
        name: 'shop',
        version: '0.0.0',
        private: true,
        scripts: { build: 'next build' },
        dependencies: { next: '^15.0.0' },
      }),
    );
    writeFileSync(join(checkout, 'shop', 'app', 'page.tsx'), 'export default () => null;\n');
    writeFileSync(
      join(checkout, 'shop', 'environment-inputs.mjs'),
      `export const STOREFRONT_ENVIRONMENT_INPUTS = [{
  name: 'NEXT_PUBLIC_API_BASE_URL',
  describes: { en: 'the backend address.', pl: 'adres backendu.' },
  requirement: { kind: 'required' },
  secret: false,
  generable: false,
  owner: { kind: 'application', application: 'storefront' },
  consumers: ['storefront'],
  addressOf: 'backend',
}];\n`,
    );
    for (const args of [
      ['init', '-q'],
      ['add', '-A'],
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'],
    ]) {
      const result = spawnSync('git', args, { cwd: checkout, encoding: 'utf8' });
      if (result.error) throw new Error(`git ${args.join(' ')}: ${result.error.message}`);
      if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    }
    const cli = join(checkout, 'cli');
    mkdirSync(cli);
    writeFileSync(join(cli, 'package.json'), JSON.stringify({ name: '@x/cli', version: '9.9.9' }));
    const out = join(temp('endora-wizard-packaged-'), 'storefront-reference');
    expect((await writePackagedReference(cli, out)).written).toBe(true);
    return out;
  }

  it('a CLI that carries the reference offers it as a toggleable, pre-checked row, and Enter writes it', async () => {
    const root = host();
    const { io, screen } = terminal(['acme-shop', '', 'n', 'n', ...Object.values(ADMIN)]);
    const result = await runInstall({
      cwd: root,
      interactivity: AT_A_TERMINAL,
      portInUse: NO_PORT_TAKEN,
      packagedReferenceDir: await packagedReference(),
      io,
      run: recorder().run,
    });
    expect(screen()).toMatch(/^\s+\d+\. \[x\] storefront — /m);
    expect(result.storefrontDir).toBe(join(root, 'acme-shop-storefront'));
    expect(existsSync(join(root, 'acme-shop-storefront', 'app', 'page.tsx'))).toBe(true);
  });

  it('a CLI that carries none shows the row fixed and unchecked, with the reason', async () => {
    const root = host();
    const { io, screen } = terminal(['acme-shop', '', 'n', 'n', ...Object.values(ADMIN)]);
    const result = await runInstall({
      cwd: root,
      interactivity: AT_A_TERMINAL,
      portInUse: NO_PORT_TAKEN,
      packagedReferenceDir: NO_PACKAGED_REFERENCE,
      io,
      run: recorder().run,
    });
    expect(screen()).toMatch(/^\s+\[ \] storefront — .*carries no reference storefront/m);
    expect(result.storefrontDir).toBeNull();
  });
});

describe('the administrator password is checked where it is given, not where it is used', () => {
  const HERE = { vocabulary: MEMBER_VOCABULARY, storefront: NO_STOREFRONT_HERE };

  it('a password the instance would refuse is asked for again, at once, and says why', async () => {
    const { io, screen } = terminal(['', '', '', 'n', 'e@x.io', 'too-short', 'long-enough-now', 'A', 'B']);
    const outcome = await askWizard({}, io, HERE);
    expect(outcome.answers.adminPassword).toBe('long-enough-now');
    expect(screen().split('Administrator password (not shown').length - 1).toBe(2);
    expect(screen()).toContain('the administrator password must be at least 12 characters.');
    // Refused before the name was asked — not after the questions.
    expect(screen().indexOf('at least 12 characters.')).toBeLessThan(
      screen().indexOf('Administrator first name'),
    );
    expect(outcome.prompted.filter((id) => id === 'admin-password')).toHaveLength(1);
  });

  it('given as a flag it is refused with the other preconditions, before anything is written or run', async () => {
    const root = host();
    const { steps, run } = recorder();
    await expect(
      runInstall({
        ...ADMIN,
        adminPassword: 'too-short',
        dir: 'acme-shop',
        cwd: root,
        storefront: false,
        services: false,
        demo: false,
        nonInteractive: true,
        portInUse: NO_PORT_TAKEN,
        run,
      }),
    ).rejects.toThrow(/administrator password must be at least 12 characters/);
    expect(steps).toEqual([]);
    expect(existsSync(join(root, 'acme-shop'))).toBe(false);
  });
});

/**
 * The same question at a terminal that can redraw: checkboxes. Driven through
 * `readline`'s own key decoding — the bytes a terminal sends — one key at a
 * time, each after the list it acts on has been drawn.
 */
describe('the parts checklist at a terminal that redraws — arrows, Space, Enter', () => {
  const HERE = { vocabulary: MEMBER_VOCABULARY, storefront: { available: true, reason: '' } };
  const DOWN = '\x1b[B';
  const UP = '\x1b[A';

  /** Type `keys` at the checklist, one per redraw, then the rest as lines. */
  async function atCheckboxes(
    keys: readonly string[],
    rest: readonly string[],
  ): Promise<{ readonly outcome: Awaited<ReturnType<typeof askWizard>>; readonly screen: string }> {
    const input = new PassThrough();
    const output = new PassThrough();
    let screen = '';
    let seen = 0;
    const pending = [...keys];
    let finished = false;
    output.on('data', (chunk: Buffer) => {
      screen += chunk.toString();
      const draws = screen.split('Space to toggle').length - 1;
      if (draws === seen || finished) return;
      seen = draws;
      const key = pending.shift();
      if (key !== undefined) setImmediate(() => input.write(key));
      else {
        finished = true;
        setImmediate(() => input.write(`${rest.map((line) => `${line}\r`).join('')}`));
      }
    });
    const asking = askWizard({ dir: 'shop' }, { input, output, terminal: true }, HERE);
    const outcome = await asking;
    return { outcome, screen };
  }

  const ADMINISTRATOR = ['', 'n', 'e@x.io', 'a-long-enough-pw', 'A', 'B'];

  it('Enter on the untouched list is the recommendation, and nothing asks for a number', async () => {
    const { outcome, screen } = await atCheckboxes(['\r'], ADMINISTRATOR);
    expect(screen).toContain('↑/↓ to move, Space to toggle, Enter to accept.');
    expect(screen).toContain(' > [x] api — ');
    expect(screen).not.toContain('Type the numbers');
    expect(outcome.answers.only).toBeUndefined();
    expect(outcome.answers.without).toEqual([]);
    expect(outcome.recommended).toContain('parts');
  });

  it('Space unchecks the focused row, arrows move the focus and wrap', async () => {
    // api off; down to admin, off; up twice wraps past api to docs… and back.
    const { outcome, screen } = await atCheckboxes(
      [' ', DOWN, ' ', UP, UP, DOWN, '\r'],
      // Storefront alone: the layout, where the API is, where it is served,
      // the channel, the secret.
      ['', 'https://api.example.com', 'https://shop.example.com', '', 'a-secret'],
    );
    expect(outcome.answers.only).toEqual(['storefront']);
    expect(outcome.prompted).toContain('parts');
    expect(screen).toContain(' > [ ] admin — ');
    // What Space typed into `readline`'s own line never became an answer.
    expect(outcome.answers.apiUrl).toBe('https://api.example.com');
  });

  it('none of the three checked is not accepted: it says so and stays on the list', async () => {
    const { outcome, screen } = await atCheckboxes(
      [' ', DOWN, ' ', DOWN, ' ', '\r', ' ', '\r'],
      ['', 'https://api.example.com', 'https://shop.example.com', '', 'a-secret'],
    );
    expect(screen).toContain('keep at least one of api, admin, storefront.');
    expect(outcome.answers.only).toEqual(['storefront']);
  });

  it('a terminal that cannot redraw keeps the numbered list', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let screen = '';
    output.on('data', (chunk: Buffer) => (screen += chunk.toString()));
    input.end(['', '', 'n', 'e@x.io', 'a-long-enough-pw', 'A', 'B'].map((line) => `${line}\n`).join(''));
    await askWizard({ dir: 'shop' }, { input, output, terminal: true, redraws: false }, HERE);
    expect(screen).toContain('Type the numbers to toggle, Enter to accept.');
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
