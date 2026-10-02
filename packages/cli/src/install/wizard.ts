/**
 * The install wizard — `endora install`'s questions, asked only when a human is
 * there to answer them (`specs/125-first-mile-install/spec.md` §6, FR-145…FR-152).
 *
 * ## The permission it runs under, and its five bounds
 *
 * `cli-product.md` **R2.5f** (125's PR-1(b), accepted by the owner on
 * 2026-09-25 and placed as D-269): an install wizard may offer a choice that is
 * not a missing required input, and only an install wizard may. Each of its
 * clauses is a property of this file:
 *
 *   * **(i)** R2.5c's conjunction holds unchanged. This module is reached only
 *     after `mayPrompt` answered yes — both descriptors TTYs, no
 *     `--non-interactive`, no `--dry-run`, no CI marker — and a run that fails
 *     it never opens `readline` at all.
 *   * **(ii)** every question has a flag ({@link INSTALL_QUESTIONS} is §6.2's
 *     table as data), and a run supplying all of them asks nothing and writes
 *     the tree the wizard would have written (SC-107).
 *   * **(iii)** a question whose flag was supplied is not asked and not
 *     confirmed; it is reported, once, before the first question (FR-147).
 *   * **(iv)** an answer taken by pressing Enter is a **recommendation**,
 *     counted as `recommended=` in the `[answers]` line and printed in the
 *     closing block with what reverses it — never as `defaulted`, which stays
 *     bound to `0`.
 *   * **(v)** no other command imports this file.
 *
 * ## What it is not
 *
 * Not a TUI and not a dependency: `node:readline` is Node core, a checklist is
 * a numbered list toggled by typing its numbers, and the whole of it is
 * assertable by feeding a string to a stream (§6.1, T4-I).
 *
 * ## The demo question has no Enter answer
 *
 * 125's PR-2 was ruled **(c)**: the one question where the two audiences want
 * opposite answers is the one where asking is cheaper than being wrong. An
 * empty answer re-asks, exactly as `promptForInputs` treats an empty required
 * input — accepting `''` would be the tool choosing and reporting a human's
 * authority for it.
 */
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';

import type { MemberDeclaration } from '../new-instance/index.js';

import {
  COMPONENT_VOCABULARY,
  EVERYTHING,
  NOT_AN_ORIGIN,
  parseOrigin,
  questionIdsFor,
  resolveSelection,
  type Component,
  type QuestionId,
  type Selection,
} from './selection.js';

export type { QuestionId } from './selection.js';

/** Where the questions are asked and answered. Injected, so a test drives it. */
export interface WizardIo {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  /**
   * Whether `input` is a terminal `readline` should drive — line editing, and
   * echo that the password question can switch off. A test feeding a stream
   * says `false`.
   */
  readonly terminal: boolean;
}

/** One row of §6.2, the table that is the contract (FR-146). */
export interface InstallQuestion {
  readonly id: QuestionId;
  /** The flags that answer it — a run supplying one of them is not asked. */
  readonly flags: readonly string[];
  /**
   * §6.2's *Kind* column. `required` must be answered — by a flag under
   * `--non-interactive`, where its absence is part of the one refusal; `offered`
   * takes its recommendation there (*everything*, *yes*: the fail-safe
   * directions). The demo question is `required` by 125 PR-2 (c) and is the one
   * question with no Enter answer in the wizard either.
   */
  readonly kind: 'required' | 'offered';
}

/**
 * Every question this command can ask, by id: the flags that answer it and
 * whether it must be answered.
 *
 * §6.2's seven, and the five `specs/138-separate-components/` adds for a run
 * that stands up a strict subset. `api-url` is the one whose kind depends on
 * the selection — required where the API is on another machine, offered where
 * it is this one — which {@link installQuestions} decides.
 */
const QUESTION_TABLE: Readonly<Record<QuestionId, Omit<InstallQuestion, 'id'>>> = {
  directory: { flags: ['<dir>'], kind: 'required' },
  parts: {
    flags: ['--only <component>', '--without <member>', '--no-storefront', '--storefront-dir <path>'],
    kind: 'offered',
  },
  'api-url': { flags: ['--api-url'], kind: 'required' },
  'admin-url': { flags: ['--admin-url'], kind: 'offered' },
  'storefront-url': { flags: ['--storefront-url'], kind: 'required' },
  'sales-channel': { flags: ['--sales-channel'], kind: 'offered' },
  'revalidate-secret': { flags: ['--revalidate-secret'], kind: 'required' },
  services: { flags: ['--no-services'], kind: 'offered' },
  demo: { flags: ['--demo', '--no-demo'], kind: 'required' },
  'admin-email': { flags: ['--admin-email'], kind: 'required' },
  'admin-password': { flags: ['--admin-password'], kind: 'required' },
  'admin-name': { flags: ['--admin-first-name', '--admin-last-name'], kind: 'required' },
};

/**
 * The questions one selection has, in the order they are asked (138 FR-019).
 *
 * The count is a function of the selection: a run that stands up the admin
 * alone has three, and the `[answers]` line of that run says `total=3`. With
 * the API in the run the origins of the other machines are **offered** — not
 * given, the platform's development fallbacks apply; without it they are owed.
 */
export function installQuestions(selection: Selection): readonly InstallQuestion[] {
  const api = selection.components.includes('api');
  return questionIdsFor(selection).map((id) => ({
    id,
    ...QUESTION_TABLE[id],
    ...(api && (id === 'api-url' || id === 'storefront-url') ? { kind: 'offered' as const } : {}),
  }));
}

/**
 * §6.2, as data — the questions of the run that selects nothing. Seven at
 * most, in the order they are asked; the four flag-only rows (`--registry`,
 * `--module`, `--deployment`, `--topology`) are not here because nothing asks
 * them.
 */
export const INSTALL_QUESTIONS: readonly InstallQuestion[] = installQuestions(EVERYTHING);

/** The directory the first question recommends (§6.2 Q1). */
export const RECOMMENDED_DIRECTORY = './endora-commerce';

/** The answers a run was given, in `InstallOptions`' own vocabulary. */
export interface WizardAnswers {
  readonly dir?: string | undefined;
  readonly only?: readonly string[] | undefined;
  readonly without?: readonly string[] | undefined;
  readonly storefront?: boolean | undefined;
  readonly storefrontDir?: string | undefined;
  readonly apiUrl?: string | undefined;
  readonly adminUrl?: string | undefined;
  readonly storefrontUrl?: string | undefined;
  readonly salesChannel?: string | undefined;
  readonly revalidateSecret?: string | undefined;
  readonly services?: boolean | undefined;
  readonly demo?: boolean | undefined;
  readonly adminEmail?: string | undefined;
  readonly adminPassword?: string | undefined;
  readonly adminFirstName?: string | undefined;
  readonly adminLastName?: string | undefined;
}

/**
 * Which questions the command line already answered, and with which flags.
 *
 * `undefined` is *not given* throughout — the argv layer passes a key only for
 * a flag that was typed — so this is a reading of the answers, never a guess.
 */
export function answeredByFlags(given: WizardAnswers): ReadonlyMap<QuestionId, string> {
  const found = new Map<QuestionId, string>();
  if (given.dir !== undefined && given.dir.trim().length > 0) found.set('directory', given.dir);
  const only = (given.only ?? []).filter((name) => name.trim().length > 0);
  const parts = [
    ...(given.only === undefined || given.only.length === 0 ? [] : [`--only ${only.join(',')}`]),
    ...(given.without ?? []).map((member) => `--without ${member}`),
    ...(given.storefront === false ? ['--no-storefront'] : []),
    ...(given.storefrontDir === undefined ? [] : [`--storefront-dir ${given.storefrontDir}`]),
  ];
  if (parts.length > 0) found.set('parts', parts.join(', '));
  if (present(given.apiUrl)) found.set('api-url', `--api-url ${given.apiUrl}`);
  if (present(given.adminUrl)) found.set('admin-url', `--admin-url ${given.adminUrl}`);
  if (present(given.storefrontUrl)) {
    found.set('storefront-url', `--storefront-url ${given.storefrontUrl}`);
  }
  if (present(given.salesChannel)) found.set('sales-channel', `--sales-channel ${given.salesChannel}`);
  if (present(given.revalidateSecret)) found.set('revalidate-secret', '--revalidate-secret');
  if (given.services === false) found.set('services', '--no-services');
  if (given.demo !== undefined) found.set('demo', given.demo ? '--demo' : '--no-demo');
  if (present(given.adminEmail)) found.set('admin-email', '--admin-email');
  if (present(given.adminPassword)) found.set('admin-password', '--admin-password');
  if (present(given.adminFirstName) && present(given.adminLastName)) {
    found.set('admin-name', '--admin-first-name, --admin-last-name');
  }
  return found;
}

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

/**
 * What the checklist needs of a member — `MemberDeclaration`'s shape, with the
 * name widened to a string so the vocabulary is an input rather than a type
 * this file closes over.
 */
export type MemberRow = Pick<MemberDeclaration, 'describes' | 'fixed'> & { readonly name: string };

/** One row of the parts checklist. */
export interface ChecklistRow {
  /** A component's `--only` name, or a member's `--without` name. */
  readonly name: string;
  readonly describes: string;
  /** Why the row cannot be toggled, or `null` when it can. */
  readonly fixed: string | null;
  /** Whether a fixed row is checked. An unavailable storefront is not. */
  readonly fixedValue: boolean;
  /**
   * Which axis unchecking it reaches (138 FR-017): a component is what this
   * **run** stands up (`--only`), a member is what the **tree** holds
   * (`--without`).
   */
  readonly dispatch: 'component' | 'member';
}

/** What each component row says it is. */
const COMPONENT_DESCRIBES: Readonly<Record<Component, string>> = {
  api: 'the API and the workers — the part every other one talks to',
  admin: 'the operator interface, built as its own artefact',
  storefront: 'the shop, as its own repository beside the instance',
};

/**
 * The checklist's rows: the three components, then every member the template
 * declares that is not one of them (138 FR-017; R6.3a, FR-151).
 *
 * The member rows are the vocabulary handed in — `MEMBER_VOCABULARY` in a real
 * run — less `backend` and `admin`, which the `api` and `admin` component rows
 * stand for: so a member the template gains appears here, pre-checked, with
 * nothing in this file edited. The one row that can be fixed is the storefront,
 * where this build has none to write.
 */
export function checklistRows(
  vocabulary: readonly MemberRow[],
  storefront: { readonly available: boolean; readonly reason: string },
): readonly ChecklistRow[] {
  return [
    ...COMPONENT_VOCABULARY.map((name) => ({
      name,
      describes: COMPONENT_DESCRIBES[name],
      fixed: name === 'storefront' && !storefront.available ? storefront.reason : null,
      fixedValue: false,
      dispatch: 'component' as const,
    })),
    // A member a component row already stands for has no row of its own: the
    // one that shares a component's name, and the one that cannot leave the
    // tree (it is fixed), which is what the first component runs.
    ...vocabulary
      .filter(
        (entry) =>
          entry.fixed === null && !(COMPONENT_VOCABULARY as readonly string[]).includes(entry.name),
      )
      .map((entry) => ({
        name: entry.name,
        describes: entry.describes,
        fixed: entry.fixed,
        fixedValue: true,
        dispatch: 'member' as const,
      })),
  ];
}

/**
 * What a checklist hands the command (R6.3b, FR-150, FR-151; 138 FR-017).
 *
 * `--without <member>` for each unchecked member row. For the components:
 * **nothing at all** when every one this build can write is still checked — so
 * Enter on the untouched list produces the argv a run with no selection flag
 * has — and `only` naming the checked ones the moment one is unchecked.
 * `null` when none of the three is checked: there would be nothing to stand up.
 */
export function selectionToFlags(
  rows: readonly ChecklistRow[],
  unchecked: ReadonlySet<string>,
): {
  readonly without: readonly string[];
  readonly storefront: boolean;
  readonly only?: readonly string[];
} | null {
  const without = rows
    .filter((row) => row.dispatch === 'member' && row.fixed === null && unchecked.has(row.name))
    .map((row) => row.name);
  const components = rows.filter((row) => row.dispatch === 'component');
  const checked = components
    .filter((row) => (row.fixed === null ? !unchecked.has(row.name) : row.fixedValue))
    .map((row) => row.name);
  if (checked.length === 0) return null;
  const storefront = checked.includes('storefront');
  const untouched = components.every((row) => row.fixed !== null || !unchecked.has(row.name));
  return untouched ? { without, storefront } : { without, storefront, only: checked };
}

/** What the wizard decided, and where each answer came from. */
export interface WizardOutcome {
  readonly answers: WizardAnswers;
  /** Question ids answered by a flag, with the flags. */
  readonly fromFlags: ReadonlyMap<QuestionId, string>;
  /** Question ids a human typed an answer to. */
  readonly prompted: readonly QuestionId[];
  /** Question ids answered by pressing Enter on the recommendation (R2.5f iv). */
  readonly recommended: readonly QuestionId[];
}

/** Everything the wizard needs to know about the machine, decided by its caller. */
export interface WizardContext {
  readonly vocabulary: readonly MemberRow[];
  readonly storefront: { readonly available: boolean; readonly reason: string };
}

/** Thrown when the answers stop arriving — never a hang. */
export class WizardClosedError extends Error {
  override readonly name = 'WizardClosedError';
}

/**
 * The output `readline` writes through, with a gate the password question
 * closes: a terminal echoes what is typed, and the one answer that must not be
 * on the screen is the one typed here (§6.2 Q6, *"read without echo"*).
 */
class EchoGate extends Writable {
  muted = false;

  constructor(private readonly target: NodeJS.WritableStream) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) this.target.write(chunk);
    callback();
  }
}

/**
 * Ask every question the command line did not answer, in §6.2's order.
 *
 * Lines are read through the interface's async iterator rather than
 * `question()`, because a piped answer that arrives before its question would
 * otherwise be dropped — and a closed input ends the iterator, which is a
 * {@link WizardClosedError} naming what was still unanswered rather than a
 * process waiting for a line that will never come.
 */
export async function askWizard(
  given: WizardAnswers,
  io: WizardIo,
  context: WizardContext,
): Promise<WizardOutcome> {
  const fromFlags = answeredByFlags(given);
  const prompted: QuestionId[] = [];
  const recommended: QuestionId[] = [];
  const write = (text: string): void => void io.output.write(text);

  // FR-147 — the flags are reported, once, before the first question; a value
  // typed on the same command line is not a thing to confirm.
  // The count is over the questions the selection has (138 FR-019): the one the
  // flags named, and every part where the checklist is still to be answered.
  const typed = resolveSelection(given.only, given.without ?? [], given.storefront);
  const known = installQuestions('refusals' in typed ? EVERYTHING : typed);
  const used = known
    .filter((question) => fromFlags.has(question.id))
    .map((question) => fromFlags.get(question.id)!);
  // How many questions there are is known only once the parts are: the admin
  // alone has three, all three components seven. Where the checklist is still
  // to be answered, a total printed here was the count of the run that selects
  // everything — "0 of 7" above a run whose `[answers]` line then said
  // `total=3`. So the total is stated only where the flags already fixed it.
  write(
    `${used.length === 0 ? 'no flags given' : `using ${used.join('; ')}`}; ` +
      (fromFlags.has('parts')
        ? `${String(used.length)} of ${String(known.length)} answers came from flags.\n`
        : `${String(used.length)} answer${used.length === 1 ? '' : 's'} came from flags.\n`),
  );

  const gate = new EchoGate(io.output);
  const rl = createInterface({ input: io.input, output: gate, terminal: io.terminal });
  const lines = rl[Symbol.asyncIterator]();
  // Ctrl+C in a raw-mode terminal arrives as an event, not a signal. Closing the
  // interface ends the iterator, so the pending question fails rather than the
  // process pausing with nothing to resume it.
  rl.on('SIGINT', () => rl.close());
  // A piped input that has ended closes the interface while its lines are still
  // queued in the iterator, and `prompt()` on a closed interface throws. The
  // questions after that point are written straight to the screen instead; the
  // answers are the queued lines, and when those run out the iterator says so.
  let closed = false;
  rl.on('close', () => (closed = true));

  const ask = async (question: string, id: QuestionId, secret = false): Promise<string> => {
    if (closed) write(question);
    else {
      rl.setPrompt(question);
      rl.prompt();
    }
    if (secret) gate.muted = true;
    try {
      const next = await lines.next();
      if (next.done === true) {
        const flags = QUESTION_TABLE[id].flags.join(' / ');
        throw new WizardClosedError(
          `the answers stopped before "${question.trim()}" was answered. Pass ${flags} to ` +
            'answer it on the command line, or `--non-interactive` with every answer to ask ' +
            'nothing at all.',
        );
      }
      return String(next.value).trim();
    } finally {
      if (secret) {
        gate.muted = false;
        write('\n');
      }
    }
  };

  /** A required answer: an empty line re-asks, and is never a value. */
  const required = async (question: string, id: QuestionId, secret = false): Promise<string> => {
    for (;;) {
      const answer = await ask(question, id, secret);
      if (answer.length > 0) return answer;
    }
  };

  try {
    const answers: {
      -readonly [K in keyof WizardAnswers]: WizardAnswers[K];
    } = { ...given };

    // Q1 — where. For the storefront alone `<dir>` is the storefront's own
    // directory (138 FR-007), and the question says so when the flags did.
    if (!fromFlags.has('directory')) {
      // What `<dir>` holds is the parts question's to decide, and it is asked
      // second: until then this cannot say "instance" — unchecking the API and
      // the admin makes the directory the storefront's own.
      const question = !fromFlags.has('parts')
        ? 'Which directory should it be written to?'
        : `Where should the ${!('refusals' in typed) && !typed.writesTree ? 'storefront' : 'instance'} go?`;
      const answer = await ask(`${question} [${RECOMMENDED_DIRECTORY}] `, 'directory');
      if (answer.length === 0) {
        answers.dir = RECOMMENDED_DIRECTORY;
        recommended.push('directory');
      } else {
        answers.dir = answer;
        prompted.push('directory');
      }
    }

    // Q2 — which parts this machine runs (138 FR-017). The checklist is
    // re-rendered after every toggle, so a dumb terminal and a test both read
    // the same text.
    if (!fromFlags.has('parts')) {
      const rows = checklistRows(context.vocabulary, context.storefront);
      const toggleable = rows.filter((row) => row.fixed === null);
      const unchecked = new Set<string>();
      let toggled = false;
      // Asked of `selection.ts`, which is where "does this selection write an
      // instance tree" is decided — this file names no component of its own.
      const writesTree = (): boolean => {
        const flags = selectionToFlags(rows, unchecked);
        if (flags === null) return false;
        const selected = resolveSelection(flags.only, [], flags.storefront);
        return !('refusals' in selected) && selected.writesTree;
      };
      for (;;) {
        write('\nWhich parts should this machine run? Type the numbers to toggle, Enter to accept.\n');
        for (const row of rows) {
          if (row.fixed !== null) {
            write(`      ${row.fixedValue ? '[x]' : '[ ]'} ${row.name} — ${row.describes} (${row.fixed})\n`);
            continue;
          }
          const number = toggleable.indexOf(row) + 1;
          // A member row is about the instance tree. With neither the API nor
          // the admin checked there is no tree, and a checked `docs` beside a
          // storefront-only selection promised a member nothing would write.
          const noTree = row.dispatch === 'member' && !writesTree();
          write(
            `  ${String(number).padStart(2)}. ${unchecked.has(row.name) || noTree ? '[ ]' : '[x]'} ` +
              `${row.name} — ${row.describes}` +
              `${noTree ? ' (part of the instance tree, which this selection does not write)' : ''}\n`,
          );
        }
        const answer = await ask('> ', 'parts');
        if (answer.length === 0) {
          if (selectionToFlags(rows, unchecked) !== null) break;
          write(`  keep at least one of ${COMPONENT_VOCABULARY.join(', ')}.\n`);
          continue;
        }
        const numbers = answer.split(/[\s,]+/).filter((token) => token.length > 0);
        const invalid = numbers.filter((token) => {
          const index = Number(token);
          return !Number.isInteger(index) || index < 1 || index > toggleable.length;
        });
        if (invalid.length > 0) {
          write(`  ${invalid.join(', ')}: type a number from 1 to ${String(toggleable.length)}.\n`);
          continue;
        }
        for (const token of numbers) {
          const row = toggleable[Number(token) - 1]!;
          if (unchecked.has(row.name)) unchecked.delete(row.name);
          else unchecked.add(row.name);
        }
        toggled = true;
      }
      const flags = selectionToFlags(rows, unchecked)!;
      answers.without = flags.without;
      answers.storefront = flags.storefront;
      if (flags.only !== undefined) answers.only = flags.only;
      if (toggled) prompted.push('parts');
      else recommended.push('parts');
    }

    // What this run stands up, now that the flags and the checklist have both
    // spoken. A selection the flags got wrong was refused before this wizard
    // was opened, so anything unresolvable here falls back to every part and
    // is refused by the command with the rest of its preconditions.
    const resolved = resolveSelection(answers.only, answers.without ?? [], answers.storefront);
    const selection = 'refusals' in resolved ? EVERYTHING : resolved;
    // The member rows are about the instance tree. Where the checklist chose a
    // selection that writes none, an unchecked member is not a `--without`:
    // there is no tree for it to be left out of, and the command refuses that
    // flag for exactly that reason.
    if (!fromFlags.has('parts') && !selection.writesTree) answers.without = [];
    const applies = new Set(questionIdsFor(selection));
    const asks = (id: QuestionId): boolean => applies.has(id) && !fromFlags.has(id);
    const standsUpApi = selection.components.includes('api');

    /** A required origin: an empty line and a value that is not one both re-ask. */
    const requiredOrigin = async (question: string, id: QuestionId): Promise<string> => {
      for (;;) {
        const origin = parseOrigin(await required(question, id));
        if (origin !== null) return origin;
        write(`  ${NOT_AN_ORIGIN}\n`);
      }
    };
    /** An offered origin: Enter takes the recommendation, and writes nothing. */
    const offeredOrigin = async (question: string, id: QuestionId): Promise<string | undefined> => {
      for (;;) {
        const answer = await ask(question, id);
        if (answer.length === 0) {
          recommended.push(id);
          return undefined;
        }
        const origin = parseOrigin(answer);
        if (origin !== null) {
          prompted.push(id);
          return origin;
        }
        write(`  ${NOT_AN_ORIGIN}\n`);
      }
    };

    // The other machines (138 FR-018) — asked only of a strict subset, in
    // FR-012…FR-014's order, each skipped when its flag was given.
    if (!standsUpApi) {
      if (asks('api-url')) {
        write('\n');
        answers.apiUrl = await requiredOrigin(
          'Where is the API? Its public origin, e.g. https://api.example.com: ',
          'api-url',
        );
        prompted.push('api-url');
      }
      if (asks('storefront-url')) {
        answers.storefrontUrl = await requiredOrigin(
          'Where will this storefront be served? Its public origin, e.g. https://shop.example.com: ',
          'storefront-url',
        );
        prompted.push('storefront-url');
      }
      if (asks('sales-channel')) {
        const answer = await ask('Sales channel code [default]: ', 'sales-channel');
        if (answer.length === 0) recommended.push('sales-channel');
        else {
          answers.salesChannel = answer;
          prompted.push('sales-channel');
        }
      }
      if (asks('revalidate-secret')) {
        answers.revalidateSecret = await required(
          "REVALIDATE_SECRET, as the API's .env has it (not shown): ",
          'revalidate-secret',
          true,
        );
        prompted.push('revalidate-secret');
      }
    } else if (selection.subset) {
      if (asks('api-url') || asks('admin-url') || asks('storefront-url')) write('\n');
      if (asks('api-url')) {
        const origin = await offeredOrigin(
          'Where is this API reachable from the other machines? [http://localhost:3001] ',
          'api-url',
        );
        if (origin !== undefined) answers.apiUrl = origin;
      }
      if (asks('admin-url')) {
        const origin = await offeredOrigin(
          'Where will the admin be served? [http://localhost:3002] ',
          'admin-url',
        );
        if (origin !== undefined) answers.adminUrl = origin;
      }
      if (asks('storefront-url')) {
        const origin = await offeredOrigin(
          'Where will the storefront be served? [http://localhost:3000] ',
          'storefront-url',
        );
        if (origin !== undefined) answers.storefrontUrl = origin;
      }
    }

    // Q3 — the development services.
    if (asks('services')) {
      for (;;) {
        const answer = (
          await ask(
            '\nStart PostgreSQL, Redis, Meilisearch and a mail catcher in Docker for you? [Y/n] ',
            'services',
          )
        ).toLowerCase();
        if (answer.length === 0) {
          answers.services = true;
          recommended.push('services');
          break;
        }
        if (answer === 'y' || answer === 'yes' || answer === 'n' || answer === 'no') {
          answers.services = answer.startsWith('y');
          prompted.push('services');
          break;
        }
      }
    }

    // Q4 — demo data. No Enter answer: 125 PR-2 (c), D-269.
    if (asks('demo')) {
      write(
        "\nDemo data is every installed module's example rows. An instance you are evaluating " +
          'wants it; one you will sell from wants none of it.\n',
      );
      for (;;) {
        const answer = (await required('Install demo data? [y/n] ', 'demo')).toLowerCase();
        if (answer === 'y' || answer === 'yes' || answer === 'n' || answer === 'no') {
          answers.demo = answer.startsWith('y');
          prompted.push('demo');
          break;
        }
      }
    }

    // Q5–Q7 — the administrator, one block. Nothing has a default: the
    // password in particular is the one value you have to remember (FR-159).
    if (asks('admin-email') || asks('admin-password') || asks('admin-name')) {
      write('\nThe administrator you will sign in as:\n');
    }
    if (asks('admin-email')) {
      answers.adminEmail = await required('Administrator e-mail: ', 'admin-email');
      prompted.push('admin-email');
    }
    if (asks('admin-password')) {
      answers.adminPassword = await required(
        'Administrator password (not shown): ',
        'admin-password',
        true,
      );
      prompted.push('admin-password');
    }
    if (asks('admin-name')) {
      if (!present(answers.adminFirstName)) {
        answers.adminFirstName = await required('Administrator first name: ', 'admin-name');
      }
      if (!present(answers.adminLastName)) {
        answers.adminLastName = await required('Administrator last name: ', 'admin-name');
      }
      prompted.push('admin-name');
    }
    write('\n');
    return { answers, fromFlags, prompted, recommended };
  } finally {
    rl.close();
  }
}

/**
 * The `[answers]` line — R2.5f (iv)'s provenance, in the estate's `read:`
 * grammar and beside the `[inputs]` line rather than inside it: these are the
 * install's own questions, not declared environment inputs, and counting them
 * in the other line would make its `total` a different population per command.
 *
 * `recommended` names every answer it counts, under `input-resolution.md`
 * R2.3's disclosure rule, and `defaulted` is `0` for the same reason it is
 * there: nothing here was chosen without a human or a flag choosing it.
 */
export function answersLine(
  outcome: Pick<WizardOutcome, 'fromFlags' | 'prompted' | 'recommended'>,
  total: number = INSTALL_QUESTIONS.length,
): string {
  const named = outcome.recommended.length === 0 ? '' : ` (${outcome.recommended.join(', ')})`;
  return (
    `[answers] resolved: total=${String(total)} ` +
    `flags=${String(outcome.fromFlags.size)} prompted=${String(outcome.prompted.length)} ` +
    `recommended=${String(outcome.recommended.length)}${named} defaulted=0`
  );
}
