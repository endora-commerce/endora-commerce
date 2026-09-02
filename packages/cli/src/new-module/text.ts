/**
 * The small text helpers the emitters share.
 *
 * They exist so a value the author typed is quoted **once**, in one place: a
 * label carrying an apostrophe, a description carrying a backslash, and a
 * reason carrying a newline are all things an author writes and a naive
 * `'${value}'` turns into a file that does not parse.
 */

/** A single-quoted TypeScript string literal, escaped. */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/** A JSON object rendered as a flat two-space-indented map, keys in the given order. */
export function flatJson(entries: readonly (readonly [string, string])[]): string {
  const body = entries.map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{\n${body.join(',\n')}\n}\n`;
}

/** `..`, `../..`, … — the path from a package directory back to the checkout root. */
export function rootPrefixFor(depth: number): string {
  return new Array(depth).fill('..').join('/');
}
