import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Issue #745 — no storefront page puts a sentence into the query string it
 * redirects to. A redirect's `?error=` / `?reason=` is text anyone can put on
 * the page with a crafted link, so it carries a code (`lib/url-errors.ts`) and
 * the page words it. A code is a fixed ASCII token, so it needs no
 * `encodeURIComponent`; a value that does is a sentence, an API `detail` or
 * typed text, and none of them may travel.
 *
 * The per-page tests in this directory are the evidence that a crafted value
 * never reaches the screen; this is the net that catches the next call site.
 */

const APP = resolve(import.meta.dirname, '../../app');

/** Pages not swept yet — the list only shrinks; issue #745 emptied it. */
const NOT_YET_SWEPT = new Set<string>([]);

/** A message parameter whose value is encoded — i.e. not a code. */
const SENTENCE_IN_URL = /\b(?:error|reason|couponError)=(?:\$\{\s*encodeURIComponent\(|'\s*\+\s*encodeURIComponent\()/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** An e-mail address in a query string (issue #745: no personal data in a URL). */
const EMAIL_IN_URL = /[?&]email=\$\{/;

const files = sources(APP).map((path) => relative(APP, path).split('\\').join('/'));

const offenders = files
  .filter((file) => SENTENCE_IN_URL.test(readFileSync(join(APP, file), 'utf8')));

describe('no page redirects with a sentence in ?error= / ?reason= (issue #745)', () => {
  it('every swept page carries a code', () => {
    expect(offenders.filter((file) => !NOT_YET_SWEPT.has(file))).toEqual([]);
  });

  it('the not-yet-swept list names only pages that still need it', () => {
    expect([...NOT_YET_SWEPT].filter((file) => !offenders.includes(file))).toEqual([]);
  });

  it('no page puts an e-mail address into a URL', () => {
    expect(files.filter((file) => EMAIL_IN_URL.test(readFileSync(join(APP, file), 'utf8')))).toEqual([]);
  });
});
