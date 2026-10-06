import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AdminZoneProps, OpportunitySummary } from '@endora-commerce/contracts';
import { statusBadgeStyle, useAuth } from '@endora-commerce/admin-kit/lib';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { moneyLabel } from '../lib/labels.js';

/**
 * CRM's panel on the Organization screen — the contribution to
 * `organization.detail.after`
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §5).
 *
 * The Organization's **open** Opportunities, newest first, each with its
 * status and value and a link to its screen, and a "New opportunity" link that
 * carries the Organization to the create form.
 *
 * The zone renderer has already decided that `crm` is present and that the
 * person holds `crm:read` before this chunk is fetched, so nothing here asks
 * either question again. `crm:write` is asked, because the create form is
 * gated on it and a link to a refused screen is a dead end.
 */
const PAGE = 10;

type State =
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'ready'; rows: OpportunitySummary[]; hasMore: boolean };

export type OrganizationOpportunitiesProps = AdminZoneProps<'organization.detail.after'>;

export function OrganizationOpportunities({ organizationId }: OrganizationOpportunitiesProps): ReactNode {
  const t = useTranslation('crm');
  const { hasPermission } = useAuth();
  const headingId = useId();
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ phase: 'loading' });
    crmApi
      .listOpportunities({ organizationId, state: 'open', limit: PAGE })
      .then((page) => {
        if (alive) setState({ phase: 'ready', rows: page.data, hasMore: page.pagination.hasMore });
      })
      .catch(() => {
        if (alive) setState({ phase: 'failed' });
      });
    return (): void => {
      alive = false;
    };
  }, [organizationId]);

  return (
    <section aria-labelledby={headingId}>
      <Card className="mb-4">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>
              <h2 id={headingId} className="text-base font-semibold">
                {t('organizationPanel.title')}
              </h2>
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t('organizationPanel.description')}</p>
          </div>
          {hasPermission('crm:write') ? (
            <Link
              to={`/crm/opportunities/new?organizationId=${organizationId}`}
              className="inline-flex min-h-11 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent sm:min-h-9"
            >
              {t('organizationPanel.new')}
            </Link>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {state.phase === 'loading' ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('organizationPanel.loading')}
            </p>
          ) : null}
          {state.phase === 'failed' ? (
            <p role="alert" className="text-sm text-destructive">
              {t('organizationPanel.error')}
            </p>
          ) : null}
          {state.phase === 'ready' && state.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('organizationPanel.empty')}</p>
          ) : null}
          {state.phase === 'ready' && state.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('organizationPanel.column.opportunity')}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('organizationPanel.column.status')}
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      {t('organizationPanel.column.value')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="py-2 pr-4">
                        <Link
                          to={`/crm/opportunities/${row.id}`}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {row.number}
                        </Link>{' '}
                        <span>{row.title}</span>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge className="font-medium" style={statusBadgeStyle(row.status.color)}>
                          {row.status.name}
                        </Badge>
                      </td>
                      <td className="py-2 text-right tabular-nums">{moneyLabel(row.value, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {state.phase === 'ready' && state.hasMore ? (
            <p className="text-sm text-muted-foreground">
              {t('organizationPanel.more', { count: state.rows.length })}{' '}
              <Link to="/crm/opportunities" className="text-primary underline underline-offset-4">
                {t('organizationPanel.all')}
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default OrganizationOpportunities;
