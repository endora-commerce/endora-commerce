import { createHash, randomBytes } from 'crypto';
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
  type CustomerAccountMemberWritePort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type DictionaryValidator,
  type RegisterOrganizationRequest,
  type SupportedLanguage,
} from '@endora-commerce/contracts';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import { Organization } from '../entities/organization.entity.js';
import { TaxIdLookupService } from './tax-id-lookup-service.js';
import { organizationWriteError, taxIdExistsRefusal } from './organization-write.js';
import { EmailVerificationToken } from '../entities/email-verification-token.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort, SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { predefinedRoleIdOn } from './organization-role-store.js';
import { OrganizationTaxIdValidation } from '../entities/organization-tax-id-validation.entity.js';
import type { RegistryLookupSnapshot } from '../registry-lookup/company-registry-port.js';
import {
  registrationValidationRow,
  type RegistrationValidationRow,
} from '../registry-lookup/registration-snapshot.js';

/**
 * Registration flow (T117, FR-040).
 *
 * - Creates the Organization in `pending_verification`.
 * - Creates the first CustomerAccount holding the Organization's
 *   *Administrator* role, email unverified, argon2-hashed password.
 * - Issues an EmailVerificationToken; the raw token is returned so callers
 *   can dispatch the email. Only its sha256 hash is stored.
 * - Emits `organization.registered.v1`.
 *
 * Uniqueness conflicts raise:
 *   409 ORGANIZATION_TAX_ID_EXISTS if the taxId is taken.
 *   409 EMAIL_ALREADY_REGISTERED if the email is taken by another account.
 */

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

const TOKEN_TTL_HOURS = 48;

export interface RegistrationResult {
  organization: Organization;
  customerAccount: CustomerAccountRecord;
  /** Raw token to include in the verification email — shown once. */
  verificationToken: string;
}

export interface RegistrationAccountPorts {
  /**
   * `customer_accounts`' published read and write (feature 075, Phase C). The
   * first user of a new Organization is a row in *that* module's table, and
   * this service used to create it with `em.create(CustomerAccount, …)` and a
   * `hashPassword` imported from `auth`. Both are on the owner's side of the
   * port now, which is also why the plain password crosses and no hash does.
   *
   * With `customer_accounts` off registration fails closed. That is right: an
   * Organization whose administrator could not be created is not a
   * registration, and the module is in any case non-deactivatable.
   */
  read: CustomerAccountReadPort;
  write: CustomerAccountMemberWritePort;
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

export class RegistrationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: OrganizationEventBus,
    private readonly accounts: RegistrationAccountPorts,
    private readonly dictionaryValidator?: DictionaryValidator,
    private readonly auditLog?: AuditPort,
    /**
     * Feature 154 — the kernel's audited channel-membership writer. An
     * Organization with no sales channel may shop nowhere, so a created one is
     * bound in the creating step (FR-016, FR-019). Optional so a unit
     * composition without it keeps working.
     */
    private readonly channelMembership?: Pick<
      SalesChannelMembershipPort,
      'bindToDefaultIfEmpty' | 'replaceChannelsForEntity'
    >,
    private readonly registryLookup?: RegistrationRegistryLookup,
    /** Feature 175 — validates the buyer's custom-field values before the first write. */
    private readonly customFieldValues?: RegistrationCustomFieldValues,
  ) {}

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
    const em = this.emFactory();
    await this.validateCountry(req.organization.registeredAddress.country);

    // Pre-check the easy cases so we can return the right error code before
    // hashing the password (avoids a wasted ~50 ms of argon2 work — the hash
    // is computed inside `create` below, after both checks have passed).
    // `specs/177-tax-id-scope/` FR-024 — through the one tax-ID lookup, which
    // normalises the input (`contracts/tax-id-scope.md` §5).
    // D-290 / OD-11 — stored, checked and echoed in the canonical form.
    const taxId = normalizeTaxId(req.organization.taxId);
    const existingByTaxId = await new TaxIdLookupService(this.emFactory).resolveByTaxId(taxId, { em });
    if (existingByTaxId.kind !== 'none') {
      throw new HttpError(
        409,
        ERROR_CODES.ORGANIZATION_TAX_ID_EXISTS,
        'An organization with this taxId already exists.',
      );
    }
    const existingByEmail = await this.accounts.read.findByEmail(req.firstUser.email);
    if (existingByEmail) {
      throw new HttpError(
        409,
        ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        'An account with this email already exists.',
      );
    }

    // Feature 173 — the ticket is read before anything is written, so a slow or
    // failing Redis costs the registration nothing but this one read (FR-021).
    const ticket = await this.readRegistryTicket(req.registryLookupId);

    // Feature 175 (research R-5, FR-024) — both custom-field groups are
    // validated here, before the first write, so no refusal of theirs can
    // leave an Organization without its account behind.
    const customFieldValues = await this.validateCustomFieldGroups(req, context.language);

    const organization = em.create(Organization, {
      name: req.organization.name,
      taxId,
      status: 'pending_verification',
      vatStatus: req.organization.vatStatus ?? 'vat_payer',
      registeredAddress: {
        street: req.organization.registeredAddress.street,
        city: req.organization.registeredAddress.city,
        postalCode: req.organization.registeredAddress.postalCode,
        country: req.organization.registeredAddress.country,
      },
      customFieldValues: customFieldValues.organization,
    });
    try {
      await em.persistAndFlush(organization);
    } catch (err) {
      // `specs/177-tax-id-scope/` Phase A (research R-15) — either scope's
      // constraint: `global`'s unique one at the statement, `per-tree-root`'s
      // deferred one at this flush's own commit (no transaction is open here).
      throw organizationWriteError(err, () => taxIdExistsRefusal());
    }
    // Feature 154 — on this `EntityManager`, right after the Organization row,
    // so "no Organization without a channel" holds by construction.
    if (context.salesChannelId !== null) {
      await this.channelMembership?.replaceChannelsForEntity(
        'organization',
        organization.id,
        [context.salesChannelId],
        { em },
      );
    } else {
      await this.channelMembership?.bindToDefaultIfEmpty('organization', organization.id, { em });
    }

    // `create` raises the same 409 `EMAIL_ALREADY_REGISTERED` on the unique
    // index that the `catch` here used to, so the translation moved with the
    // write rather than being dropped.
    const customerAccount = await this.accounts.write.create({
      organizationId: organization.id,
      email: req.firstUser.email,
      password: req.firstUser.password,
      firstName: req.firstUser.firstName,
      lastName: req.firstUser.lastName,
      // The registering user administers the new Organization
      // (`specs/170-organization-roles/` WP-02b). Read on this `em`: the role
      // row was written by the Organization's own insert trigger.
      organizationRoleId: await predefinedRoleIdOn(em, organization.id, 'administrator'),
      // Feature 175 — validated above; the account's owner stores it as given.
      customFieldValues: customFieldValues.customer,
    });

    // Feature 173 — one validation row for the lookup this registration carried,
    // when the ticket was issued for the same normalised tax ID and country
    // (FR-020). Written for the Organization being created, on this `em`. The
    // actor is anonymous, so the write needs the sanctioned hatch; a module's is
    // `withSystemScope` (ruling D-285 keeps `withOrgScope` host-only), and the
    // row names the Organization explicitly, as `predefinedRoleIdOn` does. The
    // summary is stamped as the admin trigger stamps it; the registry's legal
    // name is **not** written (OD-7).
    const lookupRow = ticket
      ? registrationValidationRow(ticket, {
          name: req.organization.name,
          // The stored form, so the validation row names the tax ID the organization holds.
          taxId,
          registeredAddress: req.organization.registeredAddress,
        })
      : null;
    if (ticket && !lookupRow) {
      this.registryLookup?.logger?.info(
        { organizationId: organization.id },
        'organizations: registry lookup reference ignored — issued for another tax ID',
      );
    }
    if (lookupRow) await this.persistLookupRow(em, organization, lookupRow);

    const rawToken = randomBytes(32).toString('base64url');
    const token = em.create(EmailVerificationToken, {
      customerAccountId: customerAccount.id,
      tokenHash: sha256Hex(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1_000),
    });
    if (this.auditLog) {
      // Self-registration is pre-auth (no ambient actor) — the entry records the
      // organization creation with a null actor.
      recordAuditFromContext(this.auditLog, em, {
        action: 'organization.register',
        objectType: 'organization',
        objectId: organization.id,
        stateBefore: null,
        stateAfter: {
          name: organization.name,
          taxId: organization.taxId,
          status: organization.status,
          ...(lookupRow ? { registryLookup: { provider: lookupRow.provider, outcome: lookupRow.outcome } } : {}),
          // Feature 175 (FR-028) — the keys a buyer supplied, never their
          // values (`specs/conventions/audit-state.md`, D-288): sorted, each
          // prefixed by its request group as a refusal names it.
          changedCustomFields: [
            ...Object.keys(customFieldValues.organization).map((key) => `organization.${key}`),
            ...Object.keys(customFieldValues.customer).map((key) => `firstUser.${key}`),
          ].sort(),
        },
      });
    }
    await em.persistAndFlush(token);

    // After the commit, best effort: the ticket expires on its own anyway. A
    // refused registration never reaches this line, so its ticket stays usable
    // for the retry.
    if (lookupRow && req.registryLookupId) {
      await this.registryLookup?.deleteTicket(req.registryLookupId).catch(() => undefined);
    }

    this.events.emit('organization.registered.v1', {
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: organization.id,
    });
    emitCustomerAccountCreated(this.events, customerAccount.id, organization.id);

    return { organization, customerAccount, verificationToken: rawToken };
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
      if (!this.customFieldValues) {
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
          await this.customFieldValues.validateForCustomerInput(
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
    if (!lookupId || !this.registryLookup) return null;
    try {
      if (!(await this.registryLookup.isEnabled())) return null;
      return await this.registryLookup.readTicket(lookupId);
    } catch (err) {
      this.registryLookup.logger?.info(
        { err: err instanceof Error ? err.message : String(err) },
        'organizations: registry lookup ticket unreadable; registering without it',
      );
      return null;
    }
  }

  private async persistLookupRow(
    em: EntityManager,
    organization: Organization,
    row: RegistrationValidationRow,
  ): Promise<void> {
    await withSystemScope(
      'organizations: registration persists the registry lookup of the Organization it creates',
      async () => {
        em.create(OrganizationTaxIdValidation, {
          organizationId: organization.id,
          provider: row.provider,
          outcome: row.outcome,
          taxIdValue: row.taxIdValue,
          legalNameReturned: row.legalNameReturned,
          addressReturned: row.addressReturned,
          errorKind: row.errorKind,
          requestedByAdminUserId: null,
          origin: row.origin,
          registryDetails: row.registryDetails,
          submittedValues: row.submittedValues,
        });
        organization.vatValidatedAt = new Date();
        organization.vatValidationProvider = row.provider;
        organization.vatValidationOutcome = row.outcome;
        await em.flush();
      },
    );
  }

  private async validateCountry(country: string): Promise<void> {
    if (!this.dictionaryValidator) return;
    try {
      await this.dictionaryValidator.validateCountryCode(country, 'create-or-change');
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

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// Polyfill for environments where crypto.randomUUID isn't on global (node < 19).
// Node 22+ has it, so this is a belt-and-braces fallback.
declare const crypto: { randomUUID: () => string };
