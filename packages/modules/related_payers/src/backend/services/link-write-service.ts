import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AddressReadPort,
  type OrganizationDetailsPort,
  type RelatedPayerAddressScope,
  type RelatedPayerRevokedByKind,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { RelatedPayerLink } from '../entities/related-payer-link.entity.js';
import type { LinkActorKind } from '../commands/audit-state.js';
import {
  linkCreateCommand,
  linkRevokeCommand,
  linkSetStateCommand,
  linkUpdateCommand,
  type LinkCreateInput,
  type LinkUpdatePatch,
} from '../commands/link-commands.js';
import { assertLinkablePair } from './link-state.js';

export interface LinkWriteServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  /** `organizations`' read port — resolved per call by the composition (`lazyPort`). */
  readonly organizations: Pick<OrganizationDetailsPort, 'findById'>;
  /** `addresses`' read port — the payer's billing address for a one-address scope. */
  readonly addresses: Pick<AddressReadPort, 'findById'>;
  /** Called after every committed link write: the cache drop and its fan-out (research R-9). */
  readonly onLinksChanged?: (buyerOrganizationId: string) => Promise<void>;
}

/**
 * Every link write, for every caller — the operator routes and `relatedPayerWritePort`
 * alike — so the pair rules, the address check, the Command and the cache drop are one
 * path. The caller establishes the tenant context and says who acted (`actorKind`).
 */
export class LinkWriteService {
  constructor(private readonly deps: LinkWriteServiceDeps) {}

  async create(input: LinkCreateInput): Promise<{ link: RelatedPayerLink; created: true }> {
    const [buyer, payer] = await Promise.all([
      this.deps.organizations.findById(input.buyerOrganizationId),
      this.deps.organizations.findById(input.payerOrganizationId),
    ]);
    if (!buyer || buyer.deletedAt || !payer || payer.deletedAt) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
    }
    assertLinkablePair(buyer, payer);
    await this.#assertPayerBillingAddress(input.payerOrganizationId, input.addressScope);
    const link = await this.deps.commandBus.run(linkCreateCommand(input));
    await this.#changed(link.organizationId);
    return { link, created: true };
  }

  async update(
    linkId: string,
    patch: LinkUpdatePatch,
    options: { readonly expectedVersion?: number | undefined; readonly actorKind: LinkActorKind },
  ): Promise<RelatedPayerLink> {
    if (patch.addressScope?.kind === 'one') {
      const current = await this.findById(linkId);
      await this.#assertPayerBillingAddress(current.payerOrganizationId, patch.addressScope);
    }
    const link = await this.deps.commandBus.run(linkUpdateCommand(linkId, patch, options));
    await this.#changed(link.organizationId);
    return link;
  }

  async setState(
    linkId: string,
    state: 'active' | 'inactive',
    options: { readonly expectedVersion?: number | undefined; readonly actorKind: LinkActorKind },
  ): Promise<RelatedPayerLink> {
    const link = await this.deps.commandBus.run(linkSetStateCommand(linkId, state, options));
    await this.#changed(link.organizationId);
    return link;
  }

  async revoke(
    linkId: string,
    options: {
      readonly revokedByKind: RelatedPayerRevokedByKind;
      readonly revokedById: string | null;
      readonly source?: string | undefined;
      readonly expectedVersion?: number | undefined;
    },
  ): Promise<RelatedPayerLink> {
    const link = await this.deps.commandBus.run(linkRevokeCommand(linkId, options));
    await this.#changed(link.organizationId);
    return link;
  }

  /** The link, read in the ambient tenant context; `null` when it is not in reach. */
  async find(linkId: string): Promise<RelatedPayerLink | null> {
    return this.deps.emFactory().findOne(RelatedPayerLink, { id: linkId });
  }

  /** {@link find}, refusing with `404` when the link is not in reach. */
  async findById(linkId: string): Promise<RelatedPayerLink> {
    const link = await this.find(linkId);
    if (!link) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Payer link not found.');
    return link;
  }

  /** The pair's non-revoked link, if any (FR-010: at most one). */
  async findLiveForPair(buyerOrganizationId: string, payerOrganizationId: string): Promise<RelatedPayerLink | null> {
    const links = await this.deps
      .emFactory()
      .find(RelatedPayerLink, { organizationId: buyerOrganizationId, payerOrganizationId });
    return links.find((link) => link.state !== 'revoked') ?? null;
  }

  async #assertPayerBillingAddress(payerOrganizationId: string, scope: RelatedPayerAddressScope): Promise<void> {
    if (scope.kind !== 'one') return;
    const address = await this.deps.addresses.findById(payerOrganizationId, scope.billingAddressId, { liveOnly: true });
    if (!address || address.kind !== 'billing') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The address is not a billing address of the payer.', [
        { path: 'addressScope.billingAddressId', issue: 'not a live billing address of the payer' },
      ]);
    }
  }

  async #changed(buyerOrganizationId: string): Promise<void> {
    await this.deps.onLinksChanged?.(buyerOrganizationId);
  }
}
