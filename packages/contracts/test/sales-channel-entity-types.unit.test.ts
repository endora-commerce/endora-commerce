import { describe, expect, it } from 'vitest';
import { ChannelMemberEntityTypeSchema } from '../src/sales-channels.js';

/**
 * Feature 160 (D-287 P1) — a price book's channel set is a registered
 * Principle XII bridge (`sales_channel_price_lists`), so its entity type is a
 * member of the published channel-membership vocabulary.
 */
describe('channel-membership entity types', () => {
  it("accepts 'price-list'", () => {
    expect(ChannelMemberEntityTypeSchema.safeParse('price-list').success).toBe(true);
  });

  it('still refuses a type nothing owns', () => {
    expect(ChannelMemberEntityTypeSchema.safeParse('price-book').success).toBe(false);
  });
});
