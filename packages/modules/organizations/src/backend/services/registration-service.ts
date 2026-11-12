import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  isCustomFieldValidationFailure,
  normalizeTaxId,
  type CustomFieldInputSurface,
  type CustomFieldValidationError,
  type CustomFieldValuePort,
  type OrganizationConvertedToCompanyEvent,
  type OrganizationTaxIdChangedEvent,
  type CustomerAccountMemberCommandPort,
  type CustomerAccountReadPort,
  type DictionaryValidator,
  type RegisterOrganizationRequest,
  type SupportedLanguage,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import {
  makeRegisterOrganizationCommand,
  type RegisterOrganizationResult,
} from '../commands/register-organization.command.js';
import type { RegistryLookupSnapshot } from '../registry-lookup/company-registry-port.js';
import { registrationValidationRow } from '../registry-lookup/registration-snapshot.js';
import { TaxIdLookupService } from './tax-id-lookup-service.js';
import { runOrganizationWrite, taxIdExistsRefusal } from './organization-write.js';

export interface OrganizationEvents extends Record<string, EventBase> {
  'organization.registered.v1': EventBase & { organizationId: string };
  'organization.verified.v1': EventBase & { organizationId: string; customerAccountId: string };
  'organization.status_changed.v1': EventBase & { organizationId: string; newStatus: string };
  /**
   * `specs/177-tax-id-scope/` FR-039 — a personal organization became a company
   * (`organization.convert_to_company`), dispatched once on commit. No
   * subscriber in core; for overlays and connectors (research R-12).
   */
  'organization.converted_to_company.v1': EventBase & OrganizationConvertedToCompanyEvent;
  /**
   * Issue #1040 — a company organization's tax ID was corrected
   * (`organization.tax_id.change`), dispatched once on commit and never for a
   * same-value no-op. Carries no tax ID. No subscriber in core.
   */
  'organization.tax_id_changed.v1': EventBase & OrganizationTaxIdChangedEvent;
  /**
   * A CustomerAccount belonging to an Organization was created (self-service
   * registration, admin direct-create, or invitation accept). Consumed by the
   * shopping_lists module to provision the customer's default list eagerly.
   */
  'customer_account.created.v1': EventBase & {
    customerAccountId: string;
    organizationId: string;
  };
}
export type OrganizationEventBus = EventBus<OrganizationEvents>;

/**
 * Emit `customer_account.created.v1` for a newly-created org-attached customer.
 * Shared by every creation chokepoint so provisioning side effects (e.g. the
 * default shopping list) happen consistently regardless of entry path.
 */
export function emitCustomerAccountCreated(
  events: OrganizationEventBus,
  customerAccountId: string,
  organizationId: string,
): void {
  events.emit('customer_account.created.v1', {
    eventId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    customerAccountId,
    organizationId,
  });
}

export type RegistrationResult = RegisterOrganizationResult;

export interface RegistrationAccountPorts {
  /**
   * `customer_accounts`' published read (feature 075, Phase C) — the fast
   * e-mail pre-check, before the password is hashed.
   */
  read: Pick<CustomerAccountReadPort, 'findByEmail'>;
  /**
   * `customer_accounts`' account creation as a Command factory
   * (`specs/176-command-hooks-outbox/` FR-002): the first user of a new
   * Organization is a row in *that* module's table, written by its
   * `customer_account.create` as a child of `organization.register`. The
   * plain password crosses and the owner hashes it.
   *
   * With `customer_accounts` off registration fails closed. That is right: an
   * Organization whose administrator could not be created is not a
   * registration, and the module is in any case non-deactivatable.
   */
  commands: CustomerAccountMemberCommandPort;
}

/**
 * Feature 173 — what registration needs to persist the registry lookup a buyer
 * carried (research R-13): the switch, and the module's ticket store. Optional
 * so a composition without the lookup keeps working.
 */
export interface RegistrationRegistryLookup {
  /** `registry_lookup_enabled`, fail-closed. Off ⇒ every reference is ignored. */
  isEnabled(): Promise<boolean>;
  readTicket(lookupId: string): Promise<RegistryLookupSnapshot | null>;
  deleteTicket(lookupId: string): Promise<void>;
  logger?: { info(obj: object, msg: string): void };
}

/**
 * Feature 175 — the one method of `custom_fields`' value port registration
 * uses. Optional: without it a registration carrying values is refused
 * `not_open_for_input` for every key (FR-027), one carrying none is unchanged.
 */
export type RegistrationCustomFieldValues = Pick<CustomFieldValuePort, 'validateForCustomerInput'>;

/** The buyer input surface this service owns (feature 175, research R-2). */
const REGISTRATION_SURFACE: CustomFieldInputSurface = 'organization.register';

/**
 * A refused registration value. `field`, `code` and `message` are the
 * feature-175 contract (`field` prefixed by its group); `path` and `issue`
 * repeat `field` and `message` in the envelope's own entry shape, the one every
 * other custom-field refusal carries.
 */
interface RegistrationValueRefusal {
  field: string;
  code: CustomFieldValidationError['code'];
  message: string;
  path: string;
  issue: string;
}

export interface RegistrationServiceDeps {
  /** For the fast tax-ID pre-check, outside the Command. */
  emFactory: () => EntityManager;
  /** Runs `organization.register` (Principle XIII). */
  commandBus: Pick<CommandBus, 'run'>;
  events: OrganizationEventBus;
  accounts: RegistrationAccountPorts;
  dictionaryValidator?: DictionaryValidator;
  channelMembership?: Pick<SalesChannelMembershipPort, 'bindToDefaultIfEmpty' | 'replaceChannelsForEntity'>;
  registryLookup?: RegistrationRegistryLookup;
  /** Feature 175 — validates the buyer's custom-field values before the Command. */
  customFieldValues?: RegistrationCustomFieldValues;
}

/**
 * Registration flow (T117, FR-040; `specs/176-command-hooks-outbox/` US1).
 *
 * Everything that does not write runs first, outside any transaction, so no
 * slow or remote dependency holds one open (FR-009): the country dictionary,
 * the fast tax-ID and e-mail pre-checks — which also answer the common
 * duplicate before the password is hashed — the registry ticket read, the
 * custom-field validation of both groups, and the hash itself (FR-005). Then
 * one `organization.register` Command writes the whole registration on one
 * transaction (FR-001), and the bus records its audit entry. The ticket is
 * deleted after the commit, best effort.
 *
 * Uniqueness conflicts raise:
 *   409 ORGANIZATION_TAX_ID_EXISTS if the taxId is taken — the pre-check, the
 *       Command's own check, or either scope's constraint (FR-008).
 *   409 EMAIL_ALREADY_REGISTERED if the email is taken by another account —
 *       the pre-check, or the account Command's check and unique index.
 */
export class RegistrationService {
  constructor(private readonly deps: RegistrationServiceDeps) {}

  /**
   * @param context.salesChannelId the channel of the store the business
   *   registered on — the request's resolved channel. Feature 154 (owner
   *   decision D6): the new Organization gets exactly that channel, also on a
   *   store closed to anonymous visitors, where registering is how a business
   *   applies. `null` (no request channel) binds the system default.
   * @param context.language the request's response language — feature 175: a
   *   refused custom-field value is worded in it by `custom_fields`
   *   (`specs/conventions/module-i18n.md`, case 1). Absent, in English.
   */
  async registerOrganization(
    req: RegisterOrganizationRequest,
    context: { salesChannelId: string | null; language?: SupportedLanguage } = { salesChannelId: null },
  ): Promise<RegistrationResult> {
    await this.validateCountry(req.organization.registeredAddress.country);

    // The fast pre-checks: the right code for the common duplicate, in the
    // order the endpoint has always answered them, before the ~50 ms of argon2.
    // The Command checks the tax ID again on its transaction, and the
    // constraints and the account's unique index answer the race.
    // `specs/177-tax-id-scope/` FR-024 — through the one tax-ID lookup, which
    // normalises the input; D-290 / OD-11 — stored, checked and echoed in the
    // canonical form.
    const taxId = normalizeTaxId(req.organization.taxId);
    const existingByTaxId = await new TaxIdLookupService(this.deps.emFactory).resolveByTaxId(taxId, {
      em: this.deps.emFactory(),
    });
    if (existingByTaxId.kind !== 'none') throw taxIdExistsRefusal();
    if (await this.deps.accounts.read.findByEmail(req.firstUser.email)) {
      throw new HttpError(409, ERROR_CODES.EMAIL_ALREADY_REGISTERED, 'An account with this email already exists.');
    }

    // Feature 173 — the ticket is read before anything is written, so a slow or
    // failing Redis costs the registration nothing but this one read (FR-021).
    const ticket = await this.readRegistryTicket(req.registryLookupId);

    // Feature 175 (research R-5, FR-024) — both custom-field groups are
    // validated here, before the Command, so a refusal of theirs writes nothing.
    const customFieldValues = await this.validateCustomFieldGroups(req, context.language);

    // Feature 173 — the validation row for the lookup this registration carried,
    // when the ticket was issued for the same normalised tax ID and country
    // (FR-020). Pure: the Command writes it.
    const lookupRow = ticket
      ? registrationValidationRow(ticket, {
          name: req.organization.name,
          // The stored form, so the validation row names the tax ID the organization holds.
          taxId,
          registeredAddress: req.organization.registeredAddress,
        })
      : null;
    if (ticket && !lookupRow) {
      this.deps.registryLookup?.logger?.info(
        {},
        'organizations: registry lookup reference ignored — issued for another tax ID',
      );
    }

    // FR-005 — the hash, before the transaction opens.
    const account = await this.deps.accounts.commands.prepareCreate({
      email: req.firstUser.email,
      password: req.firstUser.password,
      firstName: req.firstUser.firstName,
      lastName: req.firstUser.lastName,
      // Feature 175 — validated above; the account's owner stores it as given.
      customFieldValues: customFieldValues.customer,
    });

    const result = await runOrganizationWrite(
      this.deps.commandBus,
      makeRegisterOrganizationCommand(
        {
          events: this.deps.events,
          ...(this.deps.channelMembership ? { channelMembership: this.deps.channelMembership } : {}),
        },
        { request: req, taxId, salesChannelId: context.salesChannelId, customFieldValues, lookupRow, account },
      ),
      () => taxIdExistsRefusal(),
    );

    // After the commit, best effort: the ticket expires on its own anyway. A
    // refused registration never reaches this line, so its ticket stays usable
    // for the retry.
    if (lookupRow && req.registryLookupId) {
      await this.deps.registryLookup?.deleteTicket(req.registryLookupId).catch(() => undefined);
    }
    return result;
  }

  /**
   * Feature 175 — the buyer's two groups, validated on the registration
   * surface: `organization` for the Organization, `firstUser` for its first
   * account. Every refusal of both is collected into **one** 422 whose entries
   * name the field under its group (`organization.<key>`, `firstUser.<key>`;
   * the group alone for `too_many_keys`), so a storefront can place each.
   */
  private async validateCustomFieldGroups(
    req: RegisterOrganizationRequest,
    language: SupportedLanguage | undefined,
  ): Promise<{ organization: Record<string, unknown>; customer: Record<string, unknown> }> {
    const groups = [
      { prefix: 'organization', entityType: 'organization', values: req.organization.customFieldValues },
      { prefix: 'firstUser', entityType: 'customer', values: req.firstUser.customFieldValues },
    ] as const;
    const refusals: RegistrationValueRefusal[] = [];
    const refuse = (field: string, code: RegistrationValueRefusal['code'], message: string): void => {
      refusals.push({ field, code, message, path: field, issue: message });
    };
    const bags: Array<Record<string, unknown>> = [];
    for (const group of groups) {
      if (!this.deps.customFieldValues) {
        // No value port composed: nothing is open, so every key is refused
        // (FR-027). The sentence names no key: a buyer reads it beside the field.
        for (const key of Object.keys(group.values ?? {})) {
          refuse(`${group.prefix}.${key}`, 'not_open_for_input', 'This field cannot be filled in here.');
        }
        bags.push({});
        continue;
      }
      try {
        bags.push(
          await this.deps.customFieldValues.validateForCustomerInput(
            group.entityType,
            group.values,
            REGISTRATION_SURFACE,
            language,
          ),
        );
      } catch (err) {
        // Structural, as on the admin path: the error class is `custom_fields`'.
        // Anything else — a disabled module included — is not a refusal.
        if (!isCustomFieldValidationFailure(err)) throw err;
        for (const entry of err.errors) {
          refuse(entry.code === 'too_many_keys' ? group.prefix : `${group.prefix}.${entry.field}`, entry.code, entry.message);
        }
        bags.push({});
      }
    }
    if (refusals.length > 0) {
      throw new HttpError(
        422,
        ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID,
        'One or more custom fields are invalid.',
        refusals,
      );
    }
    return { organization: bags[0] ?? {}, customer: bags[1] ?? {} };
  }

  /** The ticket behind a reference, or `null`: switch off, unknown, expired, or Redis failing. */
  private async readRegistryTicket(lookupId: string | undefined): Promise<RegistryLookupSnapshot | null> {
    if (!lookupId || !this.deps.registryLookup) return null;
    try {
      if (!(await this.deps.registryLookup.isEnabled())) return null;
      return await this.deps.registryLookup.readTicket(lookupId);
    } catch (err) {
      this.deps.registryLookup.logger?.info(
        { err: err instanceof Error ? err.message : String(err) },
        'organizations: registry lookup ticket unreadable; registering without it',
      );
      return null;
    }
  }

  private async validateCountry(country: string): Promise<void> {
    if (!this.deps.dictionaryValidator) return;
    try {
      await this.deps.dictionaryValidator.validateCountryCode(country, 'create-or-change');
    } catch (err) {
      if (err instanceof DictionaryReferenceError) {
        throw new HttpError(
          409,
          err.code,
          err.code === 'DICTIONARY_ENTRY_INACTIVE'
            ? `Country code ${err.entryCode} is no longer available for organization registration.`
            : `Country code ${err.entryCode} is not recognised.`,
          [{ path: 'organization.registeredAddress.country', issue: err.code }],
        );
      }
      throw err;
    }
  }
}

// Polyfill for environments where crypto.randomUUID isn't on global (node < 19).
// Node 22+ has it, so this is a belt-and-braces fallback.
declare const crypto: { randomUUID: () => string };
