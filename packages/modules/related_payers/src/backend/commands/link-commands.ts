import { randomUUID } from 'node:crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  RELATED_PAYERS_EVENTS,
  type PayerCommercialTerms,
  type RelatedPayerAddressScope,
  type RelatedPayerLinkEventV1,
  type RelatedPayerLinkRevokedOutbox,
  type RelatedPayerLinkOrigin,
  type RelatedPayerRevokedByKind,
} from '@endora-commerce/contracts';
import type { Command, CommandEvent } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { RelatedPayerLink } from '../entities/related-payer-link.entity.js';
import { assertNoLiveLinkForPair, assertStateChange } from '../services/link-state.js';
import {
  LINK_EDITABLE_FIELDS,
  linkCreatedState,
  linkTermsState,
  type LinkActorKind,
  type LinkEditableField,
} from './audit-state.js';

/**
 * The four link Commands (`contracts/commands-audit.md`). Each is one `CommandBus.run`:
 * one transaction, one audit entry (names only, `audit-state.ts`), one names-only event
 * dispatched on commit. Pair validity against the Organizations and the payer's address
 * are checked by the caller before the Command runs (`link-write-service.ts`); what the
 * Command owns is the link row and its invariants.
 */

const OBJECT_TYPE = 'related_payer_link';

/** An ISO instant (RP-15) as the entity stores it. */
function instant(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

/** The same instant in the one spelling `toISOString` gives, so equal instants compare equal. */
function canonical(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function linkEvent(eventName: string, link: RelatedPayerLink, changedFields?: readonly string[]): CommandEvent {
  const payload: RelatedPayerLinkEventV1 = {
    linkId: link.id,
    buyerOrganizationId: link.organizationId,
    payerOrganizationId: link.payerOrganizationId,
    state: link.state,
    commercialTerms: link.commercialTerms,
    ...(changedFields ? { changedFields } : {}),
  };
  return { eventName, payload: payload as never };
}

async function loadForWrite(
  em: Parameters<Command['run']>[0]['em'],
  linkId: string,
  expectedVersion: number | undefined,
): Promise<RelatedPayerLink> {
  const link = await em.findOne(RelatedPayerLink, { id: linkId });
  if (!link) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Payer link not found.');
  if (expectedVersion !== undefined && link.version !== expectedVersion) {
    throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'The payer link changed since it was read.', {
      currentVersion: link.version,
    });
  }
  return link;
}

export interface LinkCreateInput {
  readonly buyerOrganizationId: string;
  readonly payerOrganizationId: string;
  readonly addressScope: RelatedPayerAddressScope;
  readonly validFrom?: string | null | undefined;
  readonly validTo?: string | null | undefined;
  readonly commercialTerms: PayerCommercialTerms;
  readonly notifyPayerOnOrders?: boolean | undefined;
  readonly origin: RelatedPayerLinkOrigin;
  readonly source?: string | undefined;
  readonly originRequestId?: string | undefined;
  readonly actorKind: LinkActorKind;
}

/** `related_payers.link.create` — FR-010, FR-011. Refuses a pair that already has a live link. */
export function linkCreateCommand(input: LinkCreateInput): Command<RelatedPayerLink> {
  const id = randomUUID();
  return {
    action: 'related_payers.link.create',
    objectType: OBJECT_TYPE,
    objectId: id,
    async run({ em }) {
      assertNoLiveLinkForPair(
        await em.find(RelatedPayerLink, {
          organizationId: input.buyerOrganizationId,
          payerOrganizationId: input.payerOrganizationId,
        }),
      );
      const link = em.create(RelatedPayerLink, {
        id,
        organizationId: input.buyerOrganizationId,
        payerOrganizationId: input.payerOrganizationId,
        state: 'active',
        addressScope: input.addressScope.kind,
        billingAddressId: input.addressScope.kind === 'one' ? input.addressScope.billingAddressId : null,
        validFrom: instant(input.validFrom),
        validTo: instant(input.validTo),
        commercialTerms: input.commercialTerms,
        notifyPayerOnOrders: input.notifyPayerOnOrders ?? false,
        origin: input.origin,
        originSource: input.source ?? null,
        originRequestId: input.originRequestId ?? null,
      });
      em.persist(link);
      try {
        await em.flush();
      } catch (error) {
        // The partial unique index is the arbiter under concurrency (FR-010).
        if (error instanceof UniqueConstraintViolationException) {
          throw new HttpError(422, ERROR_CODES.RELATED_PAYER_LINK_EXISTS, 'This organization is already linked as a payer.');
        }
        throw error;
      }
      return { result: link, before: null, after: linkCreatedState(link, input.actorKind) };
    },
    event: (link) => linkEvent(RELATED_PAYERS_EVENTS.LINK_CREATED, link),
  };
}

export interface LinkUpdatePatch {
  readonly addressScope?: RelatedPayerAddressScope | undefined;
  readonly validFrom?: string | null | undefined;
  readonly validTo?: string | null | undefined;
  readonly commercialTerms?: PayerCommercialTerms | undefined;
  readonly notifyPayerOnOrders?: boolean | undefined;
}

/**
 * `related_payers.link.update` — scope, window, terms, notify flag (FR-021, FR-118). Records
 * the changed field names and their codes / dates before and after. A revoked link is
 * terminal and is not edited; an update that changes nothing records nothing.
 */
export function linkUpdateCommand(
  linkId: string,
  patch: LinkUpdatePatch,
  options: { readonly expectedVersion?: number | undefined; readonly actorKind: LinkActorKind },
): Command<RelatedPayerLink> {
  return {
    action: 'related_payers.link.update',
    objectType: OBJECT_TYPE,
    objectId: linkId,
    async run({ em }) {
      const link = await loadForWrite(em, linkId, options.expectedVersion);
      if (link.state === 'revoked') {
        throw new HttpError(409, ERROR_CODES.INVALID_TRANSITION, 'A revoked payer link cannot be changed.', {
          from: 'revoked',
        });
      }
      const before = linkTermsState(link);
      const next: Record<LinkEditableField, unknown> = { ...before };
      if (patch.addressScope !== undefined) {
        next.addressScope = patch.addressScope.kind;
        next.billingAddressId = patch.addressScope.kind === 'one' ? patch.addressScope.billingAddressId : null;
      }
      if (patch.validFrom !== undefined) next.validFrom = canonical(patch.validFrom);
      if (patch.validTo !== undefined) next.validTo = canonical(patch.validTo);
      if (patch.commercialTerms !== undefined) next.commercialTerms = patch.commercialTerms;
      if (patch.notifyPayerOnOrders !== undefined) next.notifyPayerOnOrders = patch.notifyPayerOnOrders;
      const from = next.validFrom as string | null;
      const to = next.validTo as string | null;
      if (from !== null && to !== null && Date.parse(from) > Date.parse(to)) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'validTo must not be before validFrom.', [
          { path: 'validTo', issue: 'must not be before validFrom' },
        ]);
      }
      const changedFields = LINK_EDITABLE_FIELDS.filter((field) => before[field] !== next[field]);
      if (changedFields.length === 0) return { result: link, skipAudit: true };
      Object.assign(link, {
        ...next,
        validFrom: instant(next.validFrom as string | null),
        validTo: instant(next.validTo as string | null),
      });
      link.version += 1;
      em.persist(link);
      const pick = (state: Record<LinkEditableField, unknown>) =>
        Object.fromEntries(changedFields.map((field) => [field, state[field]]));
      return {
        result: link,
        before: pick(before),
        after: { changedFields: [...changedFields], ...pick(next), actorKind: options.actorKind, version: link.version },
      };
    },
    event: (link) => linkEvent(RELATED_PAYERS_EVENTS.LINK_CHANGED, link),
  };
}

/** `related_payers.link.set_state` — `active ⇄ inactive` (FR-013). */
export function linkSetStateCommand(
  linkId: string,
  state: 'active' | 'inactive',
  options: { readonly expectedVersion?: number | undefined; readonly actorKind: LinkActorKind },
): Command<RelatedPayerLink> {
  return {
    action: 'related_payers.link.set_state',
    objectType: OBJECT_TYPE,
    objectId: linkId,
    async run({ em }) {
      const link = await loadForWrite(em, linkId, options.expectedVersion);
      const from = link.state;
      assertStateChange(from, state);
      link.state = state;
      link.version += 1;
      em.persist(link);
      return {
        result: link,
        before: { state: from },
        after: { state, actorKind: options.actorKind, version: link.version },
      };
    },
    event: (link) => linkEvent(RELATED_PAYERS_EVENTS.LINK_CHANGED, link, ['state']),
  };
}

/** `related_payers.link.revoke` — terminal (FR-013, FR-050). */
export function linkRevokeCommand(
  linkId: string,
  options: {
    readonly revokedByKind: RelatedPayerRevokedByKind;
    readonly revokedById: string | null;
    readonly source?: string | undefined;
    readonly expectedVersion?: number | undefined;
  },
): Command<RelatedPayerLink> {
  return {
    action: 'related_payers.link.revoke',
    objectType: OBJECT_TYPE,
    objectId: linkId,
    async run({ em }) {
      const link = await loadForWrite(em, linkId, options.expectedVersion);
      const from = link.state;
      assertStateChange(from, 'revoked');
      link.state = 'revoked';
      link.revokedAt = new Date();
      link.revokedByKind = options.revokedByKind;
      link.revokedById = options.revokedById;
      link.version += 1;
      em.persist(link);
      return {
        result: link,
        before: { state: from },
        after: {
          state: 'revoked',
          revokedByKind: options.revokedByKind,
          ...(options.source ? { source: options.source } : {}),
          version: link.version,
        },
      };
    },
    event: (link) => linkEvent(RELATED_PAYERS_EVENTS.LINK_REVOKED, link),
    // FR-050 — the other side is told after the commit, through the outbox.
    outboxData: (link): RelatedPayerLinkRevokedOutbox => ({
      linkId: link.id,
      revokedByKind: link.revokedByKind ?? options.revokedByKind,
      payerOrganizationId: link.payerOrganizationId,
      organizationId: link.organizationId,
    }),
  };
}
