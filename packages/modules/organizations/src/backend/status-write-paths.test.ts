import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Issue #1468 (SALES-01, DEC-07) — an existing organization's status has exactly one writer:
 * moderation — the four Commands `OrganizationModerationService` runs (`approve` / `reject` /
 * `block` / `unblock`, and the auto-approval on registration; `specs/186-aggregate-ports/`
 * T026) — the only path that checks the state machine, stamps
 * `approvedAt` / `blockedAt` / `blockedReason`, emits `organization.status_changed.v1` and
 * sends the customer e-mail.
 *
 * The admin `PATCH` used to assign it directly and bypass all of that; so did the e-mail
 * verification until issue #1893, activating a pending, a rejected or a blocked organization
 * whatever the moderation mode. Creation sets the initial
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
  it('are moderation only', () => {
    const writers = sources(BACKEND)
      .filter((path) => ASSIGNS_STATUS.test(readFileSync(path, 'utf8')))
      .map((path) => relative(BACKEND, path))
      .sort();
    expect(writers).toEqual([
      'commands/approve-organization.command.ts',
      'commands/block-organization.command.ts',
      'commands/reject-organization.command.ts',
      'commands/unblock-organization.command.ts',
    ]);
  });

  it('do not include the admin PATCH command', () => {
    const text = readFileSync(join(BACKEND, 'commands/admin-patch-organization.command.ts'), 'utf8');
    expect(text).not.toMatch(/changes\.status\b/);
  });
});
