import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { OrganizationPicker, ImmediateBadge } from '@endora-commerce/admin-kit/components';
import { Alert, AlertDescription, EditorSection, InlineStatus, Label, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

interface TreeNode {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  status: string;
}

export interface HierarchyPanelProps {
  organizationId: string;
  /** Current parent id (null ⇒ root). */
  parentId: string | null;
  onChanged: () => void | Promise<void>;
}

/**
 * Feature 056 US1 — organization hierarchy editor. Reuses the shared
 * OrganizationPicker to assign / move / detach the parent (through the
 * Command-Bus-backed `POST /:id/parent` endpoint), and renders the ancestor
 * chain + the pre-order subtree.
 */
export function HierarchyPanel(props: HierarchyPanelProps): ReactNode {
  const t = useTranslation('core');
  const { organizationId, parentId, onChanged } = props;
  const [ancestors, setAncestors] = useState<TreeNode[]>([]);
  const [subtree, setSubtree] = useState<TreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Issue #1499 (UX audit SALES-17, DEC-12 a) — "parent updated" is said beside
  // the picker that changed it, in a region mounted before it has text, not as a
  // success banner at the top of the card.
  const { props: statusProps, show: showStatus, clear: clearStatus } = useInlineStatus();

  const load = useCallback(async (): Promise<void> => {
    try {
      const [anc, sub] = await Promise.all([
        apiClient.get<{ items: TreeNode[] }>(
          `/api/v1/admin/organizations/${organizationId}/ancestors`,
        ),
        apiClient.get<{ items: TreeNode[] }>(
          `/api/v1/admin/organizations/${organizationId}/subtree`,
        ),
      ]);
      setAncestors(anc.items);
      setSubtree(sub.items);
    } catch {
      // Non-fatal: the panel simply shows no chain/subtree.
      setAncestors([]);
      setSubtree([]);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignParent = useCallback(
    async (nextParentId: string | null): Promise<void> => {
      if (nextParentId === organizationId) return; // self-parent — server would 422
      setError(null);
      clearStatus();
      try {
        await apiClient.post(`/api/v1/admin/organizations/${organizationId}/parent`, {
          parentId: nextParentId,
        });
        showStatus(t('organizations.detail.hierarchySaved'));
        await load();
        await onChanged();
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.envelope.error.message
            : t('organizations.detail.hierarchyError'),
        );
      }
    },
    [organizationId, load, onChanged, t, showStatus, clearStatus],
  );

  // The subtree includes this org at depth 0 — indent descendants relative to it.
  const rootDepth = subtree.find((n) => n.id === organizationId)?.depth ?? 0;

  return (
    // Issue #1515 — a section of the Overview tab's card, not a card of its own.
    <EditorSection
      title={
        <>
          {t('organizations.detail.hierarchyCard')}
          <ImmediateBadge className="align-middle" />
        </>
      }
      contentClassName="space-y-4"
    >
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="org-parent-picker">
            {t('organizations.detail.hierarchyParentLabel')}
          </Label>
          <OrganizationPicker
            id="org-parent-picker"
            value={parentId}
            onChange={(next) => void assignParent(next)}
            clearable
            ariaLabel={t('organizations.detail.hierarchyParentLabel')}
          />
          <InlineStatus {...statusProps} />
          <p className="text-xs text-muted-foreground">
            {t('organizations.detail.hierarchyParentHint')}
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t('organizations.detail.hierarchyAncestors')}
          </p>
          {ancestors.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('organizations.detail.hierarchyRoot')}
            </p>
          ) : (
            <p className="text-sm">
              {ancestors
                .slice()
                .reverse()
                .map((n) => n.name)
                .join(' → ')}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t('organizations.detail.hierarchySubtree')}
          </p>
          {subtree.filter((n) => n.id !== organizationId).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('organizations.detail.hierarchyNoChildren')}
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {subtree.map((n) => (
                <li
                  key={n.id}
                  style={{ paddingLeft: `${Math.max(0, n.depth - rootDepth) * 16}px` }}
                >
                  {n.name}
                </li>
              ))}
            </ul>
          )}
        </div>
    </EditorSection>
  );
}
