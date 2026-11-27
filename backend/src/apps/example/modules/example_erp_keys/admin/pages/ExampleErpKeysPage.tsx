import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient, resolveIcon } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { PaginationFooter, useCursorPagination } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/** One row of `GET /api/v1/admin/example-erp-keys/keys` (`ports.ts` `ExampleErpKeyRow`). */
interface ErpKeyRow {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly erpKey: string;
}

/** One page of that list: the repository's cursor envelope (`collectionEnvelope`). */
interface ErpKeyPage {
  readonly data: ErpKeyRow[];
  readonly pagination: { readonly cursor: string | null; readonly hasMore: boolean; readonly limit: number };
}

const KEYS_API = '/api/v1/admin/example-erp-keys/keys';

/** The largest page the endpoint answers (`ERP_KEY_LIST_LIMIT`). */
const KEYS_PAGE_MAX = 100;

/**
 * The kit's icon, by the name the sidebar entry and the palette action use: an
 * overlay admin layer resolves through the admin's own dependencies, so it
 * names no icon package of its own.
 */
const KeyIcon = resolveIcon('KeyRound');

/**
 * The ERP keys screen: every key the operator may see, a page at a time by
 * key, and a lookup by key.
 *
 * One primary action — *Find* — and nothing to edit: a key is set by the ERP
 * import that creates the Organization, so the screen is where an operator
 * answers "which Organization is ERP record X?". The lookup normalises what is
 * typed (case, surrounding spaces) on the server, as the import does.
 *
 * States (`.claude/skills/ux-laws/SKILL.md` §6): a skeleton on the first load
 * only — a later lookup keeps the table on screen and marks it `aria-busy`; an
 * error with a retry; *no keys yet* and *no Organization holds this key* as two
 * different empty states; and a result count in a live region mounted before it
 * has text. The list is cursor-paged, so the footer offers Previous / Next and
 * no total; a lookup goes back to the first page.
 */
export default function ExampleErpKeysPage(): ReactNode {
  const t = useTranslation('example_erp_keys');
  const searchRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [applied, setApplied] = useState('');
  const [rows, setRows] = useState<readonly ErpKeyRow[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pager = useCursorPagination({ scope: 'example-erp-keys', maxPageSize: KEYS_PAGE_MAX });
  const { cursor, limit } = pager.query;
  const { page: pageIndex, syncPage, resetPage } = pager;

  const load = useCallback(
    async (erpKey: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: String(limit) });
        if (erpKey !== '') params.set('erpKey', erpKey);
        if (cursor !== null) params.set('cursor', cursor);
        const res = await apiClient.get<ErpKeyPage>(`${KEYS_API}?${params.toString()}`);
        syncPage(res.pagination, res.data.length);
        // A later page that came back empty steps back one page, which is
        // asked next: keep the rows on screen rather than draw an empty page.
        if (res.data.length === 0 && pageIndex > 0) return;
        setRows(res.data);
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('admin.error'));
      } finally {
        setBusy(false);
      }
    },
    [t, cursor, limit, pageIndex, syncPage],
  );

  useEffect(() => {
    void load(applied);
  }, [load, applied]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const next = draft.trim();
    if (next === applied && pageIndex === 0) void load(next);
    else {
      resetPage();
      setApplied(next);
    }
  };

  const clear = (): void => {
    setDraft('');
    resetPage();
    setApplied('');
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.title')} description={t('admin.description')} />

      <form role="search" onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <FormField label={t('admin.lookup.label')} hint={t('admin.lookup.hint')}>
          <Input
            ref={searchRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
            className="w-64"
          />
        </FormField>
        <Button type="submit" disabled={busy}>
          {t('admin.lookup.submit')}
        </Button>
      </form>

      <p role="status" aria-live="polite" className="sr-only">
        {rows === null || busy ? '' : t('admin.results', { count: rows.length })}
      </p>

      {error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button type="button" variant="outline" onClick={() => void load(applied)}>
              {t('admin.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          {rows === null ? (
            error === null ? (
              <div className="space-y-3" aria-busy="true">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : null
          ) : rows.length === 0 ? (
            applied === '' ? (
              <EmptyState
                icon={<KeyIcon />}
                title={t('admin.empty.title')}
                description={t('admin.empty.description')}
              />
            ) : (
              <EmptyState
                variant="no-results"
                title={t('admin.noResults.title')}
                onClearFilters={clear}
                focusAfterClear={searchRef}
              />
            )
          ) : (
            <Table aria-busy={busy}>
              <TableCaption className="sr-only">{t('admin.tableCaption')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('admin.columns.erpKey')}</TableHead>
                  <TableHead scope="col">{t('admin.columns.organization')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.organizationId}>
                    <TableCell className="font-mono">{row.erpKey}</TableCell>
                    <TableCell>{row.organizationName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {rows === null || (rows.length === 0 && pageIndex === 0) ? null : (
            <PaginationFooter {...pager.footer(rows.length)} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
