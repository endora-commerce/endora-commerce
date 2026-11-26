import { describe, expectTypeOf, it } from 'vitest';
import type { AggregateCommandOptions, CustomFieldMerge } from './aggregate-ports.js';
import type {
  CreateOpportunityCommentRequest,
  CreateOpportunityLinkRequest,
  CreateOpportunityRequest,
  OpportunityCommandPort,
  OpportunityComment,
  OpportunityLink,
  OpportunityRecord,
  OpportunityTransitionInput,
  OpportunityTransitionOutcome,
  UpdateOpportunityRequest,
} from './crm.js';

/**
 * Issue #1827 (`specs/186-aggregate-ports/` T087,
 * `contracts/opportunity-command-port.md`) — the Opportunity aggregate's write
 * port: ten methods, each taking the admin route's input and
 * {@link AggregateCommandOptions} last. No method is optional
 * (`check:port-shape`), and the record carries the custom-field bag the port
 * writes (R-8).
 */
describe('OpportunityCommandPort (186 US9)', () => {
  it('publishes exactly the ten operations of the Opportunity aggregate', () => {
    expectTypeOf<keyof OpportunityCommandPort>().toEqualTypeOf<
      | 'create'
      | 'update'
      | 'setCustomFieldValues'
      | 'assign'
      | 'transition'
      | 'setTags'
      | 'link'
      | 'unlink'
      | 'addComment'
      | 'delete'
    >();
  });

  it('takes the admin routes’ inputs and answers the record', () => {
    expectTypeOf<OpportunityCommandPort['create']>().toEqualTypeOf<
      (input: CreateOpportunityRequest, options?: AggregateCommandOptions) => Promise<OpportunityRecord>
    >();
    expectTypeOf<OpportunityCommandPort['update']>().toEqualTypeOf<
      (id: string, patch: UpdateOpportunityRequest, options?: AggregateCommandOptions) => Promise<OpportunityRecord>
    >();
    expectTypeOf<OpportunityCommandPort['setCustomFieldValues']>().toEqualTypeOf<
      (id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions) => Promise<OpportunityRecord>
    >();
    expectTypeOf<OpportunityCommandPort['assign']>().toEqualTypeOf<
      (id: string, input: { adminUserId: string | null }, options?: AggregateCommandOptions) => Promise<OpportunityRecord>
    >();
    expectTypeOf<OpportunityCommandPort['setTags']>().toEqualTypeOf<
      (id: string, input: { tagIds: readonly string[] }, options?: AggregateCommandOptions) => Promise<OpportunityRecord>
    >();
    expectTypeOf<OpportunityCommandPort['link']>().toEqualTypeOf<
      (id: string, input: CreateOpportunityLinkRequest, options?: AggregateCommandOptions) => Promise<OpportunityLink>
    >();
    expectTypeOf<OpportunityCommandPort['unlink']>().toEqualTypeOf<
      (id: string, linkId: string, options?: AggregateCommandOptions) => Promise<void>
    >();
    expectTypeOf<OpportunityCommandPort['addComment']>().toEqualTypeOf<
      (id: string, input: CreateOpportunityCommentRequest, options?: AggregateCommandOptions) => Promise<OpportunityComment>
    >();
    expectTypeOf<OpportunityCommandPort['delete']>().toEqualTypeOf<
      (id: string, options?: AggregateCommandOptions) => Promise<void>
    >();
  });

  it('answers a transition’s refusals as an outcome (FR-008)', () => {
    expectTypeOf<OpportunityCommandPort['transition']>().toEqualTypeOf<
      (id: string, input: OpportunityTransitionInput, options?: AggregateCommandOptions) => Promise<OpportunityTransitionOutcome>
    >();
  });

  it('carries the custom-field bag on the record (R-8, R-21.4)', () => {
    expectTypeOf<OpportunityRecord['customFieldValues']>().toEqualTypeOf<Record<string, unknown> | undefined>();
  });
});
