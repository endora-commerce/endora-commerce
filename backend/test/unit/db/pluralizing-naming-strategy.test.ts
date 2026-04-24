import { describe, expect, it } from 'vitest';
import {
  PluralizingNamingStrategy,
  pluralize,
  toSnakeCase,
} from '../../../src/db/pluralizing-naming-strategy.js';

describe('toSnakeCase', () => {
  it.each([
    ['Product', 'product'],
    ['ProductVariant', 'product_variant'],
    ['ComponentRoleTime', 'component_role_time'],
    ['CustomerAccount', 'customer_account'],
    ['CMSPage', 'cms_page'],
    ['Auth', 'auth'],
    ['Example', 'example'],
  ])('converts %s → %s', (input, expected) => {
    expect(toSnakeCase(input)).toBe(expected);
  });
});

describe('pluralize', () => {
  it.each([
    ['product', 'products'],
    ['customer_account', 'customer_accounts'],
    ['category', 'categories'],
    ['box', 'boxes'],
    ['dish', 'dishes'],
    ['batch', 'batches'],
    ['key', 'keys'],
    ['component_role_time', 'component_role_times'],
  ])('pluralizes %s → %s', (input, expected) => {
    expect(pluralize(input)).toBe(expected);
  });
});

describe('PluralizingNamingStrategy', () => {
  const strategy = new PluralizingNamingStrategy();

  it('maps a normal class name to a plural snake_case table', () => {
    expect(strategy.classToTableName('Product')).toBe('products');
    expect(strategy.classToTableName('ProductVariant')).toBe('product_variants');
    expect(strategy.classToTableName('ComponentRoleTime')).toBe('component_role_times');
  });

  it('preserves the two permitted singular exceptions', () => {
    expect(strategy.classToTableName('Auth')).toBe('auth');
    expect(strategy.classToTableName('Example')).toBe('example');
  });

  it('produces {singular}_id foreign keys', () => {
    expect(strategy.joinKeyColumnName('Offer')).toBe('offer_id');
    expect(strategy.joinKeyColumnName('CustomerAccount')).toBe('customer_account_id');
  });

  it('produces plural_plural_prop join-table names', () => {
    expect(strategy.joinTableName('Product', 'Category', 'categories')).toBe(
      'products_categories_categories',
    );
    expect(strategy.joinTableName('Order', 'Promotion', 'appliedPromotions')).toBe(
      'orders_promotions_applied_promotions',
    );
  });
});
