import { describe, expect, it } from 'vitest';
import { methodsOfferedInChannel } from '../../../../packages/modules/orders/src/admin/pages/OrderCreatePage';

/**
 * The create-order form offers, for the delivery and the payment method, only
 * the methods the **chosen** sales channel offers — the rule the server
 * enforces on preview and on create, applied to the two selects so an operator
 * is not handed an option that would be refused.
 *
 * A method bound to no channel is offered in every one, and with no channel
 * chosen yet the lists are not narrowed at all.
 */
const A = 'channel-a';
const B = 'channel-b';

const methods = [
  { id: 'only-a', salesChannelIds: [A] },
  { id: 'only-b', salesChannelIds: [B] },
  { id: 'both', salesChannelIds: [A, B] },
  { id: 'unbound', salesChannelIds: [] },
  // A row from an older API that did not carry the field: unrestricted.
  { id: 'no-field' },
];

const ids = (list: Array<{ id: string }>): string[] => list.map((m) => m.id);

describe('methodsOfferedInChannel', () => {
  it('keeps the methods bound to the channel and the methods bound to none', () => {
    expect(ids(methodsOfferedInChannel(methods, A))).toEqual(['only-a', 'both', 'unbound', 'no-field']);
    expect(ids(methodsOfferedInChannel(methods, B))).toEqual(['only-b', 'both', 'unbound', 'no-field']);
  });

  it('drops a method restricted to other channels only', () => {
    expect(ids(methodsOfferedInChannel(methods, A))).not.toContain('only-b');
  });

  it('narrows nothing while no channel is chosen', () => {
    expect(ids(methodsOfferedInChannel(methods, ''))).toEqual(ids(methods));
  });
});
