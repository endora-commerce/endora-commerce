import { describe, expect, expectTypeOf, it } from 'vitest';
import { ERROR_CODES } from './errors.js';
import * as contracts from './index.js';
import {
  ENTITY_EXTENSION_INCLUDE_MAX,
  EntityExtensionIncludeSchema,
  entityExtensionModuleOf,
  type EntityExtensionInclude,
  type EntityExtensionReadOptions,
  type WithEntityExtensions,
} from './entity-extensions.js';

/**
 * `specs/187-side-table-extensions/` T032 (FR-050 – FR-052) — the include
 * family a host read port accepts, `contracts/extension-attributes-read-ports.md`
 * §1.
 */

describe('EntityExtensionIncludeSchema (§1)', () => {
  it.each(['extensions.acme_links', 'extensions._i18n', 'extensions.a', 'extensions.mod2_x'])('accepts %s', (value) => {
    expect(EntityExtensionIncludeSchema.parse(value)).toBe(value);
  });

  it.each([
    'acme_links',
    'extensions.',
    'extensions.Acme',
    'extensions.acme-links',
    'extensions.acme_links.extra',
    'extensions.2acme',
    'customFields.acme',
    ' extensions.acme',
  ])('refuses %j', (value) => {
    expect(EntityExtensionIncludeSchema.safeParse(value).success).toBe(false);
  });

  it('names the module an include addresses', () => {
    expect(entityExtensionModuleOf('extensions.acme_links')).toBe('acme_links');
  });

  it('bounds a read at eight includes', () => {
    expect(ENTITY_EXTENSION_INCLUDE_MAX).toBe(8);
  });
});

describe('the read option types (§1)', () => {
  it('carries an optional, read-only include list', () => {
    expectTypeOf<EntityExtensionReadOptions>().toEqualTypeOf<{
      readonly include?: readonly EntityExtensionInclude[];
    }>();
    const none: EntityExtensionReadOptions = {};
    expect(none.include).toBeUndefined();
  });

  it('adds an optional extensions map to a host record', () => {
    type Record = { readonly id: string; readonly name: string };
    expectTypeOf<WithEntityExtensions<Record>>().toMatchTypeOf<Record>();
    expectTypeOf<WithEntityExtensions<Record>['extensions']>().toEqualTypeOf<
      Readonly<globalThis.Record<string, unknown>> | undefined
    >();
    // A record without the key is still a WithEntityExtensions record.
    const plain: WithEntityExtensions<Record> = { id: '1', name: 'n' };
    expect(plain.extensions).toBeUndefined();
  });
});

describe('ENTITY_EXTENSION_UNCLAIMED', () => {
  it('is a platform error code', () => {
    expect(ERROR_CODES.ENTITY_EXTENSION_UNCLAIMED).toBe('ENTITY_EXTENSION_UNCLAIMED');
  });

  it('is published from the package entry point', () => {
    expect(contracts.EntityExtensionIncludeSchema).toBe(EntityExtensionIncludeSchema);
    expect(contracts.ENTITY_EXTENSION_INCLUDE_MAX).toBe(8);
  });
});
