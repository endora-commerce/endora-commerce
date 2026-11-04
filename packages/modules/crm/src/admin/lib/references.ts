import { useCallback, useMemo } from 'react';
import type { OpportunityComment, OpportunityCommentKind } from '@endora-commerce/contracts';
import type { CommentThreadApi, ReferenceLookups, ReferenceTriggerKind } from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useAppLanguage } from '@endora-commerce/admin-kit/i18n';
import { crmApi, type OrderStatusOption } from '../api.js';
import { orderStatusLabel } from './labels.js';

/**
 * The codes a reference is chosen with. A Product is searched in `catalog`'s
 * own list, offered to a role holding its code (research N-H3); the people who
 * may be mentioned and the `@@` document list are CRM's own lookups, offered to
 * whoever may write.
 */
const PRODUCT_LIST_PERMISSION = 'catalog:read';
const WRITE_PERMISSION = 'crm:write';
/**
 * The codes the groups of the `@@` list are read with
 * (`specs/163-projects-and-tasks/` FR-044), and whether the group needs an
 * Organization. The server answers each group only for its code and its
 * present owner; the list is offered when **any one** group could be answered,
 * so a role that could never be keeps `@@` as the characters it typed. An
 * any-of, deliberately: `orders:read` is a code no operator can withdraw, so
 * switching Quote Requests or Tasks off never leaves the list behind a code
 * nobody can be granted — it only empties that group.
 */
const DOCUMENT_GROUP_PERMISSIONS: ReadonlyArray<{ code: string; needsOrganization: boolean }> = [
  { code: 'orders:read', needsOrganization: true },
  { code: 'rfqs:handle', needsOrganization: true },
  { code: 'tasks:read', needsOrganization: false },
  // `specs/165-task-management/` R-5: the Projects group. CRM's own
  // Opportunities group is answered to every writer but does not open `@@` on
  // its own — issue #498.
  { code: 'projects:read', needsOrganization: false },
];

/** A Product's Global name (feature 172, FR-031 — an operator screen has no channel), else its SKU. */
function productLabel(name: string, sku: string): string {
  return name || sku;
}

/** Where a text's documents come from: its Opportunity, or — on the create form — the Organization chosen. */
export interface CrmReferenceScope {
  /** The Organization whose people may be mentioned and whose documents are offered; `null` while none is chosen. */
  organizationId: string | null;
  /** The Opportunity the text belongs to; absent on the create form and for an Event's description. */
  opportunityId?: string | null;
}

/**
 * What a CRM text may refer to, and where the kit's reference editor finds it
 * (`specs/163-projects-and-tasks/` research R-14, R-17) — the standard trigger
 * table, `@` a person, `@@` a document, `@@@` a Product: people through CRM's
 * own `mentionable` lookup, the grouped document list (Orders · Quote Requests
 * · Tasks) through CRM's own `lookups/documents`, Products through
 * `catalog`'s list. Orders and Quote Requests need an Organization — the
 * Opportunity's, or the one chosen on the create form — and Tasks do not.
 */
export function useCrmReferences(scope: CrmReferenceScope): {
  kinds: readonly ReferenceTriggerKind[];
  lookups: ReferenceLookups;
} {
  const { hasPermission } = useAuth();
  const { organizationId } = scope;
  const opportunityId = scope.opportunityId ?? null;
  const canWrite = hasPermission(WRITE_PERMISSION);
  const withOrganization = organizationId !== null || opportunityId !== null;
  const canDocuments =
    canWrite &&
    DOCUMENT_GROUP_PERMISSIONS.some(
      (group) => (withOrganization || !group.needsOrganization) && hasPermission(group.code),
    );
  const canProducts = hasPermission(PRODUCT_LIST_PERMISSION);

  const kinds = useMemo(
    (): readonly ReferenceTriggerKind[] => [
      ...(canWrite ? (['admin_user'] as const) : []),
      ...(canDocuments ? (['document'] as const) : []),
      ...(canProducts ? (['product'] as const) : []),
    ],
    [canWrite, canDocuments, canProducts],
  );

  const lookups = useMemo(
    (): ReferenceLookups => ({
      searchPeople: async (query) =>
        (await crmApi.lookupMentionable(organizationId, query)).map((person) => ({ id: person.id, label: person.name })),
      searchDocuments: (query) => crmApi.lookupDocuments({ opportunityId, organizationId }, query),
      searchProducts: async (query) =>
        (await crmApi.searchProducts(query)).map((product) => ({
          id: product.id,
          label: productLabel(product.name, product.sku),
          description: product.sku,
        })),
    }),
    [organizationId, opportunityId],
  );

  return { kinds, lookups };
}

/** A referenced Order's status by `orders`' name for it, in the language on screen — its code without the statuses. */
export function useOrderStatusLabel(statuses: readonly OrderStatusOption[] | undefined): (code: string) => string {
  const { language } = useAppLanguage();
  return useCallback((code: string) => orderStatusLabel(code, statuses ?? [], language), [statuses, language]);
}

/** The notes, or the messages, of one Opportunity, as the kit's `CommentThread` asks for them (`contracts/admin-api.md` §6). */
export function useOpportunityComments(
  opportunityId: string,
  kind: OpportunityCommentKind,
): CommentThreadApi<OpportunityComment> {
  return useMemo(
    () => ({
      list: () => crmApi.listComments(opportunityId, kind),
      add: (body: string) => crmApi.addComment(opportunityId, kind, body),
      update: (commentId: string, body: string) => crmApi.updateComment(opportunityId, commentId, body),
      remove: (commentId: string) => crmApi.deleteComment(opportunityId, commentId),
    }),
    [opportunityId, kind],
  );
}
