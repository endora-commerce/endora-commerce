import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Issue #1536 (UX audit CONTENT-19) — the transactional e-mail list names the
 * module that sends each e-mail by that module's `module.name`, read from the
 * module's own bundle, and prints the id only when there is none. So every
 * module that declares a transactional e-mail ships that name, in both
 * languages; a new one that does not is caught here, not on the demo.
 */

const MODULES = resolve(process.cwd(), '../packages/modules');

function emailSenders(): string[] {
  return readdirSync(MODULES).filter((id) => {
    const manifest = resolve(MODULES, id, 'src', 'manifest.ts');
    return existsSync(manifest) && /\btransactionalEmails:\s*\[/.test(readFileSync(manifest, 'utf8'));
  });
}

describe('modules that send transactional e-mails name themselves (#1536)', () => {
  const senders = emailSenders();

  it('finds the senders', () => {
    expect(senders).toEqual(expect.arrayContaining(['orders', 'quote_requests', 'invoices']));
  });

  it.each(['en', 'pl'] as const)('every sender ships module.name in %s', (language) => {
    const missing = senders.filter((id) => {
      const bundle = JSON.parse(readFileSync(resolve(MODULES, id, 'i18n', `${language}.json`), 'utf8')) as Record<
        string,
        string
      >;
      return !bundle['module.name'];
    });
    expect(missing).toEqual([]);
  });
});
