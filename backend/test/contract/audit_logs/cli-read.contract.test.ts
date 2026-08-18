import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../../../src/modules/audit_logs/scripts/read.ts');

/**
 * `audit:read` — the surface D-102 ships, and the sentence it must not lose.
 *
 * The tool exists because an investigation authorised by the admin identity
 * subsystem is circular when *that subsystem* is the incident. Its credential
 * is therefore access to the host, which the owner's E2 ruling accepted on a
 * stated condition: anyone with a shell and the database credentials already
 * reads these rows through `psql`, so the CLI adds legibility and filtering,
 * not authority.
 *
 * The cost of that answer is that **a read performed here leaves no record in
 * the trail it reads**, and it is written in three places — the ruling, the
 * script header, and the first paragraph of `--help`. This file pins the third,
 * because `--help` text is the copy most likely to be trimmed by somebody
 * shortening the output, and the second, because the header is where the next
 * person changing the file will look.
 */

async function run(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec('pnpm', ['exec', 'tsx', script, ...args], {
      env: { ...process.env, ...env },
    });
    return { exitCode: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

describe('audit:read — the CLI says what it costs', () => {
  it('states the unaudited read in the first paragraph of --help, not a footnote', async () => {
    const { exitCode, stdout } = await run(['--help']);
    expect(exitCode).toBe(0);

    const paragraphs = stdout.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    // The usage line, then the cost. Anything further down is a footnote, which
    // is exactly what the ruling refuses.
    // Whitespace-normalised: a line wrap is not a trim, and the sentence is
    // long enough that it will be wrapped by whoever formats the block next.
    const opening = paragraphs.slice(0, 2).join(' ').replace(/\s+/g, ' ');
    expect(opening).toMatch(/leaves no record/i);
    expect(opening).toMatch(/psql/);
    expect(opening).toMatch(/host/i);
  }, 60_000);

  it('answers --help without reaching the database', async () => {
    // The credential is host access, not a working connection string: the tool
    // has to be able to tell somebody what it does before it can do it.
    const { exitCode } = await run(['--help'], {
      DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/definitely_not_a_database',
    });
    expect(exitCode).toBe(0);
  }, 60_000);

  it('refuses an argument it does not understand rather than reading something else', async () => {
    const { exitCode, stderr } = await run(['--bogus']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/usage/i);
  }, 60_000);

  it('carries the cost and the must-not-grow list in its header, where the next editor reads', () => {
    // Four growth directions re-open the owner's E2 ruling rather than being
    // follow-up tickets, because each one makes host access stop being a
    // sufficient credential. The list lives at the top of the file so it is read
    // before the change, not after the review.
    const source = readFileSync(script, 'utf8');
    const header = source.slice(0, source.indexOf('\nimport '));

    expect(header).toMatch(/leaves no record/i);
    expect(header).toMatch(/psql/);
    for (const growth of [/no writes/i, /redact/i, /export/i, /network/i]) {
      expect(header, `the header does not refuse: ${growth}`).toMatch(growth);
    }
  });
});
