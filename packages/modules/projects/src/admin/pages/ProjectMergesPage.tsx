import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GitMerge } from 'lucide-react';
import { RECORD_MERGE_STATES, type ProjectMergeView, type RecordMergeState } from '@endora-commerce/contracts';
import { ApiError, formatDateTime, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { ListPage, ResponsiveTable } from '@endora-commerce/admin-kit/components';
import {
  Button,
  EmptyState,
  InlineStatus,
  Label,
  Select,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { projectMergesApi } from '../merge/merge-api.js';
import { MergeStateBadge } from '../merge/MergeStateBadge.js';
import { refusalMessage, type Translate } from '../merge/merge-view.js';

type StateFilter = RecordMergeState | 'all';

/** `?state=` — *needs attention* unless it names another state or `all`. */
function stateFilterOf(value: string | null): StateFilter {
  if (value === 'all') return 'all';
  return RECORD_MERGE_STATES.find((s) => s === value) ?? 'needs_attention';
}

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; rows: ProjectMergeView[] };

/**
 * Project merges (`specs/192-organization-merge/` US6, FR-081;
 * `contracts/project-merge.md` §4) at `/projects/merges` — by default the
 * merges that **need attention**, each with **Resume** beside it; the filter
 * shows the running, completed and cancelled ones too. Only merges both of
 * whose Projects the operator sees are listed (the API filters). Gated on
 * `projects:merge`, as its API is.
 */
export function ProjectMergesPage(): ReactNode {
  const own = useTranslation('projects');
  const { t, language } = useTranslationContext();
  const translate: Translate = t;
  const filterId = useId();
  const isVisible = useSurfaceVisibility();
  const canMerge = isVisible({ module: 'projects', requiredPermission: 'projects:merge' });
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = stateFilterOf(searchParams.get('state'));
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [resuming, setResuming] = useState<string | null>(null);
  const status = useInlineStatus();

  const read = useCallback(async (): Promise<void> => {
    try {
      const rows = await projectMergesApi.list(filter === 'all' ? {} : { state: filter });
      setLoad({ kind: 'ready', rows });
    } catch (err) {
      setLoad({ kind: 'error', message: err instanceof ApiError ? err.envelope.error.message : own('merge.list.loadError') });
    }
  }, [filter, own]);

  useEffect(() => {
    setLoad({ kind: 'loading' });
    void read();
  }, [read]);

  const resume = async (merge: ProjectMergeView): Promise<void> => {
    setResuming(merge.id);
    try {
      await projectMergesApi.resume(merge.id, merge.version);
      status.show(own('merge.action.resumed'));
    } catch (err) {
      status.show(err instanceof ApiError ? err.envelope.error.message : own('merge.action.failed'), 'error');
    } finally {
      setResuming(null);
      await read();
    }
  };

  const name = (merge: ProjectMergeView): string =>
    own('merge.list.pair', { loser: merge.loserName ?? merge.loserId, survivor: merge.survivorName ?? merge.survivorId });

  return (
    <>
      <ListPage
        title={own('merge.list.title')}
        toolbar={
          <>
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
          </>
        }
        load={load.kind === 'error' ? { kind: 'error', message: load.message } : { kind: load.kind }}
        onRetry={(): void => void read()}
      >
        <ResponsiveTable
          label={own('merge.list.title')}
          data={load.kind === 'ready' ? load.rows : []}
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
                <Link className="underline underline-offset-2" to={`/projects/merges/${row.id}`}>
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
      </ListPage>
    </>
  );
}

/** The registry reads a route component's default export (feature 091, FR-013). */
export default ProjectMergesPage;
