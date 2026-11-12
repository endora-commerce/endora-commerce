import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerAccountRecord,
  OrganizationRegisterHookData,
  OrganizationRegisterOutbox,
  PreparedCustomerAccountCreate,
  RegisterOrganizationRequest,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { EmailVerificationToken } from '../entities/email-verification-token.entity.js';
import { Organization } from '../entities/organization.entity.js';
import { OrganizationTaxIdValidation } from '../entities/organization-tax-id-validation.entity.js';
import type { RegistrationValidationRow } from '../registry-lookup/registration-snapshot.js';
import { ORGANIZATION_CREATED_FIELDS, presentFields } from '../services/organization-audit-state.js';
import { toOrganizationRecord } from '../services/organization-details-port.js';
import { predefinedRoleIdOn } from '../services/organization-role-store.js';
import { organizationWriteError, taxIdExistsRefusal } from '../services/organization-write.js';
import { TaxIdLookupService } from '../services/tax-id-lookup-service.js';
import type { OrganizationEventBus } from '../services/registration-service.js';

/**
 * `organization.register` — a business registers on the storefront
 * (`specs/176-command-hooks-outbox/` FR-001 – FR-007,
 * `contracts/registration-command.md`).
 *
 * **One Command, one transaction.** The Organization (`pending_verification`,
 * with the buyer's validated custom-field values), its sales-channel binding,
 * its first account, the registry-lookup validation row and the e-mail
 * verification token are written on this Command's `em`, so a failure at any
 * step — a constraint, a racing e-mail, a thrown error — leaves none of them
 * behind. Before this, the Organization committed first and the account in a
 * unit of work of its own, and a failure in between left an Organization with
 * no administrator.
 *
 * The first account is `customer_accounts`' **child** Command
 * `customer_account.create`, run through `ctx.run`: its write and its own audit
 * entry are on this transaction, and its refusal (`409
 * EMAIL_ALREADY_REGISTERED`, from its pre-check or the unique index) rolls the
 * registration back. Its password was hashed before the transaction opened, by
 * `customerAccountMemberCommandPort.prepareCreate`; the role it holds — the new
 * Organization's *Administrator* (`specs/170-organization-roles/` WP-02b) — is
 * read here, on this `em`, from the row the Organization's insert trigger wrote.
 *
 * The tax ID is checked on this transaction, and the database's own refusal is
 * the same `409 ORGANIZATION_TAX_ID_EXISTS`: at the flush for `global`'s unique
 * constraint, and — `per-tree-root`'s constraint being deferred to `COMMIT` —
 * around `commandBus.run` at the call site, through `runOrganizationWrite`
 * (`specs/177-tax-id-scope/` research R-6, R-15).
 *
 * `organization.registered.v1` is this Command's event; `customer_account.created.v1`
 * is emitted from its run into the bus's event scope. Both dispatch once, after
 * the commit, and never after a rollback.
 *
 * Audit state (`specs/conventions/audit-state.md`, D-288, O-2): names, never
 * values — the status code, the names of the fields the Organization was
 * created with, the registry lookup's provider and outcome codes, and the
 * custom-field **keys** of both groups, each prefixed by its request group. The
 * name, tax ID, address, e-mail and custom-field values stay out, and so does
 * the raw verification token, which only the result carries.
 */
export interface RegisterOrganizationCommandDeps {
  events: OrganizationEventBus;
  /**
   * Feature 154 — the kernel's audited channel-membership writer. An
   * Organization with no sales channel may shop nowhere, so a registered one is
   * bound on this transaction (FR-016, FR-019). Optional so a unit composition
   * without it keeps working.
   */
  channelMembership?: Pick<SalesChannelMembershipPort, 'bindToDefaultIfEmpty' | 'replaceChannelsForEntity'>;
}

export interface RegisterOrganizationCommandInput {
  request: RegisterOrganizationRequest;
  /** The normalised tax ID (D-290 / OD-11): what is checked and stored. */
  taxId: string;
  /** The request's resolved channel; `null` binds the system default (feature 154, D6). */
  salesChannelId: string | null;
  /** Both custom-field groups, validated before the Command (feature 175, R-5). */
  customFieldValues: { organization: Record<string, unknown>; customer: Record<string, unknown> };
  /** The validation row the buyer's registry lookup yields, when its ticket matched (feature 173). */
  lookupRow: RegistrationValidationRow | null;
  /** The first account, its password already hashed. */
  account: PreparedCustomerAccountCreate;
  /**
   * Extension input for the hook modules on `organization.register`, keyed by
   * module id (`specs/176-command-hooks-outbox/` FR-018). No HTTP field carries
   * it yet; spec 178 decides that.
   */
  extensions?: Readonly<Record<string, unknown>>;
}

export interface RegisterOrganizationResult {
  organization: Organization;
  customerAccount: CustomerAccountRecord;
  /** Raw token to include in the verification email — shown once, never stored or audited. */
  verificationToken: string;
}

const TOKEN_TTL_HOURS = 48;

export function makeRegisterOrganizationCommand(
  deps: RegisterOrganizationCommandDeps,
  input: RegisterOrganizationCommandInput,
): Command<RegisterOrganizationResult> {
  const organizationId = randomUUID();
  const { request, taxId } = input;
  return {
    action: 'organization.register',
    objectType: 'organization',
    objectId: organizationId,
    // `organization.register` is hookable (176 FR-024). A hook sees the new
    // Organization and its first account on this transaction — never the raw
    // verification token, which only the caller's result carries.
    ...(input.extensions ? { extensions: input.extensions } : {}),
    hookData: (result): OrganizationRegisterHookData => ({
      organization: toOrganizationRecord(result.organization),
      customerAccountId: result.customerAccount.id,
      salesChannelId: input.salesChannelId,
      registryLookupOutcome: input.lookupRow?.outcome ?? null,
    }),
    outboxData: (result): OrganizationRegisterOutbox => ({
      organizationId: result.organization.id,
      customerAccountId: result.customerAccount.id,
      status: result.organization.status,
    }),
    run: async (ctx) => {
      const { em } = ctx;
      if (!ctx.run) throw new Error('organization.register runs its account as a child Command; run it on the bus.');
      // `specs/177-tax-id-scope/` FR-024 — through the one tax-ID lookup, on this
      // transaction; the constraint answers the race this read cannot see.
      const existing = await new TaxIdLookupService(() => em).resolveByTaxId(taxId, { em });
      if (existing.kind !== 'none') throw taxIdExistsRefusal();

      const organization = em.create(Organization, {
        id: organizationId,
        name: request.organization.name,
        taxId,
        status: 'pending_verification',
        vatStatus: request.organization.vatStatus ?? 'vat_payer',
        registeredAddress: {
          street: request.organization.registeredAddress.street,
          city: request.organization.registeredAddress.city,
          postalCode: request.organization.registeredAddress.postalCode,
          country: request.organization.registeredAddress.country,
        },
        customFieldValues: input.customFieldValues.organization,
      });
      try {
        await em.persistAndFlush(organization);
      } catch (err) {
        throw organizationWriteError(err, () => taxIdExistsRefusal());
      }
      // Feature 154 — right after the Organization row, on this `em`, so "no
      // Organization without a channel" holds by construction.
      if (input.salesChannelId !== null) {
        await deps.channelMembership?.replaceChannelsForEntity('organization', organization.id, [input.salesChannelId], {
          em,
        });
      } else {
        await deps.channelMembership?.bindToDefaultIfEmpty('organization', organization.id, { em });
      }

      const customerAccount = await ctx.run(
        input.account.command({
          organizationId: organization.id,
          organizationRoleId: await predefinedRoleIdOn(em, organization.id, 'administrator'),
        }),
      );

      if (input.lookupRow) await persistLookupRow(em, organization, input.lookupRow);

      const verificationToken = randomBytes(32).toString('base64url');
      const token = em.create(EmailVerificationToken, {
        customerAccountId: customerAccount.id,
        tokenHash: createHash('sha256').update(verificationToken, 'utf8').digest('hex'),
        expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1_000),
      });
      await em.persistAndFlush(token);

      // Into the bus's event scope: dispatched on commit, dropped on rollback.
      // The same event `emitCustomerAccountCreated` sends from the other
      // creation paths.
      deps.events.emit('customer_account.created.v1', {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        customerAccountId: customerAccount.id,
        organizationId: organization.id,
      });

      return {
        result: { organization, customerAccount, verificationToken },
        before: null,
        after: {
          status: organization.status,
          changedFields: presentFields(organization, ORGANIZATION_CREATED_FIELDS),
          ...(input.lookupRow
            ? { registryLookup: { provider: input.lookupRow.provider, outcome: input.lookupRow.outcome } }
            : {}),
          // Feature 175 (FR-028) — the keys a buyer supplied, never their
          // values: sorted, each prefixed by its request group as a refusal
          // names it.
          changedCustomFields: [
            ...Object.keys(input.customFieldValues.organization).map((key) => `organization.${key}`),
            ...Object.keys(input.customFieldValues.customer).map((key) => `firstUser.${key}`),
          ].sort(),
        },
      };
    },
    event: (result) => ({
      eventName: 'organization.registered.v1',
      payload: {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        organizationId: result.organization.id,
      },
    }),
  };
}

/**
 * Feature 173 — one validation row for the lookup this registration carried,
 * for the Organization being created, on this `em`. The actor is anonymous, so
 * the write needs the sanctioned hatch; a module's is `withSystemScope` (ruling
 * D-285 keeps `withOrgScope` host-only), and the row names the Organization
 * explicitly. The summary is stamped as the admin trigger stamps it; the
 * registry's legal name is **not** written (OD-7).
 */
async function persistLookupRow(
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
