import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import type {
  PriceBookResolvedLine,
  PriceBookRowLabels,
  PriceBookTargetCurrency,
  PriceBookTargetSalesChannel,
} from '@endora-commerce/contracts';
import { CustomerPicker, ProductPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Combobox, Input, Label, PageHeader, Select, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { errorMessage } from '../lib/api-errors.js';
import { cellLabel, sourceLabel } from '../lib/cell-labels.js';
import { useLocalizedName } from '../lib/localized-name.js';
import { formatPriceCell, type PriceCellLanguage } from '../lib/price-cell.js';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';

/**
 * The price explainer (feature 161, US5 — FR-023, FR-024; `research.md` R8):
 * what a buyer pays for each line, and why — the price and its source, the
 * cell in words, the book and the row that set it (both linked), the reference
 * a percentage was taken from, the precedence version, and the runner-ups by
 * name (G16). It asks `POST …/price-books/resolve`, which applies the
 * caller's scope: a representative's organizations come from the scope-filtered
 * targets, and a buyer out of scope answers as an unknown one.
 *
 * Pre-filled from the address — `productId`, `variantId`, `organizationId`,
 * `bookId` (the book's channel, currency and, for a book of one organization,
 * that organization) — so a book, a grid cell, the product editor and an
 * organization open it about themselves.
 */

type BuyerKind = 'guest' | 'organization' | 'customer';

interface LineDraft {
  readonly key: number;
  readonly productId: string | null;
  readonly variantId: string;
  readonly quantity: string;
}

let lineKey = 0;
const MAX_LINES = 200;

export function PriceExplainerPage(): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const { hasPermission } = useAuth();
  const { language: adminLanguage } = useTranslationContext();
  const language: PriceCellLanguage = adminLanguage === 'pl' ? 'pl' : 'en';
  const localizedName = useLocalizedName();
  const [params] = useSearchParams();
  const id = useId();

  const [channels, setChannels] = useState<PriceBookTargetSalesChannel[]>([]);
  const [currencies, setCurrencies] = useState<PriceBookTargetCurrency[]>([]);
  const [channelId, setChannelId] = useState('');
  const [currency, setCurrency] = useState('');
  const [buyer, setBuyer] = useState<BuyerKind>(params.get('organizationId') ? 'organization' : 'guest');
  const [organizationId, setOrganizationId] = useState<string | null>(params.get('organizationId'));
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [lines, setLines] = useState<LineDraft[]>(() => [
    { key: ++lineKey, productId: params.get('productId'), variantId: params.get('variantId') ?? '', quantity: '1' },
  ]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<{ readonly lines: readonly LineDraft[]; readonly resolved: readonly PriceBookResolvedLine[] } | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    void api.targets.salesChannels().then(setChannels).catch(() => undefined);
    void api.targets.currencies().then(setCurrencies).catch(() => undefined);
    const bookId = params.get('bookId');
    if (bookId) {
      // A book's own channel, currency and — when it has one — organization.
      void api
        .get(bookId)
        .then((book) => {
          const channel = book.channels.find((c) => !c.dormant) ?? book.channels[0];
          if (channel) setChannelId(channel.channelId);
          setCurrency(book.currencyCode);
          if (!params.get('organizationId') && book.audience.kind === 'organizations' && book.audience.memberIds.length === 1) {
            setBuyer('organization');
            setOrganizationId(book.audience.memberIds[0]!);
          }
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, from the address it was opened with
  }, [api]);

  const mayPickCustomer = hasPermission('customers:read');

  const explain = async (): Promise<void> => {
    if (lines.some((line) => !line.productId)) {
      setProblem(t('explainer.error.productRequired'));
      return;
    }
    if (lines.some((line) => !/^\d+$/.test(line.quantity.trim()) || Number(line.quantity) < 1)) {
      setProblem(t('explainer.error.quantity'));
      return;
    }
    if (buyer === 'organization' && !organizationId) {
      setProblem(t('explainer.error.organizationRequired'));
      return;
    }
    if (buyer === 'customer' && !customerId) {
      setProblem(t('explainer.error.customerRequired'));
      return;
    }
    setProblem(null);
    setBusy(true);
    setStatus(t('explainer.status.asking'));
    try {
      const asked = [...lines];
      const resolved = await api.resolve({
        ...(channelId ? { salesChannelId: channelId } : {}),
        ...(currency ? { currencyCode: currency } : {}),
        buyer:
          buyer === 'organization' && organizationId
            ? { organizationId }
            : buyer === 'customer' && customerId
              ? { customerAccountId: customerId }
              : {},
        lines: asked.map((line, index) => ({
          key: String(index + 1),
          productId: line.productId!,
          ...(line.variantId ? { variantId: line.variantId } : {}),
          quantity: Number(line.quantity),
        })),
      });
      setAnswers({ lines: asked, resolved });
      setStatus(t('explainer.status.answered', { count: resolved.length }));
    } catch (err) {
      setStatus('');
      setProblem(errorMessage(err, t('explainer.error.resolve')));
    } finally {
      setBusy(false);
    }
  };

  const update = (key: number, patch: Partial<LineDraft>): void =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <>
      <PageHeader title={t('priceBooks.explainer.title')} description={t('priceBooks.explainer.description')} />
      <form
        className="max-w-3xl space-y-5"
        aria-label={t('explainer.form')}
        onSubmit={(event): void => {
          event.preventDefault();
          void explain();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-channel`}>{t('explainer.channel')}</Label>
            <Select id={`${id}-channel`} value={channelId} onChange={(event): void => setChannelId(event.target.value)}>
              <option value="">{t('explainer.channel.default')}</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {localizedName(channel.name, channel.code)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-currency`}>{t('priceBooks.field.currency')}</Label>
            <Select id={`${id}-currency`} value={currency} onChange={(event): void => setCurrency(event.target.value)}>
              <option value="">{t('explainer.currency.default')}</option>
              {[...new Set([...currencies.map((c) => c.code), ...(currency ? [currency] : [])])].sort().map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('explainer.buyer')}</legend>
          <div className="flex flex-wrap gap-4">
            {(['guest', 'organization', ...(mayPickCustomer ? (['customer'] as const) : [])] as BuyerKind[]).map((kind) => (
              <label key={kind} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
                <input
                  type="radio"
                  name={`${id}-buyer`}
                  className="h-4 w-4 accent-primary"
                  checked={buyer === kind}
                  onChange={(): void => setBuyer(kind)}
                />
                {t(`explainer.buyer.${kind}`)}
              </label>
            ))}
          </div>
          {buyer === 'organization' ? <OrganizationField value={organizationId} onChange={setOrganizationId} /> : null}
          {buyer === 'customer' ? (
            <CustomerPicker value={customerId} onChange={setCustomerId} ariaLabel={t('explainer.buyer.customer')} />
          ) : null}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t('explainer.lines')}</legend>
          {lines.map((line, index) => (
            <ExplainLine
              key={line.key}
              n={index + 1}
              line={line}
              removable={lines.length > 1}
              onChange={(patch): void => update(line.key, patch)}
              onRemove={(): void => setLines((current) => current.filter((other) => other.key !== line.key))}
            />
          ))}
          {lines.length < MAX_LINES ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(): void => setLines((current) => [...current, { key: ++lineKey, productId: null, variantId: '', quantity: '1' }])}
            >
              <Plus aria-hidden="true" />
              {t('explainer.addLine')}
            </Button>
          ) : null}
        </fieldset>

        {problem ? (
          <Alert variant="destructive">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {t('explainer.submit')}
        </Button>
      </form>

      <p role="status" className="sr-only">
        {status}
      </p>

      {answers ? (
        <div className="mt-8 max-w-3xl space-y-4">
          {answers.resolved.map((answer, index) => (
            <Answer key={answer.key} n={index + 1} answer={answer} productId={answers.lines[index]?.productId ?? null} language={language} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function ExplainLine(props: {
  readonly n: number;
  readonly line: LineDraft;
  readonly removable: boolean;
  readonly onChange: (patch: Partial<LineDraft>) => void;
  readonly onRemove: () => void;
}): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const { hasPermission } = useAuth();
  const id = useId();
  const [variants, setVariants] = useState<Array<{ id: string; sku: string }>>([]);
  const { line } = props;

  useEffect(() => {
    if (!line.productId || !hasPermission('catalog:read')) {
      setVariants([]);
      return undefined;
    }
    let cancelled = false;
    void api
      .productVariants(line.productId)
      .then((found) => {
        if (!cancelled) setVariants(found);
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, [api, line.productId, hasPermission]);

  return (
    <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_12rem_7rem_auto] sm:items-end">
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">{t('explainer.product', { n: props.n })}</span>
        <ProductPicker
          mode="select"
          value={line.productId}
          onChange={(next): void => props.onChange({ productId: next, variantId: '' })}
          ariaLabel={t('explainer.product', { n: props.n })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-variant`}>{t('explainer.variant', { n: props.n })}</Label>
        <Select
          id={`${id}-variant`}
          value={line.variantId}
          disabled={variants.length === 0 && !line.variantId}
          onChange={(event): void => props.onChange({ variantId: event.target.value })}
        >
          <option value="">{t('explainer.variant.none')}</option>
          {variants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.sku}
            </option>
          ))}
          {line.variantId && !variants.some((v) => v.id === line.variantId) ? <option value={line.variantId}>{line.variantId.slice(0, 8)}</option> : null}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-quantity`}>{t('explainer.quantity', { n: props.n })}</Label>
        <Input id={`${id}-quantity`} inputMode="numeric" value={line.quantity} onChange={(event): void => props.onChange({ quantity: event.target.value })} />
      </div>
      {props.removable ? (
        <Button type="button" size="icon" variant="ghost" aria-label={t('explainer.removeLine', { n: props.n })} onClick={props.onRemove}>
          <Trash2 aria-hidden="true" />
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

/** The buyer's organization, from the scope-filtered price-book targets (R10). */
function OrganizationField(props: { readonly value: string | null; readonly onChange: (id: string | null) => void }): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!props.value) {
      setName(null);
      return undefined;
    }
    let cancelled = false;
    void api.targets
      .organizations({ ids: [props.value] })
      .then((orgs) => {
        if (!cancelled) setName(orgs[0]?.name ?? t('priceBooks.members.unknown'));
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, [api, props.value, t]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void api.targets
          .organizations(query.trim() ? { search: query.trim(), limit: 20 } : { limit: 20 })
          .then((orgs) => {
            if (!cancelled) setOptions(orgs.map((o) => ({ value: o.id, label: o.name, description: o.taxId })));
          })
          .catch(() => undefined);
      },
      query === '' ? 0 : 250,
    );
    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, query]);

  return (
    <div className="max-w-md space-y-1">
      <Combobox<string>
        options={options}
        value={props.value}
        onChange={props.onChange}
        onSearchChange={setQuery}
        manualFilter
        {...(name ? { selectedLabel: name } : {})}
        placeholder={t('explainer.organization.placeholder')}
        emptyMessage={t('priceBooks.members.noMatch')}
        ariaLabel={t('explainer.buyer.organization')}
      />
      {name ? <p className="text-xs text-muted-foreground">{name}</p> : null}
    </div>
  );
}

/** One line's answer (FR-023). */
function Answer(props: {
  readonly n: number;
  readonly answer: PriceBookResolvedLine;
  readonly productId: string | null;
  readonly language: PriceCellLanguage;
}): ReactNode {
  const t = useTranslation('price_lists');
  const headingId = useId();
  const { answer } = props;
  const { explanation } = answer;
  const money = (amount: string, currency?: string): string =>
    `${formatPriceCell({ type: 'fixed', amount }, props.language)}${currency ? ` ${currency}` : ''}`;
  const winner = explanation.candidates?.find((c) => c.rowId === explanation.rowId);
  const runnerUps = (explanation.candidates ?? []).filter((c) => c.rowId !== explanation.rowId);
  const rowSearch = winner ? searchOf(winner.labels) : null;

  return (
    <section aria-labelledby={headingId} className="space-y-2 rounded-md border p-4">
      <h2 id={headingId} className="text-sm font-semibold">
        {t('explainer.line', { n: props.n })}
      </h2>
      {answer.price === null ? (
        <div className="space-y-1 text-sm">
          <p>{t('explainer.unpriced')}</p>
          {props.productId ? (
            <Link to={`/catalog/products/${props.productId}`} className="underline underline-offset-2">
              {t('explainer.setBasePrice')}
            </Link>
          ) : null}
        </div>
      ) : (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="text-muted-foreground">{t('explainer.price')}</dt>
          <dd className="font-semibold">{money(answer.price.amount, answer.price.currency)}</dd>
          <dt className="text-muted-foreground">{t('explainer.source')}</dt>
          <dd>
            {sourceLabel(t, answer.price.source)}
            {answer.price.source === 'sale' && answer.price.compareAt ? (
              <span className="block text-xs text-muted-foreground">{t('explainer.saleBeat', { price: money(answer.price.compareAt, answer.price.currency) })}</span>
            ) : null}
          </dd>
          {explanation.cell ? (
            <>
              <dt className="text-muted-foreground">{t('explainer.cell')}</dt>
              <dd>{cellLabel(t, explanation.cell)}</dd>
            </>
          ) : null}
          {explanation.bookId ? (
            <>
              <dt className="text-muted-foreground">{t('explainer.book')}</dt>
              <dd className="space-x-3">
                <Link to={`/price-lists/${explanation.bookId}`} className="underline underline-offset-2">
                  {explanation.bookName ?? explanation.bookId}
                </Link>
                <Link
                  to={`/price-lists/${explanation.bookId}?${new URLSearchParams({ tab: 'prices', ...(rowSearch ? { search: rowSearch } : {}) }).toString()}`}
                  className="underline underline-offset-2"
                >
                  {t('explainer.openRow')}
                </Link>
              </dd>
            </>
          ) : null}
          {explanation.reference ? (
            <>
              <dt className="text-muted-foreground">{t('explainer.reference')}</dt>
              <dd>{t('explainer.referenceValue', { price: money(explanation.reference) })}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{t('explainer.precedence')}</dt>
          <dd>{t('explainer.precedenceVersion', { version: explanation.precedenceVersion })}</dd>
        </dl>
      )}
      {runnerUps.length > 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('explainer.runnerUps')}</p>
          <ol aria-label={t('explainer.runnerUps')} className="list-decimal space-y-0.5 pl-5 text-sm">
            {runnerUps.map((candidate) => (
              <li key={candidate.rowId}>
                {[candidate.bookName, candidate.cell ? cellLabel(t, candidate.cell) : null, describe(candidate.labels), money(candidate.amount)]
                  .filter(Boolean)
                  .join(' · ')}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

/** A row's selection in words, from its labels. */
function describe(labels: PriceBookRowLabels): string | null {
  if (labels.variantSku) return labels.variantLabel ? `${labels.variantLabel} (${labels.variantSku})` : labels.variantSku;
  if (labels.productName) return labels.productSku ? `${labels.productName} (${labels.productSku})` : labels.productName;
  const attribute = labels.attributeLabel && labels.attributeValueLabel ? `${labels.attributeLabel}: ${labels.attributeValueLabel}` : null;
  if (labels.categoryPath && attribute) return `${labels.categoryPath} · ${attribute}`;
  return labels.categoryPath ?? attribute;
}

/** What to search the grid for to land on a row's line. */
function searchOf(labels: PriceBookRowLabels): string | null {
  return labels.variantSku ?? labels.productSku ?? labels.categoryPath ?? labels.attributeValueLabel ?? null;
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default PriceExplainerPage;
