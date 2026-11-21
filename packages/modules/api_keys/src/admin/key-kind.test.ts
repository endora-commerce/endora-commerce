import { describe, expect, it } from 'vitest';
import { apiKeyScopeSchema } from '@endora-commerce/contracts';
import { scopesForKeyKind } from './key-kind.js';

describe('scopesForKeyKind (issue #1551, SHELL-15)', () => {
  it('a platform key is offered every scope except the order scopes (B1)', () => {
    expect(scopesForKeyKind('platform')).toEqual(['catalog:read', 'catalog:write', 'platform.api_description.read']);
  });

  it('an organization key is offered every scope except catalog:write (B2)', () => {
    expect(scopesForKeyKind('organization')).toEqual([
      'catalog:read',
      'orders:read',
      'orders:write',
      'platform.api_description.read',
    ]);
  });

  it('every contract scope is offered by at least one kind', () => {
    const offered = new Set([...scopesForKeyKind('platform'), ...scopesForKeyKind('organization')]);
    expect([...offered].sort()).toEqual([...apiKeyScopeSchema.options].sort());
  });
});
