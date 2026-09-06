/**
 * The environment-input declaration's shape, and the one predicate that makes
 * `specs/118-instance-member-selection/`'s member scoping cheap.
 *
 * The three assertions worth having here are the three that a later reader
 * would otherwise have to re-derive from prose:
 *
 *   * `describes` and `optional.without` ship **both** shipped languages, so a
 *     single-language declaration is a type error rather than a review item;
 *   * there is **no** `default` field, which `environment-inputs.md` R1.3
 *     forbids and which the provenance line's `defaulted=0` rests on;
 *   * scoping is by **declared consumer**, and the three inputs that name the
 *     admin are the proof that a name-based rule is wrong on two of them.
 */
import { describe, expect, it } from 'vitest';

import {
  ENVIRONMENT_CONSUMERS,
  EnvironmentInputSchema,
  type EnvironmentInput,
  isReadByAnyOf,
  isRequiredGiven,
  scopeToMembers,
} from '../src/environment-inputs.js';

const input = (over: Partial<EnvironmentInput>): EnvironmentInput => ({
  name: 'X',
  describes: { en: 'what it configures.', pl: 'co konfiguruje.' },
  requirement: { kind: 'required' },
  secret: false,
  generable: false,
  owner: { kind: 'platform' },
  consumers: ['backend'],
  ...over,
});

describe('the declaration shape', () => {
  it('accepts a whole entry', () => {
    expect(EnvironmentInputSchema.safeParse(input({})).success).toBe(true);
  });

  it('refuses a `describes` missing a shipped language', () => {
    const half = { ...input({}), describes: { en: 'only English.' } };
    expect(EnvironmentInputSchema.safeParse(half).success).toBe(false);
  });

  it('refuses an empty sentence, which is how a language goes missing quietly', () => {
    const blank = { ...input({}), describes: { en: 'set.', pl: '' } };
    expect(EnvironmentInputSchema.safeParse(blank).success).toBe(false);
  });

  it('refuses a declaration that reads no tree', () => {
    expect(EnvironmentInputSchema.safeParse({ ...input({}), consumers: [] }).success).toBe(false);
  });

  it('carries no `default`, which R1.3 forbids and `defaulted=0` rests on', () => {
    // Zod strips unknown keys rather than refusing them, so the assertion is
    // that the parsed value has no such member — a `default` an author wrote
    // reaches no reader, which is the property the rule needs.
    const withDefault = { ...input({}), default: 'postgresql://b2b:b2b@localhost:5432/b2b' };
    const parsed = EnvironmentInputSchema.parse(withDefault);
    expect(Object.keys(parsed)).not.toContain('default');
  });

  it('requires a `requiredWhen` to name the input it reads and the value it compares', () => {
    const conditional = input({
      requirement: { kind: 'requiredWhen', input: 'CATALOG_SEARCH_BACKEND', equals: 'meilisearch' },
    });
    expect(EnvironmentInputSchema.safeParse(conditional).success).toBe(true);
    const nameless = { ...conditional, requirement: { kind: 'requiredWhen', equals: 'x' } };
    expect(EnvironmentInputSchema.safeParse(nameless).success).toBe(false);
  });

  it('requires an `optional` to say what is lost, in both languages', () => {
    const bare = { ...input({}), requirement: { kind: 'optional' } };
    expect(EnvironmentInputSchema.safeParse(bare).success).toBe(false);
    const said = input({
      requirement: {
        kind: 'optional',
        without: {
          en: 'secret settings cannot be read or written.',
          pl: 'nie można odczytać ani zapisać ustawień z sekretami.',
        },
      },
    });
    expect(EnvironmentInputSchema.safeParse(said).success).toBe(true);
  });
});

describe('member scoping is by declared consumer, never by name', () => {
  // The three real inputs the rule is measured on, with their real consumers.
  const viteApiBaseUrl = input({ name: 'VITE_API_BASE_URL', consumers: ['admin'] });
  const adminBaseUrl = input({ name: 'ADMIN_BASE_URL', consumers: ['backend'] });
  const corsAllowedOrigins = input({ name: 'CORS_ALLOWED_ORIGINS', consumers: ['backend'] });
  const all = [viteApiBaseUrl, adminBaseUrl, corsAllowedOrigins];

  it('drops exactly the admin-read input when no admin member is written', () => {
    const scoped = scopeToMembers(all, ['backend', 'storefront']).map((entry) => entry.name);
    expect(scoped).toEqual(['ADMIN_BASE_URL', 'CORS_ALLOWED_ORIGINS']);
  });

  it('keeps the two whose names say "admin" and whose consumer is the backend', () => {
    // Written as its own case because it is the whole content of the rule: a
    // predicate over the spelling is wrong on two of these three, and both of
    // them matter *more* when the admin lives on another host.
    expect(isReadByAnyOf(adminBaseUrl, ['backend'])).toBe(true);
    expect(isReadByAnyOf(corsAllowedOrigins, ['backend'])).toBe(true);
    expect(isReadByAnyOf(viteApiBaseUrl, ['backend'])).toBe(false);
  });

  it('keeps the declaration order rather than an alphabet', () => {
    const ordered = scopeToMembers([corsAllowedOrigins, adminBaseUrl], ENVIRONMENT_CONSUMERS);
    expect(ordered.map((entry) => entry.name)).toEqual(['CORS_ALLOWED_ORIGINS', 'ADMIN_BASE_URL']);
  });
});

describe('a condition is answered against the values this run resolved', () => {
  const meili = input({
    name: 'MEILISEARCH_URL',
    requirement: { kind: 'requiredWhen', input: 'CATALOG_SEARCH_BACKEND', equals: 'meilisearch' },
  });

  it('is required when the input it names holds the value it compares', () => {
    expect(isRequiredGiven(meili, { CATALOG_SEARCH_BACKEND: 'meilisearch' })).toBe(true);
  });

  it('is not required otherwise, including when the condition is unset', () => {
    expect(isRequiredGiven(meili, { CATALOG_SEARCH_BACKEND: 'postgres' })).toBe(false);
    expect(isRequiredGiven(meili, {})).toBe(false);
  });

  it('answers an optional input `false` however the environment reads', () => {
    const optional = input({
      requirement: { kind: 'optional', without: { en: 'a is lost.', pl: 'a jest tracone.' } },
    });
    expect(isRequiredGiven(optional, {})).toBe(false);
  });
});
