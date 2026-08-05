import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/useTranslation';
import type { FeedRunIssueDto } from '../api';

/**
 * Per-item diagnostics, **grouped by reason first and items second** —
 * ux-design §2.4, FR-054.
 *
 * A flat list of sixty-one rows tells an operator nothing; four reason headings
 * tell them what to go and fix. So the screen is a small set of collapsed
 * disclosures, the largest expanded, each naming a cause and a count.
 *
 * Three details that are easy to lose:
 *
 *  - **items are capped per group.** A hundred SKUs is already more than anyone
 *    reads; the count says how many there are and the CSV export carries the
 *    rest, so the page never becomes the thing that has to be scrolled.
 *  - **the two provider-category groups carry a `Fix mapping →` button.** They
 *    are the only reasons whose fix lives on another screen, and an operator who
 *    has to find `/product-feeds/category-mapping` by themselves usually does
 *    not (FR-083, FR-085).
 *  - **SKUs are plain text, never links.** The SKU is a snapshot of a run that
 *    already happened, and the product may since have been renamed or deleted;
 *    a link that 404s a week later is worse than no link.
 */

/** Beyond this an operator scrolls rather than reads. The export has them all. */
const ITEMS_PER_GROUP = 100;

/** The two reasons whose fix is on the category-mapping screen. */
const MAPPING_REASONS = new Set(['unmapped_provider_category', 'stale_provider_category_mapping']);

export interface RunIssueGroupsProps {
  issues: FeedRunIssueDto[];
  severity: 'skip' | 'warning';
  /** True once the run hit the per-run cap, so the page can say so. */
  overflow: boolean;
  issueCapHint: number;
  /**
   * True when the fetch itself filled a whole page, so rows beyond it exist but
   * were never loaded. A different fact from `overflow`: that one is about what
   * the run recorded, this one about what this screen asked for. Both point at
   * the CSV export, which is paged server-side and always complete.
   */
  truncated?: boolean;
  /** Page size behind `truncated`, for the sentence. */
  pageLimit?: number;
}

interface Group {
  reason: string;
  items: FeedRunIssueDto[];
}

/** Groups by reason, largest first: the biggest cause is the one to fix. */
export function groupIssuesByReason(issues: FeedRunIssueDto[]): Group[] {
  const byReason = new Map<string, FeedRunIssueDto[]>();
  for (const issue of issues) {
    const list = byReason.get(issue.reason) ?? [];
    list.push(issue);
    byReason.set(issue.reason, list);
  }
  return [...byReason.entries()]
    .map(([reason, items]) => ({ reason, items }))
    .sort((a, b) => b.items.length - a.items.length || a.reason.localeCompare(b.reason));
}

export function RunIssueGroups(props: RunIssueGroupsProps): ReactNode {
  const t = useTranslation('product_feeds');
  const groups = groupIssuesByReason(props.issues.filter((i) => i.severity === props.severity));
  // The largest group is open; the rest are collapsed (Chunking).
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(groups[0] ? [groups[0].reason] : []),
  );

  if (groups.length === 0) return null;

  const toggle = (reason: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(reason)) next.delete(reason);
      else next.add(reason);
      return next;
    });
  };

  return (
    <ul className="b2b-minilist flex flex-col gap-1">
      {groups.map((group) => {
        const open = expanded.has(group.reason);
        const shown = group.items.slice(0, ITEMS_PER_GROUP);
        return (
          <li key={group.reason} className="rounded-md border border-border">
            <div className="flex flex-wrap items-center gap-2 p-2">
              <button
                type="button"
                className="flex flex-1 items-center gap-2 text-left text-sm"
                aria-expanded={open}
                onClick={(): void => toggle(group.reason)}
              >
                {open ? (
                  <ChevronDown size={14} aria-hidden="true" />
                ) : (
                  <ChevronRight size={14} aria-hidden="true" />
                )}
                {/* Icon AND word: severity is never carried by colour alone. */}
                <AlertTriangle size={14} aria-hidden="true" />
                <span className="font-medium">{t(`runs.reason.${group.reason}`)}</span>
                <span className="text-muted-foreground">
                  {t('runs.issues.group', { count: group.items.length })}
                </span>
              </button>
              {MAPPING_REASONS.has(group.reason) ? (
                <Button asChild type="button" variant="outline" size="sm">
                  <Link to="/product-feeds/category-mapping">
                    <MapPin size={14} aria-hidden="true" />
                    {t('runs.issues.fixMapping')}
                  </Link>
                </Button>
              ) : null}
            </div>
            {open ? (
              <ul className="flex flex-col gap-0.5 border-t border-border px-3 py-2 text-sm">
                {shown.map((issue) => (
                  <li key={issue.id} className="b2b-minirow flex flex-wrap gap-2">
                    {/* Deliberately not a link — see the component comment. */}
                    <code className="b2b-code">{issue.sku ?? '—'}</code>
                    {issue.outputName ? (
                      <span className="text-muted-foreground">{issue.outputName}</span>
                    ) : null}
                    {issue.detail ? (
                      <span className="text-muted-foreground">{issue.detail}</span>
                    ) : null}
                  </li>
                ))}
                {group.items.length > shown.length ? (
                  <li className="text-xs text-muted-foreground">
                    {t('runs.issues.showing', {
                      shown: shown.length,
                      total: group.items.length,
                    })}
                  </li>
                ) : null}
                {props.overflow ? (
                  <li className="text-xs text-muted-foreground">
                    {t('runs.issues.overflow', { cap: props.issueCapHint })}
                  </li>
                ) : null}
                {props.truncated ? (
                  <li className="text-xs text-muted-foreground">
                    {t('runs.issues.truncated', { limit: props.pageLimit ?? 0 })}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
