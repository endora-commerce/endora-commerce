import { describe, expectTypeOf, it } from 'vitest';
import type { AggregateCommandOptions, CustomFieldMerge } from './aggregate-ports.js';
import type {
  CreditInheritanceMode,
  OrganizationAllowListKind,
  OrganizationAllowListPatch,
  OrganizationAllowListsReplace,
  OrganizationBlockInput,
  OrganizationCommandPort,
  OrganizationCommandPortOptions,
  OrganizationRecord,
  OrganizationRejectInput,
  OrganizationRestrictions,
  OrganizationSalesChannelsUpdateBody,
  OrganizationWriteCreateInput,
  OrganizationWriteUpdatePatch,
} from './organizations.js';

/**
 * `specs/186-aggregate-ports/` T012, T019 (issue #1821, research R-16) — the
 * Organization aggregate port's published shape: one method per operation of
 * `contracts/organization-command-port.md`, each taking the admin body without
 * its version and ending in the aggregate ports' options.
 */
describe('OrganizationCommandPort (186 US1)', () => {
  it('ends every method in the aggregate ports’ options', () => {
    expectTypeOf<OrganizationCommandPortOptions>().toEqualTypeOf<AggregateCommandOptions>();
  });

  it('declares the operations of the Organization aggregate', () => {
    expectTypeOf<keyof OrganizationCommandPort>().toEqualTypeOf<
      | 'create'
      | 'update'
      | 'setParent'
      | 'approve'
      | 'reject'
      | 'block'
      | 'unblock'
      | 'delete'
      | 'setCustomFieldValues'
      | 'convertToCompany'
      | 'changeTaxId'
      | 'setSalesChannels'
      | 'setRestrictions'
      | 'patchRestriction'
      | 'setCreditInheritanceMode'
      | 'assignSalesRep'
      | 'unassignSalesRep'
    >();
  });

  it('takes the deprecated write port’s inputs for create and update', () => {
    expectTypeOf<OrganizationCommandPort['create']>().toEqualTypeOf<
      (input: OrganizationWriteCreateInput, options?: AggregateCommandOptions) => Promise<OrganizationRecord>
    >();
    expectTypeOf<OrganizationCommandPort['update']>().toEqualTypeOf<
      (id: string, patch: OrganizationWriteUpdatePatch, options?: AggregateCommandOptions) => Promise<OrganizationRecord>
    >();
  });

  it('detaches with parentId null (R-16.3)', () => {
    expectTypeOf<Parameters<OrganizationCommandPort['setParent']>[1]>().toEqualTypeOf<{
      readonly parentId: string | null;
    }>();
  });

  it('requires a reject reason and offers the notice switch; block’s reason is optional (R-16.4)', () => {
    expectTypeOf<OrganizationRejectInput>().toEqualTypeOf<{
      readonly reason: string;
      readonly notifyCustomerEmail?: boolean;
    }>();
    expectTypeOf<OrganizationBlockInput>().toEqualTypeOf<{ readonly reason?: string | null }>();
    expectTypeOf<OrganizationCommandPort['approve']>().toEqualTypeOf<
      (id: string, options?: AggregateCommandOptions) => Promise<OrganizationRecord>
    >();
  });

  it('takes the custom-field merge the narrow port takes', () => {
    expectTypeOf<OrganizationCommandPort['setCustomFieldValues']>().toEqualTypeOf<
      (id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions) => Promise<OrganizationRecord>
    >();
  });

  it('takes the sales-channel route’s body for setSalesChannels (US1b)', () => {
    expectTypeOf<OrganizationCommandPort['setSalesChannels']>().toEqualTypeOf<
      (
        id: string,
        input: OrganizationSalesChannelsUpdateBody,
        options?: AggregateCommandOptions,
      ) => Promise<OrganizationRecord>
    >();
  });

  it('writes the allow-lists as the restriction routes do', () => {
    expectTypeOf<OrganizationCommandPort['setRestrictions']>().toEqualTypeOf<
      (
        id: string,
        input: OrganizationAllowListsReplace,
        options?: AggregateCommandOptions,
      ) => Promise<OrganizationRestrictions>
    >();
    expectTypeOf<OrganizationCommandPort['patchRestriction']>().toEqualTypeOf<
      (
        id: string,
        kind: OrganizationAllowListKind,
        patch: OrganizationAllowListPatch,
        options?: AggregateCommandOptions,
      ) => Promise<OrganizationRestrictions>
    >();
  });

  it('takes the credit mode and the sales representative as the routes do', () => {
    expectTypeOf<Parameters<OrganizationCommandPort['setCreditInheritanceMode']>[1]>().toEqualTypeOf<{
      readonly mode: CreditInheritanceMode | null;
    }>();
    expectTypeOf<OrganizationCommandPort['assignSalesRep']>().toEqualTypeOf<
      (id: string, input: { readonly adminUserId: string }, options?: AggregateCommandOptions) => Promise<void>
    >();
    expectTypeOf<OrganizationCommandPort['unassignSalesRep']>().toEqualTypeOf<
      (id: string, input: { readonly adminUserId: string }, options?: AggregateCommandOptions) => Promise<void>
    >();
  });
});
