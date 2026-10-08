import { useId, useState, type ReactNode } from 'react';
import type { OpportunityDetail } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';
import { TagChips, TagMultiSelect } from './TagPicker.js';

export interface TagsSectionProps {
  opportunity: OpportunityDetail;
  canWrite: boolean;
  /** The Opportunity as the tagging endpoint answered it. */
  onChange: (next: OpportunityDetail) => void;
}

/**
 * The tags of an Opportunity, and — for a holder of `crm:write` — the control
 * that changes them (`contracts/admin-api.md` §8).
 *
 * Tagging is everyday work, so it is one gesture: ticking or unticking a tag
 * replaces the set (`PUT …/tags`) and the answer is put on screen. Which tags
 * *exist* is configuration and lives on the Tags screen.
 *
 * It is one labelled fact of the screen's sidebar: a group under an `h3`, not a
 * landmark of its own. A long tag list wraps.
 */
export function TagsSection(props: TagsSectionProps): ReactNode {
  const { opportunity, canWrite, onChange } = props;
  const t = useTranslation('crm');
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const replace = async (tagIds: string[]): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      onChange(await crmApi.setOpportunityTags(opportunity.id, tagIds));
      setNotice(t('tags.saved'));
    } catch (failure) {
      setError(errorMessage(failure, t('tags.error.save')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="group" aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-xs font-normal text-muted-foreground">
        {t('tags.section')}
      </h3>
      {opportunity.tags.length > 0 ? (
        <TagChips tags={opportunity.tags} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('tags.none')}</p>
      )}
      {canWrite ? (
        <div className="max-w-sm">
          <TagMultiSelect
            ariaLabel={t('tags.change')}
            selected={opportunity.tags.map((tag) => tag.id)}
            disabled={busy}
            onChange={(tagIds): void => void replace(tagIds)}
          />
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {/* Mounted before it has text, so the announcement is reliable. */}
      <p role="status" className="text-xs text-muted-foreground empty:sr-only">
        {notice}
      </p>
    </div>
  );
}
