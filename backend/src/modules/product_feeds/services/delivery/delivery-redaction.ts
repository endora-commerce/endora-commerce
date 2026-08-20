/**
 * Redaction for everything a delivery attempt records — feature 070 / FR-108.
 *
 * A transport library will put a password into an error message. `ssh2` names
 * the authentication method it tried; `basic-ftp` echoes the whole control
 * conversation, `PASS` line included; an HTTP client stringifies the request it
 * failed on. Any of those reaches `failure_detail`, which is rendered on an
 * admin screen and readable by anyone with `product_feeds:read`.
 *
 * So nothing goes into an attempt row without passing through here, and the
 * redactor is **value-driven rather than pattern-driven**: it is handed the
 * exact secrets in play and removes those strings, instead of trying to
 * recognise what a password looks like. A regex for "things that look secret"
 * misses the password `hunter2` and mangles a directory path that happens to
 * contain a long hex segment.
 */

/** The marker left in place of a removed secret. */
export const REDACTED_MARKER = '[redacted]';

/** One line, bounded, no stack trace — this ends up on an admin screen. */
const MAX_DETAIL_LENGTH = 2000;
/**
 * Below this a "secret" is not distinctive enough to remove safely: blanking
 * every occurrence of the password `ab` would shred the message around it and
 * tell the reader nothing.
 */
const MIN_REDACTABLE_LENGTH = 4;

export interface RedactionInput {
  /** The secret values in play for this attempt, in any order. */
  secrets: Array<string | null | undefined>;
}

/**
 * Removes every occurrence of every known secret from `text`, then bounds it.
 *
 * Case-insensitive, because a transport may upper-case what it echoes, and
 * applied to the raw string rather than to parsed fields — the whole point is
 * that we do not know where in the message a library chose to put it.
 */
export function redactSecrets(text: string, input: RedactionInput): string {
  let out = text;
  for (const secret of input.secrets) {
    if (typeof secret !== 'string') continue;
    const trimmed = secret.trim();
    if (trimmed.length < MIN_REDACTABLE_LENGTH) continue;
    out = replaceAllInsensitive(out, trimmed, REDACTED_MARKER);
    // A private key arrives as a PEM block; a message that quotes one line of it
    // has quoted the key. Each line long enough to be distinctive is removed on
    // its own, so a partial echo is caught as well as a whole one.
    if (trimmed.includes('\n')) {
      for (const line of trimmed.split(/\r?\n/)) {
        const candidate = line.trim();
        if (candidate.length >= 16 && !candidate.startsWith('---')) {
          out = replaceAllInsensitive(out, candidate, REDACTED_MARKER);
        }
      }
    }
  }
  return out;
}

/**
 * A transport error rendered for an operator: one line, no stack, secrets gone.
 * Never throws — a redaction failure must not turn a recorded delivery failure
 * into an unrecorded crash.
 */
export function toFailureDetail(err: unknown, input: RedactionInput): string {
  let message: string;
  try {
    message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  } catch {
    message = 'The transport failed with an error that could not be rendered.';
  }
  const collapsed = message.replace(/\s+/g, ' ').trim();
  return redactSecrets(collapsed, input).slice(0, MAX_DETAIL_LENGTH);
}

function replaceAllInsensitive(haystack: string, needle: string, replacement: string): string {
  if (needle === '') return haystack;
  let out = '';
  let index = 0;
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  for (;;) {
    const at = lowerHaystack.indexOf(lowerNeedle, index);
    if (at === -1) {
      out += haystack.slice(index);
      return out;
    }
    out += haystack.slice(index, at) + replacement;
    index = at + needle.length;
  }
}
