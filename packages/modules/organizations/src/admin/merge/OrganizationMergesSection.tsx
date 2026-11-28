import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { OrganizationMergeView } from '@endora-commerce/contracts';
import { formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, EditorSection } from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { organizationMergesApi } from './merge-api.js';

/**
 * The merges an organization took part in, on its own screen
 * (`specs/192-organization-merge/` FR-080, US3; `contracts/organization-merge.md`
 * §5), for an operator holding `organizations:merge` — the code the list is
 * read under; the caller mounts it only then.
 *
 * - A running merge, or one that needs attention, as a notice above the tabs,
 *   linking to its progress — on the loser it also says the organization is
 *   frozen until the merge completes.
 * - *Merged from …*: every completed merge into this organization, newest
 *   first, each leading to its record. The Organization screen has no history
 *   tab of its own, so this is where the survivor's history shows its merges;
 *   the audit log keeps the full entries.
 */
export function OrganizationMergeNotices({ merges, organizationId }: { merges: readonly OrganizationMergeView[]; organizationId: string }): ReactNode {
  const own = useTranslation('organizations');
  const active = merges.filter((m) => m.state === 'running' || m.state === 'needs_attention');
  if (active.length === 0) return null;
  return (
    <>
      {active.map((merge) => {
        const loser = merge.loserName ?? merge.loserId;
        const survivor = merge.survivorName ?? merge.survivorId;
        const key =
          merge.loserId === organizationId
            ? merge.state === 'needs_attention'
              ? 'merge.notice.loserAttention'
              : 'merge.notice.loserRunning'
            : merge.state === 'needs_attention'
              ? 'merge.notice.survivorAttention'
              : 'merge.notice.survivorRunning';
        return (
          <Alert key={merge.id} variant="warning" className="mb-4">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{own(key, { loser, survivor })}</span>
              <Link className="underline underline-offset-2" to={`/organizations/merges/${merge.id}`}>
                {own('merge.notice.view')}
              </Link>
            </AlertDescription>
          </Alert>
        );
      })}
    </>
  );
}

/** *Merged from …* — the completed merges into this organization. Renders nothing when there are none. */
export function MergedFromSection({ merges, organizationId }: { merges: readonly OrganizationMergeView[]; organizationId: string }): ReactNode {
  const own = useTranslation('organizations');
  const { language } = useTranslationContext();
  const merged = merges
    .filter((m) => m.state === 'completed' && m.survivorId === organizationId)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  if (merged.length === 0) return null;
  return (
    <EditorSection title={own('merge.mergedFrom.title')}>
      <ul className="divide-y text-sm">
        {merged.map((merge) => (
          <li key={merge.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
            <span>{own('merge.mergedFrom.entry', { loser: merge.loserName ?? merge.loserId })}</span>
            <span className="flex items-center gap-3 text-muted-foreground">
              {merge.completedAt !== null ? <time dateTime={merge.completedAt}>{formatDateTime(merge.completedAt, language)}</time> : null}
              <Link className="underline underline-offset-2" to={`/organizations/merges/${merge.id}`}>
                {own('merge.notice.view')}
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </EditorSection>
  );
}

/** The merges involving one organization, read once for both views above; empty while loading or on failure. */
export function useOrganizationMerges(organizationId: string, enabled: boolean, reloadKey = 0): OrganizationMergeView[] {
  const [merges, setMerges] = useState<OrganizationMergeView[]>([]);
  useEffect(() => {
    if (!enabled) {
      setMerges([]);
      return;
    }
    let live = true;
    organizationMergesApi
      .list({ organizationId })
      .then((rows) => {
        if (live) setMerges(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        // A notice is a courtesy: the screen works without it, and a write the merge freezes says so itself.
        if (live) setMerges([]);
      });
    return (): void => {
      live = false;
    };
  }, [organizationId, enabled, reloadKey]);
  return merges;
}
