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
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/** One row of `GET /api/v1/admin/example-erp-keys/keys` (`ports.ts` `ExampleErpKeyRow`). */
interface ErpKeyRow {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly erpKey: string;
}

const KEYS_API = '/api/v1/admin/example-erp-keys/keys';

/**
 * The kit's icon, by the name the sidebar entry and the palette action use: an
 * overlay admin layer resolves through the admin's own dependencies, so it
 * names no icon package of its own.
 */
const KeyIcon = resolveIcon('KeyRound');

/**
 * The ERP keys screen: every key the operator may see, and a lookup by key.
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
 * has text.
 */
export default function ExampleErpKeysPage(): ReactNode {
  const t = useTranslation('example_erp_keys');
  const searchRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [applied, setApplied] = useState('');
  const [rows, setRows] = useState<readonly ErpKeyRow[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (erpKey: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const query = erpKey === '' ? '' : `?erpKey=${encodeURIComponent(erpKey)}`;
        const res = await apiClient.get<{ data: ErpKeyRow[] }>(`${KEYS_API}${query}`);
        setRows(res.data);
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('admin.error'));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load(applied);
  }, [load, applied]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const next = draft.trim();
    if (next === applied) void load(next);
    else setApplied(next);
  };

  const clear = (): void => {
    setDraft('');
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
        </CardContent>
      </Card>
    </div>
  );
}
