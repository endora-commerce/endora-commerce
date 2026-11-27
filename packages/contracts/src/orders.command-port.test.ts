import { describe, expectTypeOf, it } from 'vitest';
import type { AggregateCommandOptions, CustomFieldMerge } from './aggregate-ports.js';
import type {
  OrderComment,
  OrderCommandPort,
  OrderCommentInput,
  OrderExternalReference,
  OrderExternalReferenceWrite,
  OrderPayer,
  OrderPaymentStatusTransitionInput,
  OrderReadPort,
  OrderRecord,
  OrderStatusTransitionInput,
  OrderTransitionOutcome,
} from './orders.js';

/**
 * `specs/186-aggregate-ports/` T054 (issue #1823, US4) — the Order aggregate
 * port's published shape: one method per operation of
 * `contracts/order-command-port.md`, each ending in the aggregate ports'
 * options; `place` is not declared yet (US11, issue #1887). The read the
 * deprecated `orderTransitionPort` carried moves to the read port, and the
 * record carries the payer.
 */
describe('OrderCommandPort (186 US4)', () => {
  it('declares the operations of the Order lifecycle', () => {
    expectTypeOf<keyof OrderCommandPort>().toEqualTypeOf<
      'applyStatus' | 'applyPaymentStatus' | 'setCustomFieldValues' | 'addComment' | 'setExternalReference'
    >();
  });

  it('answers a status change as an outcome, never a throw', () => {
    expectTypeOf<OrderCommandPort['applyStatus']>().toEqualTypeOf<
      (id: string, input: OrderStatusTransitionInput, options?: AggregateCommandOptions) => Promise<OrderTransitionOutcome>
    >();
  });

  it('takes the operator payment targets, the merge callback, the comment body and the reference write', () => {
    expectTypeOf<OrderPaymentStatusTransitionInput['to']>().toEqualTypeOf<'paid' | 'refunded'>();
    expectTypeOf<OrderCommandPort['applyPaymentStatus']>().toEqualTypeOf<
      (id: string, input: OrderPaymentStatusTransitionInput, options?: AggregateCommandOptions) => Promise<OrderRecord>
    >();
    expectTypeOf<OrderCommandPort['setCustomFieldValues']>().toEqualTypeOf<
      (id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions) => Promise<OrderRecord>
    >();
    expectTypeOf<OrderCommandPort['addComment']>().toEqualTypeOf<
      (id: string, input: OrderCommentInput, options?: AggregateCommandOptions) => Promise<OrderComment>
    >();
    expectTypeOf<OrderCommandPort['setExternalReference']>().toEqualTypeOf<
      (
        id: string,
        system: string,
        value: OrderExternalReferenceWrite,
        options?: AggregateCommandOptions,
      ) => Promise<OrderExternalReference>
    >();
  });

  it('moves terminality to the read port and puts the payer on the record', () => {
    expectTypeOf<OrderReadPort['isTerminal']>().toEqualTypeOf<(orderId: string) => Promise<boolean | null>>();
    expectTypeOf<OrderRecord['payer']>().toEqualTypeOf<OrderPayer | null | undefined>();
  });
});
