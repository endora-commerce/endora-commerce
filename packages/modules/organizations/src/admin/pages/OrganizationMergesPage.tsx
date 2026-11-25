import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GitMerge } from 'lucide-react';
import { RECORD_MERGE_STATES, type OrganizationMergeView, type RecordMergeState } from '@endora-commerce/contracts';
import { ApiError, formatDateTime, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { ResponsiveTable } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  EmptyState,
  InlineStatus,
  Label,
  PageHeader,
  Select,
  Skeleton,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { organizationMergesApi } from '../merge/merge-api.js';
import { MergeStateBadge } from '../merge/MergeStateBadge.js';
import { refusalMessage, type Translate } from '../merge/merge-view.js';

type StateFilter = RecordMergeState | 'all';

/** `?state=` — *needs attention* unless it names another state or `all`. */
function stateFilterOf(value: string | null): StateFilter {
  if (value === 'all') return 'all';
  return RECORD_MERGE_STATES.find((s) => s === value) ?? 'needs_attention';
}

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; rows: OrganizationMergeView[] };

/**
 * Organization merges (`specs/192-organization-merge/` FR-081;
 * `contracts/organization-merge.md` §5) at `/organizations/merges` — by default
 * the merges that **need attention**, each with **Resume** beside it; the
 * filter shows the running, completed and cancelled ones too. Only merges both
 * of whose organizations the operator reaches are listed (the API filters).
 * Gated on `organizations:merge`, as its API is.
 */
export function OrganizationMergesPage(): ReactNode {
  const own = useTranslation('organizations');
  const core = useTranslation('core');
  const { t, language } = useTranslationContext();
  const translate: Translate = t;
  const filterId = useId();
  const isVisible = useSurfaceVisibility();
  const canMerge = isVisible({ module: 'organizations', requiredPermission: 'organizations:merge' });
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = stateFilterOf(searchParams.get('state'));
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [resuming, setResuming] = useState<string | null>(null);
  const status = useInlineStatus();

  const read = useCallback(async (): Promise<void> => {
    try {
      const rows = await organizationMergesApi.list(filter === 'all' ? {} : { state: filter });
      setLoad({ kind: 'ready', rows });
    } catch (err) {
      setLoad({ kind: 'error', message: err instanceof ApiError ? err.envelope.error.message : own('merge.list.loadError') });
    }
  }, [filter, own]);

  useEffect(() => {
    setLoad({ kind: 'loading' });
    void read();
  }, [read]);

  const resume = async (merge: OrganizationMergeView): Promise<void> => {
    setResuming(merge.id);
    try {
      await organizationMergesApi.resume(merge.id, merge.version);
      status.show(own('merge.action.resumed'));
    } catch (err) {
      status.show(err instanceof ApiError ? err.envelope.error.message : own('merge.action.failed'), 'error');
    } finally {
      setResuming(null);
      await read();
    }
  };

  const name = (merge: OrganizationMergeView): string =>
    own('merge.list.pair', { loser: merge.loserName ?? merge.loserId, survivor: merge.survivorName ?? merge.survivorId });

  return (
    <>
      <PageHeader back={{ label: core('organizations.page.title'), to: '/organizations' }} title={own('merge.list.title')} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={filterId}>{own('merge.list.filter')}</Label>
          <Select
            id={filterId}
            className="w-56"
            value={filter}
            onChange={(e): void =>
              setSearchParams(
                (params) => {
                  const next = new URLSearchParams(params);
                  next.set('state', e.target.value);
                  return next;
                },
                { replace: true },
              )
            }
          >
            {(['needs_attention', 'running', 'completed', 'cancelled', 'all'] as const).map((value) => (
              <option key={value} value={value}>
                {own(value === 'all' ? 'merge.list.filterAll' : `merge.state.${value}`)}
              </option>
            ))}
          </Select>
        </div>
        <InlineStatus {...status.props} className="max-w-sm" />
      </div>
      <Card>
        <CardContent>
          {load.kind === 'loading' ? (
            <div className="grid gap-2" aria-label={own('merge.list.loading')}>
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : null}
          {load.kind === 'error' ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                {load.message}
                <Button variant="outline" size="sm" onClick={(): void => void read()}>
                  {core('common.action.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {load.kind === 'ready' ? (
            <ResponsiveTable
              label={own('merge.list.title')}
              data={load.rows}
              keyExtractor={(row): string => row.id}
              emptyState={
                <EmptyState
                  icon={<GitMerge />}
                  title={own(filter === 'needs_attention' ? 'merge.list.empty.title' : 'merge.list.emptyOther.title')}
                  description={own('merge.list.empty.description')}
                />
              }
              columns={[
                {
                  id: 'pair',
                  header: own('merge.list.column.merge'),
                  primary: true,
                  render: (row): ReactNode => (
                    <Link className="underline underline-offset-2" to={`/organizations/merges/${row.id}`}>
                      {name(row)}
                    </Link>
                  ),
                },
                { id: 'state', header: own('merge.list.column.state'), render: (row): ReactNode => <MergeStateBadge state={row.state} /> },
                {
                  id: 'started',
                  header: own('merge.list.column.started'),
                  hideOnMobile: true,
                  render: (row): ReactNode => (
                    <span>
                      <time dateTime={row.startedAt}>{formatDateTime(row.startedAt, language)}</time>
                      {row.actorName ? <span className="text-muted-foreground"> · {row.actorName}</span> : null}
                    </span>
                  ),
                },
                {
                  id: 'error',
                  header: own('merge.list.column.problem'),
                  hideOnMobile: true,
                  render: (row): ReactNode =>
                    row.lastErrorCode === null ? null : (
                      <span className="text-sm">{refusalMessage(translate, { code: row.lastErrorCode })}</span>
                    ),
                },
              ]}
              renderActions={(row): ReactNode =>
                canMerge && row.state === 'needs_attention' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={resuming !== null}
                    aria-busy={resuming === row.id ? true : undefined}
                    aria-label={own('merge.list.resumeRow', { merge: name(row) })}
                    onClick={(): void => void resume(row)}
                  >
                    {own('merge.action.resume')}
                  </Button>
                ) : null
              }
            />
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

/** The registry reads a route component's default export (feature 091, FR-013). */
export default OrganizationMergesPage;
