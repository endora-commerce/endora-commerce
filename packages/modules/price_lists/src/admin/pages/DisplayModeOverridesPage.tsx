import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Filter, Save, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import type { DisplayMode } from '@endora-commerce/contracts';
import { ApiError, apiClient, normalize, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ListToolbar, ListToolbarSearch } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  FormField,
  PageHeader,
  Select,
  TabPanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
} from '@endora-commerce/admin-kit/ui';
import { cn } from '@endora-commerce/admin-kit/lib';
import { useLocalizedName } from '../lib/localized-name.js';
import { PrecedenceView } from '../components/PrecedenceView.js';
import { ShowListPriceSwitch } from '../components/ShowListPriceSwitch.js';
type Scope = 'organization' | 'category' | 'product';
const SCOPES: readonly Scope[] = ['organization', 'category', 'product'];

interface DisplayModeOverrideRow {
  scope: Scope;
  targetId: string;
  mode: DisplayMode;
  updatedAt: string;
}

interface OrganizationRow {
  id: string;
  name: string;
  /** `null` for a personal Organization, whose tax id is a placeholder (#767). */
  taxId: string | null;
}
/** A category as `…/price-books/targets/categories` answers it: `name` by language tag. */
interface CategoryRow {
  id: string;
  slug: string;
  name: Record<string, string>;
}
/**
 * A product as `/api/v1/admin/catalog/products` answers it: the Global `name`, one string
 * (feature 174, FR-031 — an admin list has no channel).
 */
interface ProductRow {
  id: string;
  sku: string;
  name: string;
}

/**
 * *Pricing settings* (feature 161 renamed the page from "Price display
 * modes"): display-mode defaults and overrides (US7 / T087 + T088 of the
 * pricing feature that introduced them), the list-price switch (feature 161,
 * FR-026) and the precedence in force, read-only (FR-025).
 *
 * Single admin landing page with:
 *   - The two `pricing.*` settings keys at the top, edited inline.
 *   - A scope tab strip and a table per scope of every override on
 *     the platform; rows can be edited (mode dropdown) or removed
 *     (revert to "inherit" via PUT { mode: 'inherit' }).
 *   - An "Add override" button that picks an organization / category
 *     / product (depending on the active scope) and lets the operator
 *     set the initial mode.
 *
 * The settings keys come from the existing settings module
 * (`/api/v1/admin/settings/<code>`); the override endpoints live under
 * `/api/v1/admin/pricing/display-mode-overrides`.
 */
export function DisplayModeOverridesPage(): ReactNode {
  const t = useTranslation('core');
  const tl = useTranslation('price_lists');
  // FR-028 (feature 161, Checkpoint 10 ruling): a reader sees every value and
  // no control that would change one — absent, not refused by the server.
  const mayWrite = useAuth().hasPermission('price_lists:write');
  const MODE_LABEL: Record<DisplayMode, string> = {
    gross_only: t('priceLists.displayMode.grossOnly'),
    net_only: t('priceLists.displayMode.netOnly'),
    both: t('priceLists.displayMode.both'),
    none: t('priceLists.displayMode.none'),
  };
  const SCOPE_LABEL: Record<Scope, string> = {
    organization: t('priceLists.displayModes.scope.organization'),
    category: t('priceLists.displayModes.scope.category'),
    product: t('priceLists.displayModes.scope.product'),
  };
  const [scope, setScope] = useState<Scope>('organization');
  const [overrides, setOverrides] = useState<DisplayModeOverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [orgs, setOrgs] = useState<Record<string, OrganizationRow>>({});
  const [cats, setCats] = useState<Record<string, CategoryRow>>({});
  const [products, setProducts] = useState<Record<string, ProductRow>>({});
  const localizedName = useLocalizedName();

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: { items: DisplayModeOverrideRow[] } }>(
        `/api/v1/admin/pricing/display-mode-overrides?scope=${scope}`,
      );
      setOverrides(res.data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.displayModes.error.load'));
    } finally {
      setLoading(false);
    }
  }, [scope, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Eagerly load name dictionaries the first time the page is opened so the
  // table can render labels instead of bare UUIDs. Each lookup endpoint is
  // already paginated/bounded — these are admin-side dictionaries.
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [orgsRes, catsRes, prodRes] = await Promise.all([
          apiClient.get<{ data: { items: OrganizationRow[] } }>(
            '/api/v1/admin/price-books/targets/organizations?limit=200',
          ),
          apiClient.get<{ data: { items: CategoryRow[] } }>(
            '/api/v1/admin/price-books/targets/categories',
          ),
          apiClient.get<{ data: ProductRow[] }>('/api/v1/admin/catalog/products'),
        ]);
        setOrgs(Object.fromEntries(orgsRes.data.items.map((o) => [o.id, o])));
        setCats(Object.fromEntries(catsRes.data.items.map((c) => [c.id, c])));
        setProducts(Object.fromEntries(prodRes.data.map((p) => [p.id, p])));
      } catch {
        // dictionaries are decorative — table still renders raw IDs on failure
      }
    })();
  }, []);

  const labelFor = (row: DisplayModeOverrideRow): string => {
    if (row.scope === 'organization') return orgs[row.targetId]?.name ?? row.targetId;
    if (row.scope === 'category') {
      const cat = cats[row.targetId];
      return cat ? localizedName(cat.name, cat.slug) : row.targetId;
    }
    const product = products[row.targetId];
    return product ? product.name || product.sku : row.targetId;
  };

  const subtitleFor = (row: DisplayModeOverrideRow): string => {
    if (row.scope === 'organization') return orgs[row.targetId]?.taxId ?? '';
    if (row.scope === 'category') return cats[row.targetId]?.slug ?? '';
    return products[row.targetId]?.sku ?? '';
  };

  const filtered = useMemo(() => {
    const q = normalize(search);
    if (q === '') return overrides;
    return overrides.filter((row) => {
      const label = normalize(labelFor(row));
      const subtitle = normalize(subtitleFor(row));
      return label.includes(q) || subtitle.includes(q) || normalize(row.targetId).includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, search, orgs, cats, products, localizedName]);

  const handleUpsert = async (
    targetId: string,
    mode: DisplayMode | 'inherit',
  ): Promise<void> => {
    setError(null);
    try {
      await apiClient.put(
        `/api/v1/admin/pricing/display-mode-overrides/${scope}/${encodeURIComponent(targetId)}`,
        { mode },
      );
      setInfo(mode === 'inherit' ? t('priceLists.displayModes.info.removed') : t('priceLists.displayModes.info.saved'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.displayModes.error.save'));
    }
  };

  const scopeName = SCOPE_LABEL[scope].toLowerCase();

  return (
    <div className="b2b-page b2b-page--wide">
      {/* Feature 161 (FR-025): the page is *Pricing settings*. */}
      <PageHeader title={t('priceLists.displayModes.title')} help={t('priceLists.displayModes.help')} />

      {/* Issue #1492 (CAT-17): results are kit Alerts, not cards painted green or red. The
          status region is mounted before it has text, so a saved override is announced
          (WCAG 4.1.3); an error is an alert, which interrupts. */}
      <div role="status" className="empty:hidden">
        {info ? (
          <Banner kind="info" message={info} onDismiss={(): void => setInfo(null)} />
        ) : null}
      </div>
      {error ? (
        <Banner kind="error" message={error} onDismiss={(): void => setError(null)} />
      ) : null}

      <div className="space-y-4">
        <PricingSettingsCard onError={setError} onInfo={setInfo} />

        {/* Feature 161 (FR-026): "list price / your price" on the storefront. */}
        <ShowListPriceSwitch />

        <Card className="overflow-hidden">
          {/* The scope switch is the kit's tabs (#1492): it says which scope is selected, where
              three hand-coloured buttons said it only in colour. */}
          <div className="border-b border-border px-3 pt-1">
            <Tabs
              items={SCOPES.map((s) => ({ value: s, label: SCOPE_LABEL[s] }))}
              value={scope}
              onValueChange={setScope}
              idBase="display-mode-scope"
              aria-label={tl('settings.displayModes.scopeTabs')}
            />
          </div>
          <TabPanel idBase="display-mode-scope" value={scope}>
            <ListToolbar
              label={tl('settings.displayModes.toolbar')}
              className="border-b border-border px-3 py-2.5"
              search={
                <ListToolbarSearch
                  label={t('priceLists.displayModes.searchPlaceholder', { scope: scopeName })}
                  placeholder={t('priceLists.displayModes.searchPlaceholder', { scope: scopeName })}
                  value={search}
                  onValueChange={setSearch}
                />
              }
              actions={
                mayWrite ? (
                  <Button type="button" size="sm" onClick={(): void => setPicker(true)}>
                    <Filter aria-hidden="true" /> {t('priceLists.displayModes.addOverride')}
                  </Button>
                ) : null
              }
            />

            {loading ? (
              <p role="status" className="p-8 text-sm text-muted-foreground">
                {t('priceLists.loading')}
              </p>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Eye size={20} />}
                title={
                  search.trim()
                    ? t('priceLists.displayModes.empty.filtered', { scope: scopeName })
                    : t('priceLists.displayModes.empty.none', { scope: scopeName })
                }
                description={t('priceLists.displayModes.empty.subtitle')}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{SCOPE_LABEL[scope]}</TableHead>
                    <TableHead>{t('priceLists.displayModes.column.mode')}</TableHead>
                    <TableHead>{t('priceLists.displayModes.column.updated')}</TableHead>
                    {mayWrite ? (
                      <TableHead className="w-[1%]">
                        <span className="sr-only">{tl('settings.displayModes.actions')}</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.targetId}>
                      <TableCell>
                        <div className="font-medium">{labelFor(row)}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {subtitleFor(row) || row.targetId.slice(0, 8)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {mayWrite ? (
                          <Select
                            className="w-auto"
                            aria-label={tl('settings.displayModes.modeFor', { name: labelFor(row) })}
                            value={row.mode}
                            onChange={(e): void => {
                              void handleUpsert(row.targetId, e.target.value as DisplayMode);
                            }}
                          >
                            {(Object.keys(MODE_LABEL) as DisplayMode[]).map((m) => (
                              <option key={m} value={m}>
                                {MODE_LABEL[m]}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          MODE_LABEL[row.mode]
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.updatedAt).toLocaleString()}
                      </TableCell>
                      {mayWrite ? (
                        <TableCell className="whitespace-nowrap">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            aria-label={tl('settings.displayModes.removeFor', { name: labelFor(row) })}
                            onClick={(): void => {
                              void handleUpsert(row.targetId, 'inherit');
                            }}
                          >
                            <Trash2 aria-hidden="true" /> {t('priceLists.displayModes.remove')}
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabPanel>
        </Card>

        {/* Feature 161 (FR-025): the precedence in force, read-only. */}
        <PrecedenceView />
      </div>

      {picker ? (
        <AddOverrideDialog
          scope={scope}
          existing={new Set(overrides.map((o) => o.targetId))}
          orgs={orgs}
          cats={cats}
          products={products}
          onClose={(): void => setPicker(false)}
          onPick={(targetId, mode): void => {
            setPicker(false);
            void handleUpsert(targetId, mode);
          }}
        />
      ) : null}
    </div>
  );
}

function PricingSettingsCard({
  onError,
  onInfo,
}: {
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}): ReactNode {
  const t = useTranslation('core');
  const mayWrite = useAuth().hasPermission('price_lists:write');
  const MODE_LABEL: Record<DisplayMode, string> = {
    gross_only: t('priceLists.displayMode.grossOnly'),
    net_only: t('priceLists.displayMode.netOnly'),
    both: t('priceLists.displayMode.both'),
    none: t('priceLists.displayMode.none'),
  };
  const [defaultMode, setDefaultMode] = useState<DisplayMode>('gross_only');
  const [unauthMode, setUnauthMode] = useState<DisplayMode>('gross_only');
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [a, b] = await Promise.all([
          apiClient.get<{ defaultValue: DisplayMode }>(
            '/api/v1/admin/settings/pricing.default_display_mode',
          ),
          apiClient.get<{ defaultValue: DisplayMode }>(
            '/api/v1/admin/settings/pricing.unauthenticated_display_mode',
          ),
        ]);
        if (a.defaultValue) setDefaultMode(a.defaultValue);
        if (b.defaultValue) setUnauthMode(b.defaultValue);
      } catch {
        // ignore — leave defaults; the operator can still write
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async (key: string, value: DisplayMode): Promise<void> => {
    setSavingKey(key);
    try {
      await apiClient.put(`/api/v1/admin/settings/${encodeURIComponent(key)}/value`, {
        scope: 'all',
        value,
      });
      onInfo(t('priceLists.displayModes.settings.info.saved'));
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.displayModes.error.save'));
    } finally {
      setSavingKey(null);
    }
  };

  const fields = [
    { key: 'pricing.default_display_mode', id: 'pl-default-display', label: t('priceLists.displayModes.settings.defaultLabel'), value: defaultMode, set: setDefaultMode },
    { key: 'pricing.unauthenticated_display_mode', id: 'pl-unauth-display', label: t('priceLists.displayModes.settings.unauthLabel'), value: unauthMode, set: setUnauthMode },
  ] as const;

  return (
    <section aria-labelledby="pl-default-modes-title">
      <Card>
        <CardHeader>
          <CardTitle id="pl-default-modes-title" className="flex items-center gap-2">
            <SettingsIcon className="size-3.5" aria-hidden="true" />
            {t('priceLists.displayModes.settings.title')}
          </CardTitle>
          <CardDescription>{t('priceLists.displayModes.settings.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('priceLists.loading')}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((field) =>
                // FR-028 (Checkpoint 10 ruling): a reader sees the value, no select.
                mayWrite ? (
                  <FormField key={field.key} label={field.label} id={field.id}>
                    <Select
                      value={field.value}
                      onChange={(e): void => {
                        const v = e.target.value as DisplayMode;
                        field.set(v);
                        void save(field.key, v);
                      }}
                      disabled={savingKey === field.key}
                      aria-busy={savingKey === field.key || undefined}
                    >
                      {(Object.keys(MODE_LABEL) as DisplayMode[]).map((m) => (
                        <option key={m} value={m}>
                          {MODE_LABEL[m]}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                ) : (
                  <div key={field.key} className="space-y-1.5">
                    <div className="text-sm font-medium leading-none">{field.label}</div>
                    <div className="text-sm">{MODE_LABEL[field.value]}</div>
                  </div>
                ),
              )}
            </div>
          )}
          {/* Issue #492 — the owner's ruling of 2026-10-28: the chain is unchanged,
              so a product or category override beats the unauthenticated mode for
              anonymous visitors too. With the channel's public flag retired it is
              the only way a guest sees a price where that mode is `none`, so the
              card says so beside the two defaults it qualifies — and that a
              channel's own value, written on the Settings screen, beats both. */}
          <p className="text-xs text-muted-foreground">{t('priceLists.displayModes.settings.precedenceHint')}</p>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * The page's result line (#1492): a kit `Alert` with a way to dismiss it. An
 * error is announced as an alert; a saved change sits in the page's status
 * region, so the alert itself takes no live role.
 */
function Banner({
  kind,
  message,
  onDismiss,
}: {
  kind: 'error' | 'info';
  message: string;
  onDismiss: () => void;
}): ReactNode {
  const t = useTranslation('core');
  return (
    <Alert
      variant={kind === 'error' ? 'destructive' : 'success'}
      live={kind === 'error' ? 'assertive' : 'off'}
      className="mb-4 flex items-center gap-2 py-2"
    >
      <AlertDescription className="flex-1">{message}</AlertDescription>
      <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
        {t('priceLists.dismiss')}
      </Button>
    </Alert>
  );
}

function AddOverrideDialog(props: {
  scope: Scope;
  existing: Set<string>;
  orgs: Record<string, OrganizationRow>;
  cats: Record<string, CategoryRow>;
  products: Record<string, ProductRow>;
  onClose: () => void;
  onPick: (targetId: string, mode: DisplayMode) => void;
}): ReactNode {
  const t = useTranslation('core');
  const MODE_LABEL: Record<DisplayMode, string> = {
    gross_only: t('priceLists.displayMode.grossOnly'),
    net_only: t('priceLists.displayMode.netOnly'),
    both: t('priceLists.displayMode.both'),
    none: t('priceLists.displayMode.none'),
  };
  const SCOPE_LABEL: Record<Scope, string> = {
    organization: t('priceLists.displayModes.scope.organization'),
    category: t('priceLists.displayModes.scope.category'),
    product: t('priceLists.displayModes.scope.product'),
  };
  const { scope, existing, orgs, cats, products, onClose, onPick } = props;
  const localizedName = useLocalizedName();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<DisplayMode>('gross_only');
  const scopeName = SCOPE_LABEL[scope].toLowerCase();
  const titleId = useId();

  const candidates: { id: string; label: string; subtitle: string }[] = useMemo(() => {
    const rows: { id: string; label: string; subtitle: string }[] = [];
    if (scope === 'organization') {
      for (const o of Object.values(orgs)) rows.push({ id: o.id, label: o.name, subtitle: o.taxId ?? '' });
    } else if (scope === 'category') {
      for (const c of Object.values(cats)) rows.push({ id: c.id, label: localizedName(c.name, c.slug), subtitle: c.slug });
    } else {
      for (const p of Object.values(products)) rows.push({ id: p.id, label: p.name || p.sku, subtitle: p.sku });
    }
    rows.sort((a, b) => a.label.localeCompare(b.label));
    const q = normalize(search);
    if (q === '') return rows.filter((r) => !existing.has(r.id));
    return rows.filter(
      (r) =>
        !existing.has(r.id) &&
        (normalize(r.label).includes(q) || normalize(r.subtitle).includes(q)),
    );
  }, [scope, orgs, cats, products, existing, search, localizedName]);

  return (
    <>
      <div className="b2b-scrim" onClick={onClose} />
      <aside className="b2b-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="b2b-drawer__head">
          <div id={titleId} className="b2b-drawer__title">
            {t('priceLists.displayModes.addDialog.title')}
          </div>
          <p className="text-sm text-muted-foreground">
            {t('priceLists.displayModes.addDialog.subtitle', { scope: scopeName })}
          </p>
        </div>
        <div className="b2b-drawer__body space-y-3">
          <ListToolbarSearch
            autoFocus
            className="sm:max-w-none"
            label={t('priceLists.displayModes.searchPlaceholder', { scope: scopeName })}
            placeholder={t('priceLists.displayModes.searchPlaceholder', { scope: scopeName })}
            value={search}
            onValueChange={setSearch}
          />
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('priceLists.displayModes.addDialog.noMore', { scope: scopeName })}
            </p>
          ) : (
            <ul className="max-h-80 list-none overflow-auto p-0">
              {candidates.slice(0, 200).map((c) => (
                <li key={c.id}>
                  {/* A button, not a clickable <li>: the pick is reachable by keyboard and
                      says whether it is the chosen one (#1492). */}
                  <button
                    type="button"
                    aria-pressed={picked === c.id}
                    onClick={(): void => setPicked(c.id)}
                    className={cn(
                      'flex w-full flex-col items-start border-l-[3px] px-2 py-1.5 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      picked === c.id ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted',
                    )}
                  >
                    <span className="text-sm font-medium">{c.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{c.subtitle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <FormField
            label={t('priceLists.displayModes.addDialog.modeLabel')}
            id="ov-mode"
            hint={
              mode === 'none' ? (
                <span className="inline-flex items-center gap-1">
                  <EyeOff className="size-3" aria-hidden="true" /> {t('priceLists.displayModes.addDialog.noneHint')}
                </span>
              ) : undefined
            }
          >
            <Select value={mode} onChange={(e): void => setMode(e.target.value as DisplayMode)}>
              {(Object.keys(MODE_LABEL) as DisplayMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <div className="b2b-drawer__foot">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('priceLists.displayModes.addDialog.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!picked}
            onClick={(): void => {
              if (picked) onPick(picked, mode);
            }}
          >
            <Save aria-hidden="true" /> {t('priceLists.displayModes.addDialog.save')}
          </Button>
        </div>
      </aside>
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default DisplayModeOverridesPage;
