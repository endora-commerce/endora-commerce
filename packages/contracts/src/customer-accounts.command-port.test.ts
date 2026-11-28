import { describe, expectTypeOf, it } from 'vitest';
import type { AggregateCommandOptions, CustomFieldMerge } from './aggregate-ports.js';
import type {
  CustomerAccountCommandPort,
  CustomerAccountCreateInput,
  CustomerAccountProfilePatch,
  CustomerAccountReadPort,
  CustomerAccountRecord,
  CustomerAccountStandaloneCreateInput,
} from './customer-accounts.js';

/**
 * `specs/186-aggregate-ports/` T046 (issue #1822) — the CustomerAccount
 * aggregate port's published shape: one method per operation of
 * `contracts/customer-account-command-port.md`, each ending in the aggregate
 * ports' options, and the anonymisation work list on the read port.
 */
describe('CustomerAccountCommandPort (186 US3)', () => {
  it('declares the operations of the CustomerAccount aggregate, and no membership move', () => {
    expectTypeOf<keyof CustomerAccountCommandPort>().toEqualTypeOf<
      | 'create'
      | 'createStandalone'
      | 'updateProfile'
      | 'block'
      | 'unblock'
      | 'softDelete'
      | 'restore'
      | 'setCustomerGroup'
      | 'setCustomFieldValues'
      | 'setSubtreeRollup'
      | 'promoteToOrganizationAdmin'
      | 'markEmailVerified'
      | 'changeRole'
      | 'setPreferredLanguage'
      | 'removeMember'
      | 'anonymize'
    >();
  });

  it('takes the deprecated ports’ inputs, without an actor', () => {
    expectTypeOf<CustomerAccountCommandPort['create']>().toEqualTypeOf<
      (input: CustomerAccountCreateInput, options?: AggregateCommandOptions) => Promise<CustomerAccountRecord>
    >();
    // `specs/193-admin-form-extensions/` D-300.10 as amended — the storefront caller's buyer flag.
    expectTypeOf<CustomerAccountCommandPort['createStandalone']>().toEqualTypeOf<
      (
        input: CustomerAccountStandaloneCreateInput,
        options?: AggregateCommandOptions & { readonly buyerSelfService?: true },
      ) => Promise<CustomerAccountRecord>
    >();
    expectTypeOf<CustomerAccountCommandPort['updateProfile']>().toEqualTypeOf<
      (id: string, patch: CustomerAccountProfilePatch, options?: AggregateCommandOptions) => Promise<CustomerAccountRecord>
    >();
    expectTypeOf<CustomerAccountCommandPort['block']>().toEqualTypeOf<
      (
        id: string,
        input: { readonly reason?: string | null },
        options?: AggregateCommandOptions,
      ) => Promise<CustomerAccountRecord>
    >();
    expectTypeOf<CustomerAccountCommandPort['softDelete']>().toEqualTypeOf<
      (id: string, options?: AggregateCommandOptions) => Promise<CustomerAccountRecord>
    >();
    expectTypeOf<CustomerAccountCommandPort['removeMember']>().toEqualTypeOf<
      (id: string, options?: AggregateCommandOptions) => Promise<void>
    >();
  });

  it('takes the shared custom-field merge', () => {
    expectTypeOf<CustomerAccountCommandPort['setCustomFieldValues']>().toEqualTypeOf<
      (id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions) => Promise<CustomerAccountRecord>
    >();
  });

  it('moves the anonymisation work list to the read port', () => {
    expectTypeOf<CustomerAccountReadPort['listDueForAnonymization']>().toEqualTypeOf<
      (cutoff: Date) => Promise<CustomerAccountRecord[]>
    >();
    expectTypeOf<CustomerAccountReadPort['hasDueForAnonymization']>().toEqualTypeOf<(cutoff: Date) => Promise<boolean>>();
  });
});
