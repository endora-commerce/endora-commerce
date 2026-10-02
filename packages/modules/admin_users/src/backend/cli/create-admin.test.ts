/**
 * `admin_users create` — how the password reaches it.
 *
 * `--password=` is an argument, and an argument is visible: in a process list,
 * in a package manager's echo of the script it runs, and in the reason the
 * operator CLI logs for the system scope it opens. `endora install` created
 * every instance's first administrator that way and the password was printed
 * three times on the way. `--password-stdin` is the form that is not.
 */
import { describe, expect, it } from 'vitest';

import { parseArgs, wantsPasswordFromStdin } from './create-admin.js';

const REST = ['--email=Owner@Example.com', '--first-name=Ada', '--last-name=Lovelace'];

describe('admin_users create — the password', () => {
  it('is read from the flag, as it always was', () => {
    const parsed = parseArgs([...REST, '--password=a-password-they-remember']);
    expect(parsed).toMatchObject({ email: 'owner@example.com', password: 'a-password-they-remember' });
  });

  it('is read from standard input under --password-stdin', () => {
    const argv = [...REST, '--password-stdin'];
    expect(wantsPasswordFromStdin(argv)).toBe(true);
    expect(parseArgs(argv, 'a-password-they-remember')).toMatchObject({
      password: 'a-password-they-remember',
      firstName: 'Ada',
    });
  });

  it('refuses both forms at once rather than choosing between them', () => {
    const parsed = parseArgs([...REST, '--password-stdin', '--password=one-of-the-two-12'], 'the-other-one-12');
    expect(parsed).toEqual({ error: expect.stringContaining('not both') });
  });

  it('refuses --password-stdin over an empty input, naming the flag', () => {
    expect(parseArgs([...REST, '--password-stdin'], '')).toEqual({
      error: expect.stringContaining('--password-stdin'),
    });
    expect(parseArgs([...REST, '--password-stdin'], undefined)).toEqual({
      error: expect.stringContaining('--password-stdin'),
    });
  });

  it('holds a password from standard input to the same length rule', () => {
    expect(parseArgs([...REST, '--password-stdin'], 'short')).toEqual({
      error: expect.stringContaining('at least 12'),
    });
  });

  it('without the flag, standard input is not read as a password', () => {
    expect(wantsPasswordFromStdin(REST)).toBe(false);
    expect(parseArgs(REST, 'a-password-they-remember')).toEqual({
      error: 'Missing required flag: --password=...',
    });
  });
});
