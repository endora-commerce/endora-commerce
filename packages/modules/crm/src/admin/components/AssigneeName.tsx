import type { ReactNode } from 'react';
import type { OpportunitySummary } from '@endora-commerce/contracts';
import { Badge } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Who holds an Opportunity, as every CRM screen says it: the name, a marker
 * when that administrator has since been deactivated — the Opportunity is
 * still theirs until somebody reassigns it, and nobody is working it — or
 * "Unassigned".
 */
export function AssigneeName(props: { assignee: OpportunitySummary['assignee'] }): ReactNode {
  const t = useTranslation('crm');
  const { assignee } = props;
  if (!assignee) return <span className="text-muted-foreground">{t('assignment.unassigned')}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>{assignee.name}</span>
      {assignee.active ? null : (
        <Badge variant="outline" className="font-normal text-muted-foreground">
          {t('assignment.inactive')}
        </Badge>
      )}
    </span>
  );
}
