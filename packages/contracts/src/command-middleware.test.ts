import { describe, expect, it } from 'vitest';
import {
  COMMAND_ADMIT_TIMEOUT_DEFAULT_MS,
  COMMAND_ADMIT_TIMEOUT_MAX_MS,
  COMMAND_MIDDLEWARE_PHASES,
  COMMAND_OBSERVE_MAX_IN_FLIGHT,
  COMMAND_OBSERVE_TIMEOUT_DEFAULT_MS,
  COMMAND_OBSERVE_TIMEOUT_MAX_MS,
  CommandMiddlewareDeclarationSchema,
  assertCommandMiddlewareRules,
  commandActionFilterRe,
  commandActionFilterMatches,
} from './command-middleware.js';

/**
 * `specs/189-command-middleware/` T003 (FR-001, FR-003) — the manifest
 * declaration of command middleware, `contracts/command-middleware-api.md` §1.
 */

describe('command middleware constants (contract §1)', () => {
  it('offers exactly two phases, and no transform', () => {
    expect(COMMAND_MIDDLEWARE_PHASES).toEqual(['admit', 'observe']);
  });

  it('states the budgets and the in-flight cap the contract names', () => {
    expect(COMMAND_ADMIT_TIMEOUT_DEFAULT_MS).toBe(100);
    expect(COMMAND_ADMIT_TIMEOUT_MAX_MS).toBe(500);
    expect(COMMAND_OBSERVE_TIMEOUT_DEFAULT_MS).toBe(1000);
    expect(COMMAND_OBSERVE_TIMEOUT_MAX_MS).toBe(5000);
    expect(COMMAND_OBSERVE_MAX_IN_FLIGHT).toBe(1000);
  });
});

describe('commandActionFilterRe', () => {
  it('accepts a full action and a prefix ending in "."', () => {
    expect(commandActionFilterRe.test('organization.register')).toBe(true);
    expect(commandActionFilterRe.test('organization.tax_id.change')).toBe(true);
    expect(commandActionFilterRe.test('organization.')).toBe(true);
    expect(commandActionFilterRe.test('organization')).toBe(true);
  });

  it('refuses upper case, an empty segment and a wildcard inside a list', () => {
    expect(commandActionFilterRe.test('Organization.register')).toBe(false);
    expect(commandActionFilterRe.test('organization..register')).toBe(false);
    expect(commandActionFilterRe.test('.register')).toBe(false);
    expect(commandActionFilterRe.test('*')).toBe(false);
    expect(commandActionFilterRe.test('organization.*')).toBe(false);
  });
});

describe('commandActionFilterMatches (contract §4)', () => {
  it("matches every action for '*'", () => {
    expect(commandActionFilterMatches('*', 'anything.at_all')).toBe(true);
  });

  it('matches a full action only itself, and a prefix every action under it', () => {
    expect(commandActionFilterMatches(['organization.register'], 'organization.register')).toBe(true);
    expect(commandActionFilterMatches(['organization.register'], 'organization.register_more')).toBe(false);
    expect(commandActionFilterMatches(['organization.'], 'organization.admin_patch')).toBe(true);
    expect(commandActionFilterMatches(['organization.'], 'organizations.create')).toBe(false);
  });

  it('matches a bare `organization` only to the action `organization`, never `organization.register`', () => {
    expect(commandActionFilterMatches(['organization'], 'organization')).toBe(true);
    expect(commandActionFilterMatches(['organization'], 'organization.register')).toBe(false);
  });
});

describe('CommandMiddlewareDeclarationSchema (FR-001)', () => {
  it('accepts an admit for every action and an observe for a list', () => {
    expect(CommandMiddlewareDeclarationSchema.parse({ id: 'legal-hold', phase: 'admit', actions: '*' })).toEqual({
      id: 'legal-hold',
      phase: 'admit',
      actions: '*',
    });
    expect(
      CommandMiddlewareDeclarationSchema.parse({
        id: 'timing',
        phase: 'observe',
        actions: ['organization.', 'quote.convert'],
        timeoutMs: 2000,
      }).timeoutMs,
    ).toBe(2000);
  });

  it('refuses a non-kebab id, an unknown phase, an empty list, an unknown key and a bad filter', () => {
    const bad = [
      { id: 'Legal_Hold', phase: 'admit', actions: '*' },
      { id: 'legal-hold', phase: 'transform', actions: '*' },
      { id: 'legal-hold', phase: 'admit', actions: [] },
      { id: 'legal-hold', phase: 'admit', actions: '*', origin: 'core' },
      { id: 'legal-hold', phase: 'admit', actions: ['Organization.'] },
      { id: 'legal-hold', phase: 'admit', actions: '*', timeoutMs: 0 },
      { id: 'legal-hold', phase: 'admit', actions: '*', timeoutMs: 1.5 },
    ];
    for (const value of bad) expect(CommandMiddlewareDeclarationSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });
});

describe('assertCommandMiddlewareRules (FR-001, FR-003)', () => {
  const rules = (commandMiddleware: unknown) => () =>
    assertCommandMiddlewareRules({ id: 'acme_hold', commandMiddleware } as Parameters<typeof assertCommandMiddlewareRules>[0]);

  it('accepts a manifest with none, and one with distinct ids', () => {
    expect(rules(undefined)).not.toThrow();
    expect(
      rules([
        { id: 'hold', phase: 'admit', actions: '*', timeoutMs: COMMAND_ADMIT_TIMEOUT_MAX_MS },
        { id: 'timing', phase: 'observe', actions: ['organization.'], timeoutMs: COMMAND_OBSERVE_TIMEOUT_MAX_MS },
      ]),
    ).not.toThrow();
  });

  it('refuses one id declared twice, naming the module and the id', () => {
    expect(
      rules([
        { id: 'hold', phase: 'admit', actions: '*' },
        { id: 'hold', phase: 'observe', actions: '*' },
      ]),
    ).toThrow(/acme_hold.*'hold'/);
  });

  it('refuses a timeoutMs above its phase maximum', () => {
    expect(rules([{ id: 'hold', phase: 'admit', actions: '*', timeoutMs: COMMAND_ADMIT_TIMEOUT_MAX_MS + 1 }])).toThrow(
      /acme_hold.*hold.*500/,
    );
    expect(
      rules([{ id: 'timing', phase: 'observe', actions: '*', timeoutMs: COMMAND_OBSERVE_TIMEOUT_MAX_MS + 1 }]),
    ).toThrow(/acme_hold.*timing.*5000/);
    // An observe budget above the admit cap is fine: each phase has its own.
    expect(rules([{ id: 'timing', phase: 'observe', actions: '*', timeoutMs: 900 }])).not.toThrow();
  });

  it('refuses a duplicate filter entry, and one a shorter prefix in the same list already covers', () => {
    expect(rules([{ id: 'hold', phase: 'admit', actions: ['quote.convert', 'quote.convert'] }])).toThrow(
      /acme_hold.*hold.*quote\.convert/,
    );
    expect(rules([{ id: 'hold', phase: 'admit', actions: ['organization.', 'organization.register'] }])).toThrow(
      /acme_hold.*hold.*organization\.register.*organization\./,
    );
    expect(rules([{ id: 'hold', phase: 'admit', actions: ['organization.tax_id.', 'organization.'] }])).toThrow(
      /organization\.tax_id\./,
    );
    // A bare action is not a prefix, so it covers nothing under it.
    expect(rules([{ id: 'hold', phase: 'admit', actions: ['organization', 'organization.register'] }])).not.toThrow();
  });
});
