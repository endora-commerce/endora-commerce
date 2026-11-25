import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Archive } from 'lucide-react';
import type { OrganizationMergeView } from '@endora-commerce/contracts';
import { formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, AlertTitle } from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { organizationMergesApi } from './merge-api.js';

export interface MergedBannerProps {
  /** The organization this one was merged into. */
  readonly survivorId: string;
  readonly mergeId: string | null;
  readonly mergedAt: string | null;
}

/** Stands for the survivor's name inside the translated sentence, then replaced by its link. */
const MARK = '\u0000';

/**
 * The archived loser's banner (`specs/192-organization-merge/` FR-051, FR-052;
 * `contracts/organization-merge.md` §5): *Merged into {name} on {date} by
 * {actor}*, linking to the survivor and to the merge. The organization is
 * read-only from here on; the screen shows nothing that would write.
 *
 * The names come from the merge (`GET …/organization-merges/:mergeId`, under
 * `customers:read`, the code that opens this screen). When it cannot be read
 * the banner still leads to the survivor.
 */
export function MergedBanner(props: MergedBannerProps): ReactNode {
  const own = useTranslation('organizations');
  const { language } = useTranslationContext();
  const [merge, setMerge] = useState<OrganizationMergeView | null>(null);

  useEffect(() => {
    if (props.mergeId === null) return;
    let live = true;
    organizationMergesApi
      .get(props.mergeId)
      .then((m) => {
        if (live) setMerge(m);
      })
      .catch(() => {
        if (live) setMerge(null);
      });
    return (): void => {
      live = false;
    };
  }, [props.mergeId]);

  const when = props.mergedAt ?? merge?.completedAt ?? null;
  // One translated sentence with the survivor's name as a link inside it, wherever the
  // language puts it: the name is a marker in the template, split out and replaced.
  const sentence = own(merge?.actorName ? 'merge.banner.sentence' : 'merge.banner.sentenceNoActor', {
    survivor: MARK,
    date: when === null ? '' : formatDateTime(when, language),
    actor: merge?.actorName ?? '',
  });
  const [before, after = ''] = sentence.split(MARK);

  return (
    <Alert variant="warning" className="mb-4">
      <Archive aria-hidden="true" />
      <AlertTitle>{own('merge.banner.title')}</AlertTitle>
      <AlertDescription className="grid gap-1">
        <p>
          {before}
          <Link className="font-medium underline underline-offset-2" to={`/organizations/${props.survivorId}`}>
            {merge?.survivorName ?? own('merge.banner.survivorFallback')}
          </Link>
          {after}
        </p>
        <p>{own('merge.banner.readOnly')}</p>
        {props.mergeId !== null ? (
          <p>
            <Link className="underline underline-offset-2" to={`/organizations/merges/${props.mergeId}`}>
              {own('merge.banner.viewMerge')}
            </Link>
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
