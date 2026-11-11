import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { CommandContext } from '@endora-commerce/platform/commands';
import { ORGANIZATION_AUDIT_KEYS } from '../services/organization-audit-state.js';
import {
  ORGANIZATION_TAX_ID_CHANGED,
  makeChangeTaxIdCommand,
  taxIdChangeRefusal,
} from './change-tax-id.command.js';

/**
 * Issue #1040 — `organization.tax_id.change` over a fake entity manager: the
 * refusals, the same-value no-op, the VAT-validation reset, the names-only
 * audit and the database refusal at the flush. The scope, the lock and the
 * constraints themselves are the integration suite's
 * (`backend/test/integration/organizations/change-tax-id.test.ts`).
 */

interface FakeOrg {
  id: string;
  isPersonal: boolean;
  taxId: string | null;
  path: string;
  deletedAt: Date | null;
  vatValidatedAt: Date | null;
  vatValidationProvider: string | null;
  vatValidationOutcome: string | null;
}

const ORG_ID = '00000000-0000-4000-8000-00000000a001';

function company(over: Partial<FakeOrg> = {}): FakeOrg {
  return {
    id: ORG_ID,
    isPersonal: false,
    taxId: 'PL5260250995',
    path: `/${ORG_ID}/`,
    deletedAt: null,
    vatValidatedAt: new Date('2026-11-01T10:00:00Z'),
    vatValidationProvider: 'mf_pl',
    vatValidationOutcome: 'validated',
    ...over,
  };
}

function context(org: FakeOrg | null, options: { held?: boolean; flushError?: unknown } = {}) {
  const statements: string[] = [];
  let flushed = 0;
  const em = {
    execute: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('for update')) return org ? [{ id: org.id }] : [];
      if (sql.includes('organization_tax_id_policy')) return [{ scope: 'global', updated_at: new Date(), updated_by_admin_user_id: null }];
      if (sql.includes('"tax_id" = ?')) return options.held ? [{ '?column?': 1 }] : [];
      return [];
    },
    findOne: async () => org,
    flush: async () => {
      flushed += 1;
      if (options.flushError) throw options.flushError;
    },
  };
  const ctx = {
    em,
    actor: { actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: null, kind: 'admin' },
  } as unknown as CommandContext;
  return { ctx, statements, flushed: () => flushed };
}

describe('organization.tax_id.change', () => {
  it('is the audited action on the organization itself', () => {
    const command = makeChangeTaxIdCommand({ organizationId: ORG_ID, input: { taxId: 'PL1234567890' } });
    expect(command).toMatchObject({ action: 'organization.tax_id.change', objectType: 'organization', objectId: ORG_ID });
  });

  it('changes the tax ID in place, resets the VAT validation and audits names only', async () => {
    const org = company();
    const { ctx, statements, flushed } = context(org);
    const command = makeChangeTaxIdCommand({ organizationId: ORG_ID, input: { taxId: 'pl 123-456-78-90' } });

    const outcome = await command.run(ctx);

    expect(org.taxId).toBe('PL1234567890');
    expect(org).toMatchObject({ vatValidatedAt: null, vatValidationProvider: null, vatValidationOutcome: null });
    expect(flushed()).toBe(1);
    // The row is locked first, then the scope is read inside the same transaction (FR-026).
    expect(statements[0]).toMatch(/for update/);
    expect(statements.some((sql) => sql.includes('organization_tax_id_policy'))).toBe(true);
    expect(outcome.skipAudit).toBeUndefined();
    expect(outcome.result).toEqual({ organization: org, changed: true });
    expect(outcome.before).toBeNull();
    expect(outcome.after).toEqual({ changedFields: ['taxId'], vatStatusReset: true, taxIdScope: 'global' });
    expect(JSON.stringify([outcome.before, outcome.after])).not.toMatch(/PL5260250995|PL1234567890|1234567890/);
    // `audit-state.md` §6 — the recorded keys are the module's allowlist.
    for (const key of Object.keys(outcome.after ?? {})) expect(ORGANIZATION_AUDIT_KEYS.has(key), key).toBe(true);
  });

  it('emits organization.tax_id_changed.v1 with the id and no tax ID', async () => {
    const org = company();
    const { ctx } = context(org);
    const command = makeChangeTaxIdCommand({ organizationId: ORG_ID, input: { taxId: 'PL1234567890' } });
    const outcome = await command.run(ctx);
    const event = command.event?.(outcome.result);
    expect(event?.eventName).toBe(ORGANIZATION_TAX_ID_CHANGED);
    expect(Object.keys(event!.payload).sort()).toEqual(['changedAt', 'eventId', 'occurredAt', 'organizationId']);
    expect(event!.payload).toMatchObject({ organizationId: ORG_ID });
    expect(JSON.stringify(event!.payload)).not.toMatch(/PL/);
  });

  it('changes nothing, audits nothing and emits nothing for the same value after normalisation', async () => {
    const org = company();
    const { ctx, flushed } = context(org);
    const command = makeChangeTaxIdCommand({ organizationId: ORG_ID, input: { taxId: 'pl 526-025-09-95' } });

    const outcome = await command.run(ctx);

    expect(outcome).toEqual({ result: { organization: org, changed: false }, skipAudit: true });
    expect(org.vatValidationOutcome).toBe('validated');
    expect(flushed()).toBe(0);
    expect(command.event?.(outcome.result)).toBeUndefined();
  });

  it('refuses a personal organization as not_company and a deleted one as deleted', async () => {
    for (const [org, token] of [
      [company({ isPersonal: true, taxId: null }), 'not_company'],
      [company({ deletedAt: new Date() }), 'deleted'],
    ] as const) {
      const { ctx, flushed } = context(org);
      await expect(
        makeChangeTaxIdCommand({ organizationId: ORG_ID, input: { taxId: 'PL1234567890' } }).run(ctx),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.ORGANIZATION_TAX_ID_CHANGE_REFUSED,
        details: { code: token },
      });
      expect(flushed()).toBe(0);
    }
  });

  it('answers 404 for an organization that does not exist', async () => {
    const { ctx } = context(null);
    await expect(
      makeChangeTaxIdCommand({ organizationId: ORG_ID, input: { taxId: 'PL1234567890' } }).run(ctx),
    ).rejects.toMatchObject({ statusCode: 404, code: ERROR_CODES.NOT_FOUND });
  });

  it('refuses a tax ID the active scope forbids with ORGANIZATION_TAX_ID_EXISTS, before writing', async () => {
    const org = company();
    const { ctx, flushed } = context(org, { held: true });
    await expect(
      makeChangeTaxIdCommand({ organizationId: ORG_ID, input: { taxId: 'PL1234567890' } }).run(ctx),
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS });
    expect(flushed()).toBe(0);
  });

  it('maps a 23505 or 23P01 at the flush to ORGANIZATION_TAX_ID_EXISTS (FR-021)', async () => {
    for (const error of [
      { code: '23505', constraint: 'organizations_tax_id_unique' },
      { previous: { code: '23P01', constraint: 'organizations_tax_id_one_tree' } },
    ]) {
      const { ctx } = context(company(), { flushError: Object.assign(new Error('refused'), error) });
      await expect(
        makeChangeTaxIdCommand({ organizationId: ORG_ID, input: { taxId: 'PL1234567890' } }).run(ctx),
      ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS });
    }
  });

  it('builds each refusal with its token and a sentence', () => {
    for (const token of ['not_company', 'deleted'] as const) {
      const refusal = taxIdChangeRefusal(token);
      expect(refusal).toMatchObject({ statusCode: 409, details: { code: token } });
      expect(refusal.message.length).toBeGreaterThan(10);
    }
  });
});
