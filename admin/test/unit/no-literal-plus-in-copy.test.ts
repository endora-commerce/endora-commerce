import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Issue #1808 (item 1) — "+ + New channel". A button's plus is the `Plus`
 * icon beside its label; a translation that starts with a literal "+" doubles
 * it, or stands in for an icon the button should carry. "+{count} more" is a
 * count, not an action, and stays: only a "+" followed by a space is refused.
 */
const MODULES = resolve(process.cwd(), '../packages/modules');

function offenders(): string[] {
  const found: string[] = [];
  for (const module of readdirSync(MODULES)) {
    for (const language of ['en', 'pl']) {
      const file = join(MODULES, module, 'i18n', `${language}.json`);
      if (!existsSync(file)) continue;
      const entries = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value === 'string' && /^\+\s/.test(value)) found.push(`${module}/${language}: ${key}`);
      }
    }
  }
  return found;
}

describe('no translation carries a literal "+" for an action (issue #1808)', () => {
  it('leaves the plus to the button icon', () => {
    expect(offenders()).toEqual([]);
  });
});
