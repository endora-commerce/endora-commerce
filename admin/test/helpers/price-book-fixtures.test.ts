import { describe, expect, it } from 'vitest';
import {
  priceBookTargetAttributeSchema,
  priceBookTargetCategorySchema,
  priceBookTargetCustomerGroupSchema,
  priceBookTargetOrganizationSchema,
  priceBookTargetSalesChannelSchema,
} from '@endora-commerce/contracts';
import { CATALOG } from './price-book-fixtures';

/**
 * The editor's shared fixture (feature 161, T002) answers in the API's shapes.
 *
 * The books and rows are parsed when the fixture loads; the picker answers are
 * held here to the contracts' target schemas, which the live routes are held to
 * by `backend/test/contract/price_lists/price-book-targets.test.ts`. A category
 * or a channel is named per language there, so a screen tested over a plain
 * string name would be tested over data the server never sends.
 */
describe('price-book fixtures', () => {
  it('shapes every picker answer as the API does', () => {
    for (const category of CATALOG.categories) expect(priceBookTargetCategorySchema.parse(category)).toEqual(category);
    expect(priceBookTargetSalesChannelSchema.parse(CATALOG.channel)).toEqual(CATALOG.channel);
    for (const attribute of CATALOG.attributes) expect(priceBookTargetAttributeSchema.parse(attribute)).toEqual(attribute);
    for (const org of CATALOG.organizations) expect(priceBookTargetOrganizationSchema.parse(org)).toEqual(org);
    for (const group of CATALOG.customerGroups) expect(priceBookTargetCustomerGroupSchema.parse(group)).toEqual(group);
  });

  it('names categories and the channel in both admin languages', () => {
    for (const named of [...CATALOG.categories, CATALOG.channel]) {
      expect(Object.keys(named.name).sort()).toEqual(['en-US', 'pl-PL']);
    }
  });
});
