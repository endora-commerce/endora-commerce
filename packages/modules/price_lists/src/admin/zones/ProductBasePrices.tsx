import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Plus, Save, Trash2 } from 'lucide-react';
import {
  applyAmountAdjustment,
  applySignedPercent,
  type AdminZoneProps,
  type BasePriceTier,
  type BasePricesForCurrency,
  type PriceBookSummary,
  type ProductBasePrices as ProductBasePricesAnswer,
  type VariantBaseRow,
} from '@endora-commerce/contracts';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { useAuth, useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Input, Section, Select } from '@endora-commerce/admin-kit/ui';
import { errorMessage } from '../lib/api-errors.js';
import { audienceLabel } from '../lib/book-labels.js';
import { kindLabel, priceKindText, refusalText } from '../lib/grid-labels.js';
import { formatPriceCell, parsePriceCell, type PriceCellLanguage } from '../lib/price-cell.js';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';

/**
 * The product editor's base prices (feature 161, US3 — FR-019–FR-021, FR-030;
 * `research.md` R7), contributed to the end of the Pricing tab,
 * `product.editor.pricing.after`.
 *
 * One line per currency a sales channel offers: the product's tiers — the
 * first always from quantity 1, the others from a start above the one before —
 * and, for a configurable product, each variant *inherits* the product's price
 * or has its own (a fixed price, a signed percentage or a signed amount), with
 * the resulting price shown as a **preview** computed by the contracts'
 * decimal helpers, so it rounds as the server does (G17).
 *
 * **Its own *Save prices*** (OQ-1 = B; one Save for the whole product page is
 * issue #407): one `PUT …/base-prices/:productId` of the currencies changed,
 * guarded by the unsaved-changes prompt on leaving the page *and* on the
 * host's tabs, since a tab switch unmounts this panel. A base price is
 * everyone's, so a caller the server marks not `writable` (G11) sees the
 * prices and no control (FR-028).
 *
 * Below it, read-only, the books that price the product directly (G1, FR-021).
 *
 * **No `match`**: the place has one host and one mount (Z13), as this
 * module's other zones; `admin/test/modules/price_lists/price-lists-zones.test.tsx`
 * asserts it absent.
 */
export type ProductBasePricesProps = AdminZoneProps<'product.editor.pricing.after'>;

type VariantMode = 'inherit' | 'fixed' | 'percent' | 'amount';
/** A variant's own quantity tiers, kept as stored: edited in the price grid, never here. */
type VariantState = VariantMode | 'tiers';

interface TierDraft {
  readonly key: number;
  readonly start: string;
  readonly price: string;
}

interface VariantDraft {
  readonly mode: VariantState;
  readonly value: string;
  /** The stored tiers of a fixed variant price, sent back unchanged while its value is. */
  readonly stored: readonly BasePriceTier[] | null;
}

interface CurrencyDraft {
  /**
   * Where the lowest tier starts: 1, or the stored start when the lowest
   * stored tier begins above 1 — shown as stored, never replaced by an empty
   * "from 1" line (Checkpoint 6 review).
   */
  readonly firstStart: number;
  /** The price of the lowest tier. */
  readonly first: string;
  readonly more: readonly TierDraft[];
  readonly variants: Readonly<Record<string, VariantDraft>>;
}

type Drafts = Readonly<Record<string, CurrencyDraft>>;

let tierKey = 0;

function draftOf(prices: ProductBasePricesAnswer, currencies: readonly string[], variantIds: readonly string[], language: PriceCellLanguage): Drafts {
  const out: Record<string, CurrencyDraft> = {};
  const fixed = (amount: string): string => formatPriceCell({ type: 'fixed', amount }, language);
  for (const code of currencies) {
    const stored = prices.byCurrency[code];
    const tiers = [...(stored?.product ?? [])].sort((a, b) => a.minQuantity - b.minQuantity);
    const first = tiers[0];
    const variants: Record<string, VariantDraft> = {};
    for (const vid of variantIds) {
      const row = stored?.variants[vid] ?? null;
      variants[vid] =
        row === null
          ? { mode: 'inherit', value: '', stored: null }
          : row.type === 'fixed'
            ? row.tiers.length === 1 && row.tiers[0]!.minQuantity === 1 && row.tiers[0]!.maxQuantity === null
              ? { mode: 'fixed', value: fixed(row.tiers[0]!.amount), stored: row.tiers }
              : { mode: 'tiers', value: '', stored: row.tiers }
            : row.type === 'percent'
              ? { mode: 'percent', value: formatPriceCell({ type: 'percent', percent: row.percent }, language), stored: null }
              : { mode: 'amount', value: formatPriceCell({ type: 'amount', amount: row.amount }, language), stored: null };
    }
    out[code] = {
      firstStart: first?.minQuantity ?? 1,
      first: first ? fixed(first.amount) : '',
      more: tiers
        .slice(1)
        .map((tier) => ({ key: ++tierKey, start: String(tier.minQuantity), price: fixed(tier.amount) })),
      variants,
    };
  }
  return out;
}

/** The comparable content of a currency's draft (tier keys aside). */
const contentOf = (draft: CurrencyDraft | undefined): string =>
  JSON.stringify(draft ? [draft.firstStart, draft.first, draft.more.map((tier) => [tier.start, tier.price]), draft.variants] : null);

/** A typed variant value with the sign and `%` its mode implies (Postel). */
function variantText(mode: VariantState, value: string): string {
  const text = value.trim().replace(/[−‒–]/g, '-');
  if (mode === 'fixed' || text === '') return text;
  const signed = /^[+-]/.test(text) ? text : `+${text}`;
  return mode === 'percent' && !signed.endsWith('%') ? `${signed}%` : signed;
}

interface Planned {
  readonly body: BasePricesForCurrency | null;
  readonly errors: Record<string, string>;
}

export function ProductBasePrices({ productId }: ProductBasePricesProps): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const { language: adminLanguage } = useTranslationContext();
  const language: PriceCellLanguage = adminLanguage === 'pl' ? 'pl' : 'en';
  const { hasPermission } = useAuth();
  const id = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const mayReadCatalog = hasPermission('catalog:read');

  const [answer, setAnswer] = useState<ProductBasePricesAnswer | null>(null);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [skus, setSkus] = useState<Record<string, string>>({});
  const [books, setBooks] = useState<PriceBookSummary[] | null>(null);
  const [baseline, setBaseline] = useState<Drafts>({});
  const [drafts, setDrafts] = useState<Drafts>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [attempt, setAttempt] = useState(0);

  const variantIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of Object.values(answer?.byCurrency ?? {})) for (const vid of Object.keys(entry.variants)) ids.add(vid);
    return [...ids].sort((a, b) => (skus[a] ?? a).localeCompare(skus[b] ?? b));
  }, [answer, skus]);

  const reset = useCallback(
    (prices: ProductBasePricesAnswer, codes: readonly string[]): void => {
      const ids = new Set<string>();
      for (const entry of Object.values(prices.byCurrency)) for (const vid of Object.keys(entry.variants)) ids.add(vid);
      const next = draftOf(prices, codes, [...ids], language);
      setBaseline(next);
      setDrafts(next);
      setErrors({});
    },
    [language],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    void Promise.all([api.basePrices(productId), api.targets.currencies()])
      .then(([prices, offered]) => {
        if (cancelled) return;
        const codes = [...new Set([...offered.map((c) => c.code), ...Object.keys(prices.byCurrency)])].sort();
        setAnswer(prices);
        setCurrencies(codes);
        reset(prices, codes);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err, ''));
      });
    // The variants' SKUs, through the catalogue's admin read; ids stand in without it.
    if (mayReadCatalog) {
      void api
        .productVariants(productId)
        .then((variants) => {
          if (!cancelled) setSkus(Object.fromEntries(variants.map((v) => [v.id, v.sku])));
        })
        .catch(() => undefined);
    }
    void api
      .list({ productId, page: 1, pageSize: 200 })
      .then((list) => {
        if (!cancelled) setBooks(list.data.filter((book) => !book.isSystem));
      })
      .catch(() => {
        if (!cancelled) setBooks([]);
      });
    return (): void => {
      cancelled = true;
    };
  }, [api, productId, attempt, reset, mayReadCatalog]);

  const dirtyCurrencies = currencies.filter((code) => contentOf(drafts[code]) !== contentOf(baseline[code]));
  const dirty = dirtyCurrencies.length > 0;
  useUnsavedChangesPrompt(dirty, undefined, { guardTabsOutside: panelRef });
  const writable = answer?.writable === true;

  /** One currency's body, or the errors that stop it (keys `code:…`). */
  const plan = (code: string): Planned => {
    const draft = drafts[code]!;
    const found: Record<string, string> = {};
    const amountOf = (text: string, key: string): string | null => {
      const parsed = parsePriceCell(text, { selection: { productId } });
      if (parsed.kind === 'empty') return null;
      if (parsed.kind === 'invalid') {
        found[key] = refusalText(t, parsed);
        return null;
      }
      if (parsed.price.type !== 'fixed') {
        found[key] = t('basePrices.error.fixedOnly');
        return null;
      }
      return parsed.price.amount;
    };
    const tiers: { min: number; amount: string }[] = [];
    const first = amountOf(draft.first, `${code}:first`);
    if (first !== null) tiers.push({ min: draft.firstStart, amount: first });
    let previous = draft.firstStart;
    for (const tier of draft.more) {
      const start = Number(tier.start.trim());
      const startOk = tier.start.trim() !== '' && Number.isInteger(start) && start > previous;
      if (!startOk) found[`${code}:start:${tier.key}`] = t('basePrices.error.ascending');
      else previous = start;
      const priceKey = `${code}:price:${tier.key}`;
      const amount = amountOf(tier.price, priceKey);
      if (amount === null && !found[priceKey]) found[priceKey] = t('basePrices.error.priceRequired');
      if (amount !== null && startOk) tiers.push({ min: start, amount });
    }
    if (first === null && draft.more.length > 0 && !found[`${code}:first`]) found[`${code}:first`] = t('basePrices.error.priceRequired');
    const variants: Record<string, VariantBaseRow | null> = {};
    for (const [vid, variant] of Object.entries(draft.variants)) {
      if (variant.mode === 'inherit') {
        variants[vid] = null;
        continue;
      }
      if (variant.mode === 'tiers') {
        // Sent back exactly as stored.
        variants[vid] = { type: 'fixed', tiers: [...variant.stored!] };
        continue;
      }
      const key = `${code}:variant:${vid}`;
      const parsed = parsePriceCell(variantText(variant.mode, variant.value), { selection: { variantId: vid } });
      if (parsed.kind !== 'price' || parsed.price.type !== variant.mode) {
        found[key] = parsed.kind === 'invalid' ? refusalText(t, parsed) : t('basePrices.error.variantValue');
        continue;
      }
      const price = parsed.price;
      if (price.type === 'fixed') {
        const unchanged = variant.stored !== null && formatPriceCell({ type: 'fixed', amount: variant.stored[0]!.amount }, language) === variant.value;
        variants[vid] = {
          type: 'fixed',
          tiers: unchanged ? [...variant.stored!] : [{ minQuantity: 1, maxQuantity: null, amount: price.amount }],
        };
      } else if (price.type === 'percent') {
        variants[vid] = { type: 'percent', percent: price.percent };
      } else {
        variants[vid] = { type: 'amount', amount: price.amount };
      }
    }
    if (Object.keys(found).length > 0) return { body: null, errors: found };
    const product = tiers.map((tier, index) => ({
      minQuantity: tier.min,
      maxQuantity: tiers[index + 1] ? tiers[index + 1]!.min - 1 : null,
      amount: tier.amount,
    }));
    return { body: { product, variants }, errors: {} };
  };

  const save = async (): Promise<void> => {
    if (saving) return;
    const byCurrency: Record<string, BasePricesForCurrency> = {};
    const found: Record<string, string> = {};
    for (const code of dirtyCurrencies) {
      const planned = plan(code);
      Object.assign(found, planned.errors);
      if (planned.body) byCurrency[code] = planned.body;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    setRefusal(null);
    setStatus(t('basePrices.status.saving'));
    try {
      const saved = await api.writeBasePrices(productId, { byCurrency });
      setAnswer(saved);
      reset(saved, currencies);
      setStatus(t('basePrices.status.saved'));
    } catch (err) {
      setStatus('');
      setRefusal(errorMessage(err, t('basePrices.error.save')));
    } finally {
      setSaving(false);
    }
  };

  const anyPrice = Object.values(answer?.byCurrency ?? {}).some((entry) => entry.product.length > 0);
  const label = (vid: string): string => skus[vid] ?? vid.slice(0, 8);

  return (
    <div ref={panelRef}>
      <Section title={t('basePrices.title')}>
        <p className="text-sm text-muted-foreground">{t('basePrices.description')}</p>
        {loadError !== null ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {t('basePrices.error.load')}
                {loadError ? <span className="block text-xs">{loadError}</span> : null}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={(): void => setAttempt((n) => n + 1)}>
                {t('priceBooks.common.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : answer === null ? (
          <div aria-busy="true" className="space-y-2">
            <p className="sr-only">{t('basePrices.loading')}</p>
            <div className="h-24 rounded bg-muted motion-safe:animate-pulse" aria-hidden="true" />
          </div>
        ) : (
          <div className="space-y-4">
            {anyPrice ? null : (
              <Alert variant="warning">
                <AlertTriangle aria-hidden="true" />
                <AlertDescription>{t('basePrices.notOrderable')}</AlertDescription>
              </Alert>
            )}
            {writable ? null : <p className="text-sm text-muted-foreground">{t('basePrices.readOnly')}</p>}
            {refusal ? (
              <Alert variant="destructive">
                <AlertDescription>{refusal}</AlertDescription>
              </Alert>
            ) : null}
            {currencies.map((code) => (
              <CurrencyLine
                key={code}
                id={`${id}-${code}`}
                code={code}
                draft={drafts[code]!}
                stored={answer.byCurrency[code]}
                writable={writable}
                errors={errors}
                language={language}
                variantIds={variantIds}
                variantLabel={label}
                onChange={(next): void => setDrafts((current) => ({ ...current, [code]: next }))}
              />
            ))}
            <p role="status" className="sr-only">
              {status}
            </p>
            {writable ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={(): void => void save()} disabled={!dirty || saving} aria-busy={saving}>
                  <Save aria-hidden="true" />
                  {saving ? t('basePrices.saving') : t('basePrices.save')}
                </Button>
                <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={(): void => setDrafts(baseline)}>
                  {t('basePrices.discard')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Section>
      <BooksPricingProduct productId={productId} books={books} language={language} />
    </div>
  );
}

function CurrencyLine(props: {
  readonly id: string;
  readonly code: string;
  readonly draft: CurrencyDraft;
  readonly stored: ProductBasePricesAnswer['byCurrency'][string] | undefined;
  readonly writable: boolean;
  readonly errors: Record<string, string>;
  readonly language: PriceCellLanguage;
  readonly variantIds: readonly string[];
  readonly variantLabel: (id: string) => string;
  readonly onChange: (next: CurrencyDraft) => void;
}): ReactNode {
  const t = useTranslation('price_lists');
  const { code, draft, errors } = props;
  const errorId = (key: string): string => `${props.id}-${key.replace(/[^a-z0-9]/gi, '-')}-error`;
  const fieldError = (key: string): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    errors[key] ? { 'aria-invalid': true, 'aria-describedby': errorId(key) } : {};
  const errorText = (key: string): ReactNode =>
    errors[key] ? (
      <p id={errorId(key)} className="text-xs text-destructive">
        {errors[key]}
      </p>
    ) : null;

  // The product's price from 1 in this currency, for the variants' previews.
  const parsedBase = parsePriceCell(draft.first, { selection: { productId: code } });
  const base = draft.firstStart === 1 && parsedBase.kind === 'price' && parsedBase.price.type === 'fixed' ? parsedBase.price.amount : null;
  const money = (amount: string): string => formatPriceCell({ type: 'fixed', amount }, props.language);
  const noPrice = draft.first.trim() === '' && draft.more.length === 0 && !props.stored?.product.length;

  return (
    <fieldset className="space-y-3 rounded-md border p-4" aria-label={code}>
      <legend className="px-1 text-sm font-semibold">{code}</legend>
      {props.writable ? (
        <div className="space-y-2">
          <div className="grid max-w-md grid-cols-[8rem_1fr] items-start gap-2">
            <span className="pt-2 text-sm">{t('basePrices.from', { start: draft.firstStart })}</span>
            <div className="space-y-1">
              <Input
                aria-label={t('basePrices.firstPrice', { start: draft.firstStart, currency: code })}
                inputMode="decimal"
                value={draft.first}
                onChange={(event): void => props.onChange({ ...draft, first: event.target.value })}
                {...fieldError(`${code}:first`)}
              />
              {errorText(`${code}:first`)}
            </div>
          </div>
          {draft.more.map((tier, index) => {
            const update = (patch: Partial<TierDraft>): void =>
              props.onChange({ ...draft, more: draft.more.map((other) => (other.key === tier.key ? { ...other, ...patch } : other)) });
            return (
              <div key={tier.key} className="grid max-w-md grid-cols-[8rem_1fr_auto] items-start gap-2">
                <div className="space-y-1">
                  <Input
                    aria-label={t('basePrices.tierStart', { n: index + 2, currency: code })}
                    inputMode="numeric"
                    value={tier.start}
                    onChange={(event): void => update({ start: event.target.value })}
                    {...fieldError(`${code}:start:${tier.key}`)}
                  />
                  {errorText(`${code}:start:${tier.key}`)}
                </div>
                <div className="space-y-1">
                  <Input
                    aria-label={t('basePrices.tierPrice', { n: index + 2, currency: code })}
                    inputMode="decimal"
                    value={tier.price}
                    onChange={(event): void => update({ price: event.target.value })}
                    {...fieldError(`${code}:price:${tier.key}`)}
                  />
                  {errorText(`${code}:price:${tier.key}`)}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('basePrices.removeTier', { n: index + 2, currency: code })}
                  onClick={(): void => props.onChange({ ...draft, more: draft.more.filter((other) => other.key !== tier.key) })}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={t('basePrices.addTier', { currency: code })}
            onClick={(): void => props.onChange({ ...draft, more: [...draft.more, { key: ++tierKey, start: '', price: '' }] })}
          >
            <Plus aria-hidden="true" />
            {t('basePrices.addTierShort')}
          </Button>
        </div>
      ) : (
        <ul className="text-sm">
          {(props.stored?.product ?? []).map((tier) => (
            <li key={tier.minQuantity}>{t('basePrices.tierText', { start: tier.minQuantity, price: money(tier.amount) })}</li>
          ))}
        </ul>
      )}
      {noPrice ? <p className="text-xs text-amber-800">{t('basePrices.noPriceIn', { currency: code })}</p> : null}
      {!noPrice && draft.firstStart > 1 ? (
        <p className="text-xs text-amber-800">{t('basePrices.notOrderableBelow', { start: draft.firstStart, currency: code })}</p>
      ) : null}

      {props.variantIds.length > 0 ? (
        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">{t('basePrices.variants')}</p>
          {props.variantIds.map((vid) => {
            const variant = draft.variants[vid] ?? { mode: 'inherit' as const, value: '', stored: null };
            const name = props.variantLabel(vid);
            const key = `${code}:variant:${vid}`;
            return (
              <fieldset key={vid} className="grid gap-2 sm:grid-cols-[10rem_12rem_1fr] sm:items-start" aria-label={t('basePrices.variant', { sku: name })}>
                <span className="pt-2 text-sm">{name}</span>
                {variant.mode === 'tiers' ? (
                  <span className="space-y-0.5 text-sm sm:col-span-2">
                    {(variant.stored ?? []).map((tier) => (
                      <span key={tier.minQuantity} className="block">
                        {t('basePrices.tierText', { start: tier.minQuantity, price: money(tier.amount) })}
                      </span>
                    ))}
                    <span className="block text-xs text-muted-foreground">{t('basePrices.variantTiers')}</span>
                    {props.stored?.bookId ? (
                      <Link to={`/price-lists/${props.stored.bookId}?tab=prices`} className="text-xs underline underline-offset-2">
                        {t('basePrices.openBaseBook')}
                      </Link>
                    ) : null}
                  </span>
                ) : props.writable ? (
                  <>
                    <Select
                      aria-label={t('basePrices.variantMode', { sku: name })}
                      value={variant.mode}
                      onChange={(event): void =>
                        props.onChange({
                          ...draft,
                          variants: { ...draft.variants, [vid]: { mode: event.target.value as VariantMode, value: '', stored: null } },
                        })
                      }
                    >
                      {(['inherit', 'fixed', 'percent', 'amount'] as const).map((mode) => (
                        <option key={mode} value={mode}>
                          {t(`basePrices.mode.${mode}`)}
                        </option>
                      ))}
                    </Select>
                    <div className="space-y-1">
                      {variant.mode === 'inherit' ? null : (
                        <Input
                          aria-label={t(`basePrices.value.${variant.mode as VariantMode}`, { sku: name })}
                          inputMode="decimal"
                          value={variant.value}
                          onChange={(event): void =>
                            props.onChange({ ...draft, variants: { ...draft.variants, [vid]: { ...variant, value: event.target.value } } })
                          }
                          {...fieldError(key)}
                        />
                      )}
                      {errorText(key)}
                      <VariantPreview variant={variant} base={base} money={money} vid={vid} />
                    </div>
                  </>
                ) : (
                  <span className="text-sm sm:col-span-2">
                    {variant.mode === 'inherit' ? null : variant.value}
                    <VariantPreview variant={variant} base={base} money={money} vid={vid} />
                  </span>
                )}
              </fieldset>
            );
          })}
        </div>
      ) : null}
    </fieldset>
  );
}

/** What a variant pays at quantity 1, labelled as a preview (FR-030). */
function VariantPreview(props: {
  readonly variant: VariantDraft;
  readonly base: string | null;
  readonly money: (amount: string) => string;
  readonly vid: string;
}): ReactNode {
  const t = useTranslation('price_lists');
  const { variant, base } = props;
  let text: string | null = null;
  if (variant.mode === 'inherit') {
    text = base !== null ? t('basePrices.inherits', { price: props.money(base) }) : t('basePrices.inheritsNothing');
  } else if (variant.mode === 'percent' || variant.mode === 'amount') {
    const parsed = parsePriceCell(variantText(variant.mode, variant.value), { selection: { variantId: props.vid } });
    if (parsed.kind === 'price' && parsed.price.type === variant.mode) {
      if (base === null) {
        text = t('basePrices.noBaseToAdjust');
      } else {
        const result =
          parsed.price.type === 'percent' ? applySignedPercent(base, parsed.price.percent) : parsed.price.type === 'amount' ? applyAmountAdjustment(base, parsed.price.amount) : null;
        text = result === null ? t('basePrices.belowZero') : t('basePrices.preview', { price: props.money(result) });
      }
    }
  }
  return text ? <span className="block text-xs text-muted-foreground">{text}</span> : null;
}

/** The books that price the product directly (G1, FR-021), read-only. */
function BooksPricingProduct(props: {
  readonly productId: string;
  readonly books: readonly PriceBookSummary[] | null;
  readonly language: PriceCellLanguage;
}): ReactNode {
  const t = useTranslation('price_lists');
  const listLabel = t('basePrices.books.title');
  return (
    <Section title={listLabel} className="mt-6">
      {props.books === null ? (
        <div className="h-12 rounded bg-muted motion-safe:animate-pulse" aria-hidden="true" />
      ) : props.books.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('basePrices.books.empty')}</p>
      ) : (
        <ul aria-label={listLabel} className="divide-y rounded-md border">
          {props.books.map((book) => {
            const reference = book.type === 'regular' && book.audienceKind === 'everyone' ? 'base' : 'catalogue';
            return (
              <li key={book.id} className="space-y-1 p-3 text-sm">
                <Link to={`/price-lists/${book.id}`} className="font-medium underline-offset-2 hover:underline">
                  {book.name}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {book.audienceKind === 'everyone'
                    ? audienceLabel(t, 'everyone')
                    : t('priceBooks.list.audienceSummary', { kind: audienceLabel(t, book.audienceKind), count: book.memberCount })}
                </span>
                {(book.matches ?? []).map((match) => {
                  const values = {
                    start: match.minQuantity,
                    price: formatPriceCell(match.price, props.language),
                    kind: priceKindText(t, match.price, reference),
                  };
                  return (
                    <span key={match.rowId} className="block text-xs">
                      {match.selectionKind === 'variant'
                        ? t('basePrices.books.variantMatch', { ...values, variant: kindLabel(t, 'variant') })
                        : t('basePrices.books.match', values)}
                    </span>
                  );
                })}
              </li>
            );
          })}
        </ul>
      )}
      <Link to={`/price-lists/explain?${new URLSearchParams({ productId: props.productId }).toString()}`} className="text-sm underline underline-offset-2">
        {t('grid.detail.explain')}
      </Link>
    </Section>
  );
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default ProductBasePrices;
