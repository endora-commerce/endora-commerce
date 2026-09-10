import { describe, expect, it } from 'vitest';
import { resolveTenantContext } from './resolve-tenant-context.js';

/**
 * Feature 062 / T006 — tenant-context derivation for api_key actors
 * (contracts/api-key-binding.md §3, research §R5).
 *
 *  - a BOUND key pins the request to its organization + designated service
 *    customer account, with a first-class `api_key` actor for audit attribution;
 *  - an UNBOUND key keeps the legacy trusted system scope (PIM surface,
 *    FR-004/FR-020 compatibility).
 */
describe('resolveTenantContext — api_key actors (062)', () => {
  it('bound key → single-org context pinned to the binding', () => {
    const ctx = resolveTenantContext({
      kind: 'api_key',
      apiKeyId: 'key-1',
      organizationId: 'org-A',
      customerAccountId: 'cust-1',
    });
    expect(ctx).toEqual({
      mode: 'single-org',
      organizationId: 'org-A',
      customerAccountId: 'cust-1',
      actor: { kind: 'api_key', id: 'key-1' },
    });
  });

  it('unbound key → system context with reason actor:api_key', () => {
    const ctx = resolveTenantContext({ kind: 'api_key', apiKeyId: 'key-1' });
    expect(ctx.mode).toBe('system');
    expect(ctx.reason).toBe('actor:api_key');
    expect(ctx.actor).toEqual({ kind: 'system' });
  });

  it('unbound key with explicit null binding fields stays system-scoped', () => {
    const ctx = resolveTenantContext({
      kind: 'api_key',
      apiKeyId: 'key-1',
      organizationId: null,
      customerAccountId: null,
    });
    expect(ctx.mode).toBe('system');
    expect(ctx.reason).toBe('actor:api_key');
  });
});
