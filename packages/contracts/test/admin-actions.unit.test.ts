import { describe, expect, it } from 'vitest';
import {
  AdminActionViewSchema,
  GetAdminActionsQuerySchema,
  GetAdminActionsResponseSchema,
  KnownIconNameSchema,
  ModuleActionSchema,
  ModuleActionsManifestSchema,
} from '../src/admin-actions.js';

const validAction = {
  id: 'new-product',
  labelKey: 'catalog.actions.newProduct.label',
  icon: 'Plus',
  targetRoute: '/catalog/products/new',
  requiredPermission: 'catalog:write',
  keywords: ['product', 'new', 'create'],
  weight: 100,
} as const;

describe('ModuleActionSchema', () => {
  it('accepts a fully populated action', () => {
    expect(() => ModuleActionSchema.parse(validAction)).not.toThrow();
  });

  it('accepts an action with only required fields', () => {
    const minimal = {
      id: 'open-x',
      labelKey: 'm.actions.openX.label',
      icon: 'Settings',
      targetRoute: '/x',
    };
    const parsed = ModuleActionSchema.parse(minimal);
    // Defaults populate optional fields.
    expect(parsed.keywords).toEqual([]);
    expect(parsed.weight).toBe(100);
    expect(parsed.descriptionKey).toBeUndefined();
    expect(parsed.requiredPermission).toBeUndefined();
  });

  it('rejects ids that do not match the slug pattern', () => {
    const cases = ['NewProduct', 'new_product', '1abc', 'a', '-leading', 'has space'];
    for (const id of cases) {
      expect(() => ModuleActionSchema.parse({ ...validAction, id })).toThrow();
    }
  });

  it('accepts boundary-length ids (2 and 64 chars)', () => {
    const short = 'ab';
    const long = 'a' + 'b'.repeat(63);
    expect(() => ModuleActionSchema.parse({ ...validAction, id: short })).not.toThrow();
    expect(() => ModuleActionSchema.parse({ ...validAction, id: long })).not.toThrow();
  });

  it('rejects invalid translation keys', () => {
    const cases = ['.leading', 'trailing.', 'CamelTop.foo', 'a..b', ''];
    for (const labelKey of cases) {
      expect(() => ModuleActionSchema.parse({ ...validAction, labelKey })).toThrow();
    }
  });

  it('rejects icon names not in the allowlist', () => {
    expect(() =>
      ModuleActionSchema.parse({ ...validAction, icon: 'Sparklez' as unknown as string }),
    ).toThrow();
  });

  it('rejects routes without a leading slash', () => {
    expect(() =>
      ModuleActionSchema.parse({ ...validAction, targetRoute: 'catalog/x' }),
    ).toThrow();
  });

  it('rejects negative weight and weight above the cap', () => {
    expect(() => ModuleActionSchema.parse({ ...validAction, weight: -1 })).toThrow();
    expect(() => ModuleActionSchema.parse({ ...validAction, weight: 10000 })).toThrow();
  });

  it('rejects 11 keywords and accepts 10', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `kw${i}`);
    const eleven = [...ten, 'overflow'];
    expect(() => ModuleActionSchema.parse({ ...validAction, keywords: ten })).not.toThrow();
    expect(() => ModuleActionSchema.parse({ ...validAction, keywords: eleven })).toThrow();
  });

  it('rejects empty-after-trim keyword strings', () => {
    expect(() =>
      ModuleActionSchema.parse({ ...validAction, keywords: ['', 'product'] }),
    ).toThrow();
    expect(() =>
      ModuleActionSchema.parse({ ...validAction, keywords: ['   ', 'product'] }),
    ).toThrow();
  });
});

describe('ModuleActionsManifestSchema', () => {
  it('accepts an empty array', () => {
    expect(() => ModuleActionsManifestSchema.parse([])).not.toThrow();
  });

  it('accepts multiple actions with different ids', () => {
    const actions = [
      { ...validAction, id: 'one' },
      { ...validAction, id: 'two' },
    ];
    expect(() => ModuleActionsManifestSchema.parse(actions)).not.toThrow();
  });

  it('rejects two actions sharing the same id', () => {
    const actions = [
      { ...validAction, id: 'dup' },
      { ...validAction, id: 'dup' },
    ];
    // Zod v4 serializes the issue list into the error message; match
    // on a literal substring rather than the surrounding quoting.
    expect(() => ModuleActionsManifestSchema.parse(actions)).toThrow(/Duplicate action id/);
    expect(() => ModuleActionsManifestSchema.parse(actions)).toThrow(/dup/);
  });
});

describe('KnownIconNameSchema', () => {
  it('accepts every name in the allowlist', () => {
    const names = KnownIconNameSchema.options;
    for (const name of names) {
      expect(() => KnownIconNameSchema.parse(name)).not.toThrow();
    }
  });

  it('rejects an icon name outside the allowlist', () => {
    expect(() => KnownIconNameSchema.parse('NotARealIcon')).toThrow();
  });

  // Feature 067 — the Product Feed module's sidebar entry and landing palette
  // action both use `Rss`, so the two agree visually.
  it('accepts the feed icon', () => {
    expect(() => KnownIconNameSchema.parse('Rss')).not.toThrow();
  });
});

describe('GetAdminActionsQuerySchema', () => {
  it('accepts a valid language', () => {
    expect(() => GetAdminActionsQuerySchema.parse({ language: 'en' })).not.toThrow();
  });

  it('rejects a missing language', () => {
    expect(() => GetAdminActionsQuerySchema.parse({})).toThrow();
  });

  it('rejects an unsupported language', () => {
    expect(() => GetAdminActionsQuerySchema.parse({ language: 'xx' })).toThrow();
  });
});

describe('GetAdminActionsResponseSchema', () => {
  const view = {
    moduleId: 'catalog',
    actionId: 'new-product',
    label: 'New product',
    description: null,
    icon: 'Plus',
    targetRoute: '/catalog/products/new',
    keywords: ['product'],
    weight: 100,
  };

  it('accepts a valid response with actions', () => {
    const response = {
      data: [view],
      meta: { language: 'en', total: 1, registryVersion: 7 },
    };
    expect(() => GetAdminActionsResponseSchema.parse(response)).not.toThrow();
  });

  it('accepts an empty response', () => {
    const response = {
      data: [],
      meta: { language: 'en', total: 0, registryVersion: 0 },
    };
    expect(() => GetAdminActionsResponseSchema.parse(response)).not.toThrow();
  });

  it('rejects a response with negative registryVersion', () => {
    const response = {
      data: [],
      meta: { language: 'en', total: 0, registryVersion: -1 },
    };
    expect(() => GetAdminActionsResponseSchema.parse(response)).toThrow();
  });

  it('AdminActionView accepts null description', () => {
    expect(() => AdminActionViewSchema.parse(view)).not.toThrow();
  });
});
