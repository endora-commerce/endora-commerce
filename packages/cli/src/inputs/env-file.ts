/**
 * The `.env` a command reads values from and writes values into.
 *
 * `specs/117-instance-bring-up/contracts/input-resolution.md` tier 2, and R1.3:
 * **this is not a configuration file for the tool**. `cli-product.md` R2.5's
 * *"there is no `.endorarc`"* stands unamended. Nothing in a `.env` changes a
 * verdict, a rule or a behaviour of the CLI — it supplies values, exactly as a
 * flag does, and it is the *instance's* own runtime configuration, which is to
 * say the artefact the command's own output already contains.
 *
 * ## Blank does not answer
 *
 * `SESSION_COOKIE_SECRET=` and no line at all are the same state for whoever has
 * to fix it, so a blank value does not resolve an input: it is skipped, and the
 * input goes on to the next tier. Reading it as an answer would let a run print
 * `env-file=6` over six empty strings and a shop boot with an unsigned session
 * cookie — a provenance line that is true about where it looked and false about
 * what it found. `storefront/lib/env.mjs` makes the same call for the same
 * reason and calls the state `missing` rather than malformed.
 *
 * ## What it deliberately does not implement
 *
 * No variable expansion (`${OTHER}`), no multi-line values, no `.env.local`
 * chain. Each is a dialect: `dotenv`, `pnpm`, Next and Docker Compose disagree
 * about all three, and a scaffold that picked one would write a file that means
 * something different to the tool that reads it next. What is implemented is the
 * intersection every one of them agrees on — `KEY=value`, one line, optional
 * quotes, `#` comments — and a line outside it is left alone rather than
 * rewritten.
 */

/** One line the file already carries, as it was written. */
interface ParsedLine {
  readonly key: string | null;
  readonly value: string;
}

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function unquote(raw: string): string {
  const trimmed = raw.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
  return quoted === null ? trimmed : quoted[2]!;
}

function parseLine(line: string): ParsedLine {
  if (/^\s*(#|$)/.test(line)) return { key: null, value: line };
  const match = ASSIGNMENT.exec(line);
  if (match === null) return { key: null, value: line };
  return { key: match[1]!, value: unquote(match[2]!) };
}

/**
 * Every value the file supplies, in file order.
 *
 * A blank value is **absent** — see the header. A key repeated in one file keeps
 * the last assignment, which is what every reader of a `.env` does.
 */
export function parseEnvFile(text: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    const parsed = parseLine(line);
    if (parsed.key === null) continue;
    if (parsed.value.length === 0) {
      values.delete(parsed.key);
      continue;
    }
    values.set(parsed.key, parsed.value);
  }
  return values;
}

/**
 * A value as it is written back, quoted only where it has to be.
 *
 * A generated secret is base64 and needs no quoting; a URL needs none. What does
 * is a value carrying a space, a quote or a `#`, because an unquoted `#` starts
 * a comment in every dialect above and would truncate the value silently.
 */
export function renderEnvValue(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(value)) return value;
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

/**
 * The file's new text: every existing line kept, in place, with the values this
 * run resolved written over the keys they name and appended where they are new.
 *
 * **Kept in place** rather than re-rendered, because the operator may already
 * have put comments, ordering and their own keys in it, and a scaffold that
 * rewrote the file would silently discard all three. That is the same rule
 * `endora new storefront` applies to a directory it will not merge into, one
 * granularity down.
 */
export function writeEnvFile(
  existingText: string,
  values: ReadonlyMap<string, string>,
): string {
  const remaining = new Map(values);
  const lines = existingText.length === 0 ? [] : existingText.split('\n');
  const rewritten = lines.map((line) => {
    const parsed = parseLine(line);
    if (parsed.key === null || !remaining.has(parsed.key)) return line;
    const value = remaining.get(parsed.key)!;
    remaining.delete(parsed.key);
    return `${parsed.key}=${renderEnvValue(value)}`;
  });
  // A trailing empty line is the file's own last newline; append before it so
  // the result ends in exactly one.
  while (rewritten.length > 0 && rewritten[rewritten.length - 1]!.trim().length === 0) {
    rewritten.pop();
  }
  for (const [key, value] of remaining) rewritten.push(`${key}=${renderEnvValue(value)}`);
  return `${rewritten.join('\n')}\n`;
}
