import type { EntityManager } from '@mikro-orm/postgresql';
import { Organization } from '../entities/organization.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import {
  OrganizationTaxIdValidation,
  type ReturnedAddress,
} from '../entities/organization-tax-id-validation.entity.js';
import type { VatValidator, VatValidationResult } from './vat-validator-port.js';

/**
 * Owns the tax-ID validation flow (feature 026 US7).
 *
 * Inputs:
 *  - `providerHint`: `'auto' | 'vies' | 'mf_pl' | 'format_only'`
 *      `auto` → routes Polish NIPs (PL-prefixed or 10-digit) to MF;
 *      anything that parses as a EU country code prefix → VIES; otherwise
 *      degrades to `format_only`.
 *  - `applyAutoFill`: when the result is `validated` AND the provider
 *    returned a legalName / address, the Organization's `legalName` is
 *    updated and `version` bumps. The address payload is only used for
 *    display in the panel today (no Address-entity writes here — the
 *    existing addresses module owns those).
 *
 * Output:
 *  - Always persists one `OrganizationTaxIdValidation` row, regardless of
 *    outcome. Provider outages produce `deferred` rows that the admin
 *    can retry. The Organization itself NEVER fails its save because of
 *    a validation outage.
 */
export interface TriggerValidationInput {
  providerHint?: 'auto' | 'vies' | 'mf_pl' | 'format_only';
  applyAutoFill?: boolean;
  actorAdminUserId?: string | null;
}

export interface TriggerValidationResult {
  record: OrganizationTaxIdValidation;
  /** Reflects the org's post-update state when `applyAutoFill` was true. */
  organization: {
    id: string;
    legalName: string | null;
    version: number;
  } | null;
}

export interface OrganizationTaxIdValidationServiceDeps {
  emFactory: () => EntityManager;
  /** VIES adapter — production wires `new ViesClient()`; tests inject a stub. */
  vies?: VatValidator;
  /** Ministerstwo Finansów adapter — production wires `new MinisterstwoFinansowClient()`. */
  mfPl?: VatValidator;
  /** Feature 054 — audits the validation write co-transactionally when provided. */
  auditLog?: AuditPort;
}

export class OrganizationTaxIdValidationService {
  constructor(private readonly deps: OrganizationTaxIdValidationServiceDeps) {}

  async listForOrganization(
    organizationId: string,
    options: { limit?: number } = {},
  ): Promise<OrganizationTaxIdValidation[]> {
    const em = this.deps.emFactory();
    return em.find(
      OrganizationTaxIdValidation,
      { organizationId },
      { orderBy: { createdAt: 'desc' }, limit: Math.min(options.limit ?? 25, 100) },
    );
  }

  async trigger(
    organizationId: string,
    input: TriggerValidationInput = {},
  ): Promise<TriggerValidationResult> {
    const em = this.deps.emFactory();
    const org = await em.findOneOrFail(Organization, {
      id: organizationId,
      deletedAt: null,
    });

    const providerKind = this.pickProvider(org.taxId, input.providerHint ?? 'auto');
    const result: VatValidationResult = await this.runProvider(providerKind, org.taxId);

    const record = em.create(OrganizationTaxIdValidation, {
      organizationId,
      provider: providerKind,
      outcome: result.outcome,
      taxIdValue: org.taxId,
      legalNameReturned: result.legalName,
      addressReturned: result.address,
      errorKind: result.errorKind,
      requestedByAdminUserId: input.actorAdminUserId ?? null,
    });
    await em.persistAndFlush(record);

    // Stamp the org's "last validation" summary fields regardless of
    // outcome — the admin panel reads `vatValidatedAt`, `vatValidationProvider`,
    // and `vatValidationOutcome` directly off the Organization.
    org.vatValidatedAt = new Date();
    org.vatValidationProvider = providerKind;
    org.vatValidationOutcome = result.outcome;

    let appliedOrg: TriggerValidationResult['organization'] = null;
    if (input.applyAutoFill && result.outcome === 'validated' && result.legalName) {
      org.legalName = result.legalName;
    }
    if (this.deps.auditLog) {
      recordAuditFromContext(this.deps.auditLog, em, {
        action: 'organization.tax_id_validation',
        objectType: 'organization',
        objectId: org.id,
        stateBefore: null,
        stateAfter: {
          provider: providerKind,
          outcome: result.outcome,
          appliedAutoFill: input.applyAutoFill && result.outcome === 'validated' && !!result.legalName,
        },
      });
    }
    await em.flush();
    if (input.applyAutoFill && result.outcome === 'validated' && result.legalName) {
      appliedOrg = {
        id: org.id,
        legalName: org.legalName ?? null,
        version: org.version,
      };
    }

    return { record, organization: appliedOrg };
  }

  private pickProvider(
    taxId: string,
    hint: 'auto' | 'vies' | 'mf_pl' | 'format_only',
  ): 'vies' | 'mf_pl' | 'format_only' {
    if (hint === 'vies') return 'vies';
    if (hint === 'mf_pl') return 'mf_pl';
    if (hint === 'format_only') return 'format_only';
    // auto-pick
    const cleaned = taxId.replace(/[\s-]+/g, '').toUpperCase();
    if (/^PL[0-9]{10}$/.test(cleaned) || /^[0-9]{10}$/.test(cleaned)) {
      return 'mf_pl';
    }
    if (/^[A-Z]{2}.+$/.test(cleaned)) {
      return 'vies';
    }
    return 'format_only';
  }

  private async runProvider(
    provider: 'vies' | 'mf_pl' | 'format_only',
    taxId: string,
  ): Promise<VatValidationResult> {
    if (provider === 'format_only') {
      const cleaned = taxId.replace(/[\s-]+/g, '');
      const looksLikeId = /^[A-Z0-9]{6,32}$/i.test(cleaned);
      return {
        outcome: looksLikeId ? 'unverified' : 'failed',
        legalName: null,
        address: null,
        errorKind: looksLikeId ? null : 'invalid_format',
      };
    }
    if (provider === 'vies') {
      if (!this.deps.vies) {
        return {
          outcome: 'deferred',
          legalName: null,
          address: null,
          errorKind: 'provider_not_wired',
        };
      }
      return this.deps.vies.validate({ taxId });
    }
    if (!this.deps.mfPl) {
      return {
        outcome: 'deferred',
        legalName: null,
        address: null,
        errorKind: 'provider_not_wired',
      };
    }
    return this.deps.mfPl.validate({ taxId });
  }
}

// Re-export for downstream consumers that want the ReturnedAddress type.
export type { ReturnedAddress };
