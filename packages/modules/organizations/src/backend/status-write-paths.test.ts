import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Issue #1468 (SALES-01, DEC-07) — an existing organization's status has exactly two writers:
 *
 * - `OrganizationModerationService` (`approve` / `reject` / `block` / `unblock`, and the
 *   auto-approval on registration) — the only path that checks the state machine, stamps
 *   `approvedAt` / `blockedAt` / `blockedReason`, emits `organization.status_changed.v1` and
 *   sends the customer e-mail;
 * - `email-verification-service.ts`, which activates on a verified address.
 *
 * The admin `PATCH` used to assign it directly and bypass all of that. Creation sets the initial
 * status on `em.create`, so the ledger matches assignments only. A new assignment fails this test
 * until it is either routed through moderation or listed here with a reason.
 */
const BACKEND = fileURLToPath(new URL('.', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

const ASSIGNS_STATUS = /\b(org|organization)\.status\s*=(?!=)/;

describe('the writes of organizations.status', () => {
  it('are moderation and e-mail verification only', () => {
    const writers = sources(BACKEND)
      .filter((path) => ASSIGNS_STATUS.test(readFileSync(path, 'utf8')))
      .map((path) => relative(BACKEND, path))
      .sort();
    expect(writers).toEqual([
      'services/email-verification-service.ts',
      'services/organization-moderation-service.ts',
    ]);
  });

  it('do not include the admin PATCH command', () => {
    const text = readFileSync(join(BACKEND, 'commands/admin-patch-organization.command.ts'), 'utf8');
    expect(text).not.toMatch(/changes\.status\b/);
  });
});
