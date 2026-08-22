import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectModuleCommands, helpFor } from '../../../src/cli/module-commands.js';
import { cliCommands } from '../../../src/modules/audit_logs/manifest.js';
import { read } from '../../../src/modules/audit_logs/cli/read.js';
import type { ModuleContext } from '../../../src/kernel/module-context.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '../../..');
const body = resolve(backendRoot, 'src/modules/audit_logs/cli/read.ts');

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
 * file header, and the first paragraph of `--help`. This file pins the third,
 * because `--help` text is the copy most likely to be trimmed by somebody
 * shortening the output, and the second, because the header is where the next
 * person changing the file will look.
 *
 * ## What T042b moved, and the condition it had to keep
 *
 * The tool is a manifest-declared command the host runs (D-160.9), so its
 * `--help` is a `help` **declaration** rather than a string the body prints —
 * and that is not a convenience. D-102's credential is host access, **not a
 * working connection string**: a tool has to be able to say what it does before
 * it can do it. Running a command composes the platform, so if `--help` went
 * through the body it would need a database. The host therefore answers `--list`
 * and `--help` from `resolvedManifestEntries()`, which reads manifests and opens
 * nothing, and the last test below is what holds that.
 */

const [declared] = collectModuleCommands([{ manifest: { id: 'audit_logs' }, cliCommands }]);

describe('audit:read — the CLI says what it costs', () => {
  it('states the unaudited read in the first paragraph of --help, not a footnote', () => {
    const paragraphs = helpFor(declared as never)
      .split(/\n\s*\n/)
      .filter((p) => p.trim().length > 0);
    // The usage line, then the cost. Anything further down is a footnote, which
    // is exactly what the ruling refuses.
    // Whitespace-normalised: a line wrap is not a trim, and the sentence is
    // long enough that it will be wrapped by whoever formats the block next.
    const opening = paragraphs.slice(0, 2).join(' ').replace(/\s+/g, ' ');
    expect(opening).toMatch(/leaves no record/i);
    expect(opening).toMatch(/psql/);
    expect(opening).toMatch(/host/i);
  });

  it('refuses an argument it does not understand rather than reading something else', async () => {
    // A read that did not happen must not look like an empty one, so the exit
    // code is 1 and the stream carries the usage line — and the body reaches no
    // EntityManager on that path, which is what the throwing cradle proves.
    const err: string[] = [];
    const code = await read({
      ctx: {
        cradle: () => {
          throw new Error('argv is refused before anything is read');
        },
      } as unknown as ModuleContext,
      argv: ['--bogus'],
      out: () => {},
      err: (line) => err.push(line),
    });
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/usage/i);
  });

  it('carries the cost and the must-not-grow list in its header, where the next editor reads', () => {
    // Four growth directions re-open the owner's E2 ruling rather than being
    // follow-up tickets, because each one makes host access stop being a
    // sufficient credential. The list lives at the top of the file so it is read
    // before the change, not after the review.
    const source = readFileSync(body, 'utf8');
    const header = source.slice(0, source.indexOf('\nimport '));

    expect(header).toMatch(/leaves no record/i);
    expect(header).toMatch(/psql/);
    for (const growth of [/no writes/i, /redact/i, /export/i, /network/i]) {
      expect(header, `the header does not refuse: ${growth}`).toMatch(growth);
    }
  });

  it('answers --help without reaching the database', async () => {
    // The credential is host access, not a working connection string. The host
    // answers this from the manifest declarations, so it must survive a
    // `DATABASE_URL` that points at nothing — which is also what proves the
    // answer is not coming from a composed platform.
    const { stdout } = await exec(
      'pnpm',
      ['exec', 'tsx', 'src/cli.ts', 'audit_logs', 'read', '--help'],
      {
        cwd: backendRoot,
        env: {
          ...process.env,
          DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/definitely_not_a_database',
        },
      },
    );
    // Whitespace-normalised for the same reason the first test is: the sentence
    // is long enough to be wrapped, and a line wrap is not a trim.
    expect(stdout.replace(/\s+/g, ' ')).toMatch(/leaves no record/i);
  }, 60_000);
});
