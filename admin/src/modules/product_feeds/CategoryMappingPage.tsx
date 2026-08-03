import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TaxonomyProviderCode } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import type { ComboboxOption } from '@/components/ui/combobox';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppLanguage } from '@/i18n/app-language-context';
import {
  feedTaxonomiesClient,
  type CategoryMappingRowDto,
  type InstalledTaxonomy,
  type TaxonomyCoverage,
  type TaxonomyNodeOption,
} from './taxonomy-api';
import { CategoryMappingRow } from './components/CategoryMappingRow';

/**
 * Category → provider taxonomy mapping — ux-design §2.8, FR-079–FR-081, FR-085.
 *
 * **Two presentations, one row grammar.** Up to the tree ceiling the categories
 * are indented so containment shows inheritance at a glance; above it the same
 * rows are rendered flat and paged, with `inherited from X` carrying explicitly
 * what the indentation used to imply. Nothing is re-learned and no capability
 * is lost — and no virtualisation library is introduced for a screen that is
 * set up once and reviewed rarely.
 *
 * The screen has **no sidebar entry by design** (ux-design §1.1); the command
 * palette is its discovery path, which is exactly the case Principle XVI exists
 * for.
 *
 * The coverage strip is a `role="progressbar"` **and** the same numbers as
 * text: a proportion an operator cannot read off a bar is not information.
 */

/** Above this many categories the tree becomes a paged flat list (data-model §10). */
const TREE_CEILING = 1_000;

/** One page of the flat-list fallback. */
const FLAT_PAGE_SIZE = 100;

/** Node search debounce; the operator is typing, not the machine. */
const SEARCH_DEBOUNCE_MS = 300;

export function CategoryMappingPage(): ReactNode {
  const t = useTranslation('product_feeds');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('product_feeds:write');

  const [installed, setInstalled] = useState<InstalledTaxonomy[]>([]);
  const [providerCode, setProviderCode] = useState<TaxonomyProviderCode>('google_merchant');
  const [rows, setRows] = useState<CategoryMappingRowDto[] | null>(null);
  const [coverage, setCoverage] = useState<TaxonomyCoverage | null>(null);
  const [nodes, setNodes] = useState<TaxonomyNodeOption[]>([]);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<number | null>(null);

  useEffect(() => {
    void feedTaxonomiesClient.listInstalled().then((r) => {
      setInstalled(r.data);
      const first = r.data[0];
      if (first) setProviderCode(first.providerCode);
    });
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [mappings, cov, initialNodes] = await Promise.all([
        feedTaxonomiesClient.listMappings({ providerCode, lang: language, limit: 1000 }),
        feedTaxonomiesClient.coverage(providerCode),
        feedTaxonomiesClient.searchNodes({ providerCode, lang: language, limit: 50 }),
      ]);
      setRows(mappings.data);
      setCoverage(cov.data);
      setNodes(initialNodes.data);
      setError(null);
    } catch {
      setError(t('mapping.loadFailed'));
    }
  }, [providerCode, language, t]);

  useEffect(() => {
    if (installed.length === 0) return;
    void load();
  }, [installed.length, load]);

  const searchNodes = useCallback(
    (query: string): void => {
      if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
      searchTimer.current = window.setTimeout(() => {
        void feedTaxonomiesClient
          .searchNodes({
            providerCode,
            lang: language,
            ...(query ? { q: query } : {}),
            limit: 50,
          })
          .then((r) => setNodes(r.data));
      }, SEARCH_DEBOUNCE_MS);
    },
    [providerCode, language],
  );

  const setMapping = async (
    categoryId: string,
    nodeExternalId: string | null,
  ): Promise<void> => {
    try {
      const saved = await feedTaxonomiesClient.setMapping({
        providerCode,
        categoryId,
        nodeExternalId,
      });
      // The server answers with the EFFECTIVE row, so clearing an override
      // immediately shows the inherited value rather than an empty cell.
      setRows((current) =>
        (current ?? []).map((row) =>
          row.categoryId === categoryId ? { ...row, ...saved.data } : row,
        ),
      );
      // Descendants may have changed too; refresh the coverage numbers and the
      // rows rather than guessing at the propagation client-side.
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const nodeOptions: ComboboxOption<string>[] = useMemo(
    () => nodes.map((node) => ({ value: node.externalId, label: node.fullPath })),
    [nodes],
  );

  const filtered = useMemo(() => {
    const all = rows ?? [];
    const needle = filter.trim().toLowerCase();
    if (needle === '') return all;
    return all.filter((row) => row.categoryName.toLowerCase().includes(needle));
  }, [rows, filter]);

  const useFlatList = (rows?.length ?? 0) > TREE_CEILING;
  const visible = useFlatList
    ? filtered.slice(page * FLAT_PAGE_SIZE, (page + 1) * FLAT_PAGE_SIZE)
    : filtered;

  if (installed.length === 0) {
    return (
      <div>
        <PageHeader title={t('mapping.title')} description={t('mapping.subtitle')} />
        <Alert>
          <AlertDescription>{t('mapping.noTaxonomy')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const covered = coverage
    ? coverage.explicitlyMapped + coverage.coveredByInheritance
    : 0;
  const percent =
    coverage && coverage.totalCategories > 0
      ? Math.round((covered / coverage.totalCategories) * 100)
      : 0;

  return (
    <div>
      <PageHeader
        title={t('mapping.title')}
        description={t('mapping.subtitle')}
        back={{ label: t('page.title'), to: '/product-feeds' }}
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mapping-provider">{t('mapping.provider')}</Label>
              <select
                id="mapping-provider"
                className="b2b-select"
                value={providerCode}
                onChange={(e) => {
                  setProviderCode(e.target.value as TaxonomyProviderCode);
                  setPage(0);
                }}
              >
                {installed.map((taxonomy) => (
                  <option key={taxonomy.providerCode} value={taxonomy.providerCode}>
                    {taxonomy.providerCode} — {taxonomy.revision}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="mapping-filter">{t('mapping.filter')}</Label>
              <Input
                id="mapping-filter"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(0);
                }}
              />
            </div>
          </div>

          {coverage && (
            <div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={coverage.totalCategories}
                aria-valuenow={covered}
                aria-label={t('mapping.coverage.label')}
                className="h-2 w-full overflow-hidden rounded bg-muted"
              >
                <div className="h-full bg-emerald-500" style={{ width: `${percent}%` }} />
              </div>
              {/* The same information as text — a bar alone is not readable. */}
              <p className="mt-1.5 text-sm text-muted-foreground">
                {t('mapping.coverage.explicit')}: {coverage.explicitlyMapped} ·{' '}
                {t('mapping.coverage.inherited')}: {coverage.coveredByInheritance} ·{' '}
                {t('mapping.coverage.uncovered')}: {coverage.uncovered} ·{' '}
                {t('mapping.coverage.total')}: {coverage.totalCategories}
                {coverage.staleMappings > 0 && (
                  <>
                    {' · '}
                    <span className="text-amber-600">
                      {t('mapping.coverage.stale')}: {coverage.staleMappings}
                    </span>
                  </>
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {rows === null ? (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground" aria-busy="true">
          {t('mapping.title')}…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {filter.trim() === ''
              ? t('mapping.empty.categories')
              : t('mapping.empty.filtered')}
          </p>
        </div>
      ) : (
        <>
          {useFlatList && (
            <p className="mb-2 text-xs text-muted-foreground">{t('mapping.flatListNotice')}</p>
          )}
          <ul className="rounded-lg border px-3">
            {visible.map((row) => (
              <CategoryMappingRow
                key={row.categoryId}
                row={row}
                // Flat list: no indentation, `inherited from X` carries it.
                indent={useFlatList || filter.trim() !== '' ? 0 : row.categoryDepth}
                canWrite={canWrite}
                options={nodeOptions}
                onSearch={searchNodes}
                onChange={(next) => setMapping(row.categoryId, next)}
                onUndo={(previous) => setMapping(row.categoryId, previous)}
              />
            ))}
          </ul>

          {useFlatList && (
            <div className="mt-3 flex items-center justify-between">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {t('mapping.page.previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {page * FLAT_PAGE_SIZE + 1}–
                {Math.min((page + 1) * FLAT_PAGE_SIZE, filtered.length)} / {filtered.length}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * FLAT_PAGE_SIZE >= filtered.length}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('mapping.page.next')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
