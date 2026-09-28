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

export type QuestionId =
  | 'directory'
  | 'parts'
  | 'services'
  | 'demo'
  | 'admin-email'
  | 'admin-password'
  | 'admin-name';

/**
 * §6.2, as data. Seven questions at most, in the order they are asked; the
 * four flag-only rows (`--registry`, `--module`, `--deployment`, `--topology`)
 * are not here because nothing asks them.
 */
export const INSTALL_QUESTIONS: readonly InstallQuestion[] = [
  { id: 'directory', flags: ['<dir>'], kind: 'required' },
  {
    id: 'parts',
    flags: ['--without <member>', '--no-storefront', '--storefront-dir <path>'],
    kind: 'offered',
  },
  { id: 'services', flags: ['--no-services'], kind: 'offered' },
  { id: 'demo', flags: ['--demo', '--no-demo'], kind: 'required' },
  { id: 'admin-email', flags: ['--admin-email'], kind: 'required' },
  { id: 'admin-password', flags: ['--admin-password'], kind: 'required' },
  { id: 'admin-name', flags: ['--admin-first-name', '--admin-last-name'], kind: 'required' },
];

/** The directory the first question recommends (§6.2 Q1). */
export const RECOMMENDED_DIRECTORY = './endora-commerce';

/** The answers a run was given, in `InstallOptions`' own vocabulary. */
export interface WizardAnswers {
  readonly dir?: string | undefined;
  readonly without?: readonly string[] | undefined;
  readonly storefront?: boolean | undefined;
  readonly storefrontDir?: string | undefined;
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
  const parts = [
    ...(given.without ?? []).map((member) => `--without ${member}`),
    ...(given.storefront === false ? ['--no-storefront'] : []),
    ...(given.storefrontDir === undefined ? [] : [`--storefront-dir ${given.storefrontDir}`]),
  ];
  if (parts.length > 0) found.set('parts', parts.join(', '));
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
  /** A member's `--without` name, or `storefront`. */
  readonly name: string;
  readonly describes: string;
  /** Why the row cannot be toggled, or `null` when it can. */
  readonly fixed: string | null;
  /** Whether a fixed row is written (the backend) or not (an absent storefront). */
  readonly fixedValue: boolean;
  /** Which mechanism unchecking it reaches (FR-151). */
  readonly dispatch: 'member' | 'storefront';
}

/**
 * The checklist's rows: one per member **the template declares**, then the
 * storefront (R6.3a, FR-151).
 *
 * The member rows are the vocabulary handed in — `MEMBER_VOCABULARY` in a real
 * run — so a member the template gains appears here, pre-checked, with nothing
 * in this file edited. The storefront row is the marked exception: it is not a
 * member, and unchecking it dispatches to `--no-storefront`.
 */
export function checklistRows(
  vocabulary: readonly MemberRow[],
  storefront: { readonly available: boolean; readonly reason: string },
): readonly ChecklistRow[] {
  return [
    ...vocabulary.map((entry) => ({
      name: entry.name,
      describes: entry.describes,
      fixed: entry.fixed,
      fixedValue: true,
      dispatch: 'member' as const,
    })),
    {
      name: 'storefront',
      describes: 'the shop, as its own repository beside the instance',
      fixed: storefront.available ? null : storefront.reason,
      fixedValue: false,
      dispatch: 'storefront' as const,
    },
  ];
}

/**
 * What a checklist hands the scaffolders (R6.3b, FR-150, FR-151).
 *
 * `--without <member>` for each unchecked member row and **nothing at all**
 * when every row is checked — so the most common business case produces the
 * argv a bare `endora new instance <dir>` produces. The storefront row reaches
 * the other mechanism and never `--without storefront`.
 */
export function selectionToFlags(
  rows: readonly ChecklistRow[],
  unchecked: ReadonlySet<string>,
): { readonly without: readonly string[]; readonly storefront: boolean } {
  const without = rows
    .filter((row) => row.dispatch === 'member' && row.fixed === null && unchecked.has(row.name))
    .map((row) => row.name);
  const storefrontRow = rows.find((row) => row.dispatch === 'storefront')!;
  const storefront =
    storefrontRow.fixed === null ? !unchecked.has(storefrontRow.name) : storefrontRow.fixedValue;
  return { without, storefront };
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
  const used = INSTALL_QUESTIONS.filter((question) => fromFlags.has(question.id)).map(
    (question) => fromFlags.get(question.id)!,
  );
  write(
    `${used.length === 0 ? 'no flags given' : `using ${used.join('; ')}`}; ` +
      `${String(fromFlags.size)} of ${String(INSTALL_QUESTIONS.length)} answers came from flags.\n`,
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
        const flags = INSTALL_QUESTIONS.find((row) => row.id === id)!.flags.join(' / ');
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

    // Q1 — where.
    if (!fromFlags.has('directory')) {
      const answer = await ask(`Where should the instance go? [${RECOMMENDED_DIRECTORY}] `, 'directory');
      if (answer.length === 0) {
        answers.dir = RECOMMENDED_DIRECTORY;
        recommended.push('directory');
      } else {
        answers.dir = answer;
        prompted.push('directory');
      }
    }

    // Q2 — which parts. The checklist is re-rendered after every toggle, so a
    // dumb terminal and a test both read the same text.
    if (!fromFlags.has('parts')) {
      const rows = checklistRows(context.vocabulary, context.storefront);
      const toggleable = rows.filter((row) => row.fixed === null);
      const unchecked = new Set<string>();
      let toggled = false;
      for (;;) {
        write('\nWhich parts do you want? Type the numbers to toggle, Enter to accept.\n');
        for (const row of rows) {
          if (row.fixed !== null) {
            write(`      ${row.fixedValue ? '[x]' : '[ ]'} ${row.name} — ${row.describes} (${row.fixed})\n`);
            continue;
          }
          const number = toggleable.indexOf(row) + 1;
          write(
            `  ${String(number).padStart(2)}. ${unchecked.has(row.name) ? '[ ]' : '[x]'} ` +
              `${row.name} — ${row.describes}\n`,
          );
        }
        const answer = await ask('> ', 'parts');
        if (answer.length === 0) break;
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
      const selection = selectionToFlags(rows, unchecked);
      answers.without = selection.without;
      answers.storefront = selection.storefront;
      if (toggled) prompted.push('parts');
      else recommended.push('parts');
    }

    // Q3 — the development services.
    if (!fromFlags.has('services')) {
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
    if (!fromFlags.has('demo')) {
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
    if (!fromFlags.has('admin-email') || !fromFlags.has('admin-password') || !fromFlags.has('admin-name')) {
      write('\nThe administrator you will sign in as:\n');
    }
    if (!fromFlags.has('admin-email')) {
      answers.adminEmail = await required('Administrator e-mail: ', 'admin-email');
      prompted.push('admin-email');
    }
    if (!fromFlags.has('admin-password')) {
      answers.adminPassword = await required(
        'Administrator password (not shown): ',
        'admin-password',
        true,
      );
      prompted.push('admin-password');
    }
    if (!fromFlags.has('admin-name')) {
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
export function answersLine(outcome: Pick<WizardOutcome, 'fromFlags' | 'prompted' | 'recommended'>): string {
  const named = outcome.recommended.length === 0 ? '' : ` (${outcome.recommended.join(', ')})`;
  return (
    `[answers] resolved: total=${String(INSTALL_QUESTIONS.length)} ` +
    `flags=${String(outcome.fromFlags.size)} prompted=${String(outcome.prompted.length)} ` +
    `recommended=${String(outcome.recommended.length)}${named} defaulted=0`
  );
}
