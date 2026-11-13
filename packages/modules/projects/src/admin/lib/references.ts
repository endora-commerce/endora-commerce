import { useMemo } from 'react';
import type { ProjectComment, ProjectCommentKind } from '@endora-commerce/contracts';
import type { CommentThreadApi, ReferenceLookups, ReferenceTriggerKind } from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useAppLanguage } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';

/** People and documents are chosen through Projects' own lookups, offered to whoever may write. */
const WRITE_PERMISSION = 'projects:write';
/** A Product is searched in `catalog`'s own list, offered to a role holding its code. */
const PRODUCT_LIST_PERMISSION = 'catalog:read';
/**
 * The codes the groups of the `@@` list are read with (FR-044), and whether the
 * group needs an Organization of the Project. The server answers each group
 * only for its code and its present owner; the list is offered when any one
 * group could be answered, so a role that could never be keeps `@@` as typed.
 *
 * The codes are written at the `hasAnyPermission` call below, as one literal
 * (issue #458); this set names the groups that need an Organization.
 */
const ORGANIZATION_DOCUMENT_GROUPS: ReadonlySet<string> = new Set(['orders:read', 'rfqs:handle']);

/** A Product's name in the language on screen, then any name it has, then its SKU. */
function productLabel(name: Record<string, string>, sku: string, language: string): string {
  const base = language.split('-')[0] ?? language;
  const sameLanguage = Object.keys(name).find((locale) => locale === base || locale.startsWith(`${base}-`));
  return name[language] || (sameLanguage ? name[sameLanguage] : undefined) || Object.values(name).find(Boolean) || sku;
}

/** Where a text's references come from: its Project, and whether that Project has Organizations. */
export interface ProjectReferenceScope {
  /** `null` before there is a Project. */
  projectId: string | null;
  /** Orders and Quote Requests are those of the Project's Organizations: none for an internal Project. */
  hasOrganizations: boolean;
  /**
   * Before there is a Project (the create form): the Organizations chosen on
   * the form, whose Orders and Quote Requests the `@@` list offers.
   */
  organizationIds?: readonly string[];
}

/**
 * What a Project's text may refer to, and where the kit's reference editor
 * finds it (`specs/163-projects-and-tasks/` research R-14, R-17) — the
 * standard trigger table, `@` a person, `@@` a document, `@@@` a Product:
 * people and the grouped document list through Projects' own lookups, Products
 * through `catalog`'s list. Only what the reader may search is offered.
 */
export function useProjectReferences(scope: ProjectReferenceScope): {
  kinds: readonly ReferenceTriggerKind[];
  lookups: ReferenceLookups;
} {
  const { hasPermission, hasAnyPermission } = useAuth();
  const { language } = useAppLanguage();
  const { projectId, hasOrganizations } = scope;
  // A stable key for the chosen Organizations, so the lookups change only when they do.
  const organizationKey = projectId === null ? (scope.organizationIds ?? []).join(',') : '';
  const canWrite = hasPermission(WRITE_PERMISSION);
  const canDocuments =
    canWrite &&
    // One literal any-of (issue #458), so the permission inventory reads every
    // group's code; the narrowing drops the groups this text cannot answer.
    // `specs/165-task-management/` R-5: `crm:read` is the Opportunities group.
    // This module's own Projects group is answered to every writer but does
    // not open `@@` on its own — issue #498.
    hasAnyPermission(
      ['orders:read', 'rfqs:handle', 'tasks:read', 'crm:read'].filter(
        (code) => hasOrganizations || !ORGANIZATION_DOCUMENT_GROUPS.has(code),
      ),
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
        (await projectsApi.lookupMentionable(projectId, query)).map((person) => ({
          id: person.id,
          label: person.name,
          description: person.email,
        })),
      searchDocuments: (query) =>
        projectsApi.lookupDocuments(projectId, query, organizationKey === '' ? [] : organizationKey.split(',')),
      searchProducts: async (query) =>
        (await projectsApi.searchProducts(query)).map((product) => ({
          id: product.id,
          label: productLabel(product.name, product.sku, language),
          description: product.sku,
        })),
    }),
    [projectId, organizationKey, language],
  );

  return { kinds, lookups };
}

/** The notes, or the messages, of one Project, as the kit's `CommentThread` asks for them (`contracts/admin-api.md` §2.4). */
export function useProjectComments(projectId: string, kind: ProjectCommentKind): CommentThreadApi<ProjectComment> {
  return useMemo(
    () => ({
      list: () => projectsApi.listComments(projectId, kind),
      add: (body: string) => projectsApi.addComment(projectId, kind, body),
      update: (commentId: string, body: string) => projectsApi.updateComment(projectId, commentId, body),
      remove: (commentId: string) => projectsApi.deleteComment(projectId, commentId),
    }),
    [projectId, kind],
  );
}
