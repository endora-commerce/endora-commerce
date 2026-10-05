import { useId, useState, type ReactNode } from 'react';
import type { OpportunityDetail } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';
import { AssigneeName } from './AssigneeName.js';
import { AssigneeLookup } from './LookupPickers.js';

export interface AssigneeSectionProps {
  opportunity: OpportunityDetail;
  canWrite: boolean;
  /** The Opportunity as the assignment endpoint answered it. */
  onChange: (next: OpportunityDetail) => void;
}

/**
 * Who holds the Opportunity, and — for a holder of `crm:write` — the control
 * that changes it (`contracts/admin-api.md` §5).
 *
 * **Choosing is assigning.** There is one field and no *Save*: picking a person
 * posts the assignment, clearing the field unassigns, and the answer is put on
 * screen. A refusal (`CRM_ASSIGNEE_INVALID` — somebody deactivated meanwhile)
 * is shown in the server's sentence and the field goes back to whoever holds
 * the Opportunity. Assigning notifies the new assignee; nothing here does.
 */
export function AssigneeSection(props: AssigneeSectionProps): ReactNode {
  const { opportunity, canWrite, onChange } = props;
  const t = useTranslation('crm');
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const assignee = opportunity.assignee;

  const assign = async (adminUserId: string | null): Promise<void> => {
    if (adminUserId === (assignee?.id ?? null)) return;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      onChange(await crmApi.assign(opportunity.id, adminUserId));
      setNotice(t(adminUserId === null ? 'assignment.cleared' : 'assignment.saved'));
    } catch (failure) {
      setError(errorMessage(failure, t('assignment.error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-sm font-semibold tracking-tight">
        {t('assignment.label')}
      </h2>
      <p className="text-sm">
        <AssigneeName assignee={assignee} />
      </p>
      {canWrite ? (
        <div className="max-w-sm space-y-1">
          <AssigneeLookup
            // Remounted when the assignee changes, so a refused choice is not left typed in.
            key={`${assignee?.id ?? 'none'}:${error ?? ''}`}
            ariaLabel={t('assignment.change')}
            value={assignee?.id ?? null}
            selectedLabel={assignee?.name ?? ''}
            disabled={busy}
            onChange={(adminUserId): void => void assign(adminUserId)}
            placeholder={t('assignment.picker.placeholder')}
            emptyMessage={t('assignment.picker.empty')}
          />
          <p className="text-xs text-muted-foreground">{t('assignment.changeHint')}</p>
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {/* Mounted before it has text, so the announcement is reliable. */}
      <p role="status" className="text-sm text-muted-foreground">
        {notice}
      </p>
    </section>
  );
}
