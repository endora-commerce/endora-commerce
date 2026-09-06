/**
 * The four tiers, the provenance line and the one value a command may generate
 * (`specs/117-instance-bring-up/contracts/input-resolution.md` §§1, 2, 4).
 *
 * The non-interactive guarantee is **not** here: R3.6 requires it to be proved
 * by spawning, because the failure it prevents is a hang and a hang is only
 * observable from outside the process. That is
 * `test/non-interactive-guarantee.test.ts`.
 *
 * The load-bearing case in this file is the last one. `defaulted=0` is a
 * *residue* rather than a counter nothing increments, and the difference is only
 * demonstrable by handing the arithmetic a value whose origin is outside the
 * partition and watching the residue appear. A test that asserted
 * `defaulted=0` over a well-formed run would pass just as happily over the
 * fakeable implementation, which is the whole point of writing this one.
 */
import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { EnvironmentInput } from '@endora-commerce/contracts';

import { parseEnvFile, renderEnvValue, writeEnvFile } from '../src/inputs/env-file.js';
import { promptForInputs, type PromptIo } from '../src/inputs/prompt.js';
import {
  ciMarkerSet,
  flagFor,
  generateSecret,
  inputForFlag,
  mayPrompt,
  missingInputsRefusal,
  planResolution,
  provenanceCounts,
  provenanceLine,
  type InteractivityFacts,
} from '../src/inputs/resolve.js';

const input = (over: Partial<EnvironmentInput>): EnvironmentInput => ({
  name: 'NEXT_PUBLIC_API_BASE_URL',
  describes: { en: 'the backend address.', pl: 'adres backendu.' },
  requirement: { kind: 'required' },
  secret: false,
  generable: false,
  owner: { kind: 'application', application: 'storefront' },
  consumers: ['storefront'],
  ...over,
});

const facts = (over: Partial<InteractivityFacts> = {}): InteractivityFacts => ({
  stdinIsTty: false,
  stdoutIsTty: false,
  nonInteractive: false,
  dryRun: false,
  environment: {},
  ...over,
});

const OPTIONAL = input({
  name: 'NEXT_PUBLIC_APP_NAME',
  requirement: {
    kind: 'optional',
    without: { en: 'the shortcut carries a default.', pl: 'skrót ma domyślną nazwę.' },
  },
});

const SECRET = input({ name: 'SESSION_COOKIE_SECRET', secret: true, generable: true });

describe('the four tiers, in one fixed order', () => {
  it('takes a flag over everything else', () => {
    const plan = planResolution({
      declared: [input({})],
      members: ['storefront'],
      flags: { NEXT_PUBLIC_API_BASE_URL: 'https://flag.example.com' },
      envFile: new Map([['NEXT_PUBLIC_API_BASE_URL', 'https://file.example.com']]),
      interactivity: facts({ stdinIsTty: true, stdoutIsTty: true }),
      language: 'en',
    });
    expect(plan.resolved).toEqual([
      {
        name: 'NEXT_PUBLIC_API_BASE_URL',
        value: 'https://flag.example.com',
        provenance: 'flag',
      },
    ]);
    expect(plan.toPrompt).toEqual([]);
  });

  it('takes the target `.env` when no flag names the input', () => {
    const plan = planResolution({
      declared: [input({})],
      members: ['storefront'],
      flags: {},
      envFile: new Map([['NEXT_PUBLIC_API_BASE_URL', 'https://file.example.com']]),
      interactivity: facts(),
      language: 'en',
    });
    expect(plan.resolved[0]?.provenance).toBe('env-file');
    expect(plan.missing).toEqual([]);
  });

  it('treats a blank value in the file as no answer at all', () => {
    // `KEY=` and no line are the same state for whoever has to fix it. Reading
    // a blank as an answer would let a run print `env-file=1` over an empty
    // string and a shop boot on it.
    const plan = planResolution({
      declared: [input({})],
      members: ['storefront'],
      flags: {},
      envFile: parseEnvFile('NEXT_PUBLIC_API_BASE_URL=\n'),
      interactivity: facts(),
      language: 'en',
    });
    expect(plan.resolved).toEqual([]);
    expect(plan.missing.map((entry) => entry.name)).toEqual(['NEXT_PUBLIC_API_BASE_URL']);
  });

  it('asks on a terminal, and refuses off one — for the same input', () => {
    const request = {
      declared: [input({})],
      members: ['storefront'] as const,
      flags: {},
      envFile: new Map<string, string>(),
      language: 'en' as const,
    };
    expect(
      planResolution({
        ...request,
        members: [...request.members],
        interactivity: facts({ stdinIsTty: true, stdoutIsTty: true }),
      }).toPrompt.map((entry) => entry.name),
    ).toEqual(['NEXT_PUBLIC_API_BASE_URL']);
    expect(
      planResolution({
        ...request,
        members: [...request.members],
        interactivity: facts(),
      }).missing.map((entry) => entry.flag),
    ).toEqual(['--next-public-api-base-url']);
  });

  it('never prompts for an optional input (R1.4)', () => {
    // The prompt's length is the required set's length and nothing more. A tool
    // that asks twelve questions to save one is not assistance.
    const plan = planResolution({
      declared: [OPTIONAL],
      members: ['storefront'],
      flags: {},
      envFile: new Map(),
      interactivity: facts({ stdinIsTty: true, stdoutIsTty: true }),
      language: 'en',
    });
    expect(plan.toPrompt).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(plan.unset.map((entry) => entry.name)).toEqual(['NEXT_PUBLIC_APP_NAME']);
  });

  it('reports rather than refuses under `--dry-run` (R2.4, R7.3)', () => {
    // A dry run answers "what would happen" completely, and an unanswered
    // required input is part of that answer rather than a reason to stop giving
    // it. It neither asks nor generates.
    const plan = planResolution({
      declared: [input({}), SECRET],
      members: ['storefront'],
      flags: {},
      envFile: new Map(),
      interactivity: facts({ dryRun: true }),
      language: 'en',
    });
    expect(plan.missing).toEqual([]);
    expect(plan.toPrompt.map((entry) => entry.name)).toEqual(['NEXT_PUBLIC_API_BASE_URL']);
    expect(plan.toGenerate.map((entry) => entry.name)).toEqual(['SESSION_COOKIE_SECRET']);
  });

  it('answers a condition against the values this run resolved', () => {
    // The case that happens: a run that supplies the condition on its own
    // command line has to be asked for the dependent input in the same run.
    const conditional = input({
      name: 'MEILISEARCH_URL',
      requirement: {
        kind: 'requiredWhen',
        input: 'CATALOG_SEARCH_BACKEND',
        equals: 'meilisearch',
      },
    });
    const backend = input({ name: 'CATALOG_SEARCH_BACKEND' });
    const off = planResolution({
      declared: [backend, conditional],
      members: ['storefront'],
      flags: { CATALOG_SEARCH_BACKEND: 'postgres' },
      envFile: new Map(),
      interactivity: facts(),
      language: 'en',
    });
    expect(off.missing).toEqual([]);
    const on = planResolution({
      declared: [backend, conditional],
      members: ['storefront'],
      flags: { CATALOG_SEARCH_BACKEND: 'meilisearch' },
      envFile: new Map(),
      interactivity: facts(),
      language: 'en',
    });
    expect(on.missing.map((entry) => entry.name)).toEqual(['MEILISEARCH_URL']);
  });

  it('drops an input no written member reads, and does not refuse over it', () => {
    // `specs/118-instance-member-selection/`. An admin-only input in a run that
    // writes no admin member is neither reported as resolved nor dropped in
    // silence: it is not in the population, which is what keeps the provenance
    // line to four outcomes rather than five.
    const adminOnly = input({ name: 'VITE_API_BASE_URL', consumers: ['admin'] });
    const plan = planResolution({
      declared: [adminOnly],
      members: ['storefront'],
      flags: {},
      envFile: new Map(),
      interactivity: facts(),
      language: 'en',
    });
    expect(plan.missing).toEqual([]);
    expect(plan.toPrompt).toEqual([]);
    expect(plan.unset).toEqual([]);
    expect(plan.resolved).toEqual([]);
  });
});

describe('the provenance line', () => {
  it('accounts for every input, with `defaulted=0`', () => {
    const line = provenanceLine([
      { name: 'A', provenance: 'flag' },
      { name: 'B', provenance: 'env-file' },
      { name: 'C', provenance: 'prompt' },
      { name: 'SESSION_COOKIE_SECRET', provenance: 'generated' },
    ]);
    expect(line).toBe(
      '[inputs] resolved: total=4 flags=1 env-file=1 prompted=1 ' +
        'generated=1 (SESSION_COOKIE_SECRET) defaulted=0',
    );
  });

  it('names every generated input, because a count is not actionable (R2.3)', () => {
    const line = provenanceLine([
      { name: 'SESSION_COOKIE_SECRET', provenance: 'generated' },
      { name: 'SETTINGS_SECRET_ENCRYPTION_KEY', provenance: 'generated' },
    ]);
    expect(line).toContain('(SESSION_COOKIE_SECRET, SETTINGS_SECRET_ENCRYPTION_KEY)');
  });

  it('counts a value from outside the four tiers as `defaulted`', () => {
    // **The load-bearing case.** `defaulted` is the residue of a partition, not
    // a counter nothing increments: the fakeable implementation prints `0`
    // because no code path calls it, which is indistinguishable from printing
    // `0` because nothing was invented. Handing the arithmetic an origin
    // outside the partition is the only way to tell the two apart, and this is
    // why `provenanceCounts` takes the loosest record it can.
    const counts = provenanceCounts([
      { provenance: 'flag' },
      { provenance: 'invented-by-the-tool' },
    ]);
    expect(counts.total).toBe(2);
    expect(counts.flags).toBe(1);
    expect(counts.defaulted).toBe(1);
    expect(provenanceLine([{ name: 'X', provenance: 'invented-by-the-tool' }])).toContain(
      'defaulted=1',
    );
  });
});

describe('interactivity is a conjunction the run can prove (R3.1)', () => {
  const interactive = facts({ stdinIsTty: true, stdoutIsTty: true });

  it('asks only when all five hold', () => {
    expect(mayPrompt(interactive)).toBe(true);
  });

  it('refuses on a captured stdout even with an inherited stdin (R3.5)', () => {
    // Checking stdin alone is the implementation R3.5 forbids: such a run would
    // prompt into a log nobody reads, which is the same hang wearing different
    // clothes.
    expect(mayPrompt({ ...interactive, stdoutIsTty: false })).toBe(false);
  });

  it('refuses on a piped stdin', () => {
    expect(mayPrompt({ ...interactive, stdinIsTty: false })).toBe(false);
  });

  it('refuses under `--non-interactive`, on a terminal (R3.4)', () => {
    expect(mayPrompt({ ...interactive, nonInteractive: true })).toBe(false);
  });

  it('refuses under `--dry-run`', () => {
    expect(mayPrompt({ ...interactive, dryRun: true })).toBe(false);
  });

  it('refuses when a CI marker is set', () => {
    expect(mayPrompt({ ...interactive, environment: { CI: 'true' } })).toBe(false);
    expect(mayPrompt({ ...interactive, environment: { GITLAB_CI: 'true' } })).toBe(false);
  });

  it('reads `CI=false`, `CI=0` and `CI=` as not a pipeline', () => {
    expect(ciMarkerSet({ CI: 'false' })).toBe(false);
    expect(ciMarkerSet({ CI: '0' })).toBe(false);
    expect(ciMarkerSet({ CI: '' })).toBe(false);
    expect(ciMarkerSet({ CI: '1' })).toBe(true);
  });

  it('names every missing input in one refusal, with the flag for each (R3.2)', () => {
    const message = missingInputsRefusal(
      [
        {
          name: 'A',
          flag: '--a',
          describes: 'the first.',
          secret: false,
        },
        { name: 'B', flag: '--b', describes: 'the second.', secret: true },
      ],
      facts(),
    );
    // Not one per run: a twelve-input setup must not be twelve failed
    // invocations, which is the experience this exists to remove.
    expect(message).toContain('--a <value>');
    expect(message).toContain('--b <value>');
    expect(message).toContain('2 required inputs');
    expect(message).toContain('Nothing was written.');
  });
});

describe('the one value a command may generate (§4)', () => {
  it('is generated only for a secret the declaration marks generable', () => {
    const plan = planResolution({
      declared: [SECRET, input({})],
      members: ['storefront'],
      flags: {},
      envFile: new Map(),
      interactivity: facts({ stdinIsTty: true, stdoutIsTty: true }),
      language: 'en',
    });
    expect(plan.toGenerate.map((entry) => entry.name)).toEqual(['SESSION_COOKIE_SECRET']);
    // The URL is asked for, never generated: R4.5's test is whether two correct
    // values are interchangeable, and two backend addresses are not.
    expect(plan.toPrompt.map((entry) => entry.name)).toEqual(['NEXT_PUBLIC_API_BASE_URL']);
  });

  it('is 32 random bytes in base64, which is what the platform decodes', () => {
    // The format is not arbitrary: the platform's secret settings are decrypted
    // with `Buffer.from(key, 'base64')` over a 32-byte AES key, so a hex key
    // would fail at the first secret setting an operator wrote.
    const a = generateSecret();
    const b = generateSecret();
    expect(Buffer.from(a, 'base64')).toHaveLength(32);
    expect(a).not.toBe(b);
  });
});

describe('the flag a name derives, and back', () => {
  it('round-trips', () => {
    expect(flagFor('SESSION_COOKIE_SECRET')).toBe('--session-cookie-secret');
    expect(inputForFlag('--session-cookie-secret')).toBe('SESSION_COOKIE_SECRET');
  });
});

describe('the `.env` a command reads and writes', () => {
  it('reads the shapes every dialect agrees on', () => {
    const values = parseEnvFile(
      ['# a comment', 'A=one', 'export B="two"', "C='three'", '', 'D=', 'not a line'].join('\n'),
    );
    expect([...values]).toEqual([
      ['A', 'one'],
      ['B', 'two'],
      ['C', 'three'],
    ]);
  });

  it('keeps the file the operator wrote, and appends what is new', () => {
    const written = writeEnvFile('# mine\nA=old\n\n# keep me\n', new Map([['A', 'new'], ['B', 'b']]));
    expect(written).toBe('# mine\nA=new\n\n# keep me\nB=b\n');
  });

  it('quotes a value that would otherwise be truncated by a comment', () => {
    expect(renderEnvValue('plain-value')).toBe('plain-value');
    expect(renderEnvValue('has # hash')).toBe('"has # hash"');
  });
});

describe('the prompt itself (tier 3)', () => {
  /**
   * A terminal, simulated: the next answer is written **when the question is
   * asked**, not before.
   *
   * That ordering is the whole of the helper and it was measured rather than
   * assumed. A readable carrying every line up front delivers them all in one
   * chunk, `readline` emits every `line` event before the second `question()`
   * is awaited, and the answers after the first are lost to a closed
   * interface — `Error: readline was closed`. Which is to say: a stream that
   * answers ahead of the question is not a terminal, and the re-ask loop is
   * exactly what it fails on.
   */
  function io(lines: readonly string[]): {
    io: PromptIo;
    written: () => string;
  } {
    const input = new PassThrough();
    const pending = [...lines];
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        const text = chunk.toString();
        chunks.push(text);
        // The prompt readline writes before it waits. Answer it, once.
        if (text.endsWith(': ') && pending.length > 0) {
          setImmediate(() => input.write(`${pending.shift()!}\n`));
        }
        callback();
      },
    });
    return { io: { input, output }, written: () => chunks.join('') };
  }

  it('asks in declaration order and names what each value configures', async () => {
    const { io: streams, written } = io(['https://api.example.com', 'default']);
    const answers = await promptForInputs(
      [input({}), input({ name: 'NEXT_PUBLIC_SALES_CHANNEL_CODE' })],
      'en',
      streams,
    );
    expect(answers).toEqual([
      {
        name: 'NEXT_PUBLIC_API_BASE_URL',
        value: 'https://api.example.com',
        provenance: 'prompt',
      },
      { name: 'NEXT_PUBLIC_SALES_CHANNEL_CODE', value: 'default', provenance: 'prompt' },
    ]);
    // The question carries the declaration's own sentence: a prompt reading
    // `NEXT_PUBLIC_API_BASE_URL:` and nothing else asks a person to answer a
    // question they have not been told.
    expect(written()).toContain('the backend address.');
  });

  it('re-asks on an empty answer rather than resolving to the empty string', async () => {
    // The one place a prompt could quietly become the thing R2.5a forbids. An
    // accepted `''` would be counted `prompted=` in the provenance line, which
    // is worse than inventing it in source: it would carry a human's authority.
    const { io: streams } = io(['', '  ', 'https://api.example.com']);
    const answers = await promptForInputs([input({})], 'en', streams);
    expect(answers.map((entry) => entry.value)).toEqual(['https://api.example.com']);
  });

  it('asks in the language the run reports in', async () => {
    const { io: streams, written } = io(['https://api.example.com']);
    await promptForInputs([input({})], 'pl', streams);
    expect(written()).toContain('adres backendu.');
  });
});
