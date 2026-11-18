'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { SearchSuggestItem } from '@endora-commerce/contracts';
import { getSuggestions } from '../../lib/api/search';
import { toAbsoluteAssetUrl } from '../../lib/asset-url';
import { format } from '../../lib/i18n/format';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * The product of one line of a complaint without an order (`specs/180-off-platform-complaints/`
 * FR-B12; design review Part 2, *Product field*): **one** field that searches the catalogue
 * and also takes a typed model name (Hick, Tesler — no "catalogue or free text" choice).
 *
 * Without JavaScript it is a plain text input posting `lines.N.modelName`. With it, the same
 * input becomes a WCAG 2.2 AA combobox on `SearchAutocomplete`'s API and keyboard model —
 * `GET /api/v1/search/suggest` for the request's channel, ↑/↓ through
 * `aria-activedescendant`, Enter to choose, Escape to close, the result count announced.
 * Choosing sets a hidden `lines.N.productId` and leaves the product's name in the field, still
 * editable; editing it again clears the product, so what is posted is either the chosen product
 * or the typed model, never a stale pair. Options show the image, name and SKU and no price
 * (Signal-to-Noise). The route handler sends `productId` when present, otherwise `modelName`.
 */

const DEBOUNCE_MS = 200;
const DEFAULT_MINIMUM_QUERY_LENGTH = 3;
const LIMIT = 8;

export interface ProductFieldProps {
  id: string;
  /** `lines.N` — the field posts `lines.N.modelName` and, once chosen, `lines.N.productId`. */
  namePrefix: string;
  locale: string;
  label: string;
  /** The no-JS hint (type the model name); the combobox words its own. */
  hint: string;
  defaultValue?: string;
  /** A product chosen on a refused attempt, kept. */
  defaultProductId?: string;
  /** The line's error sentence, rendered under the control. */
  error?: string;
  /** `null` when the browser's API origin is unknown: the field stays plain. */
  apiBaseUrl: string | null;
  salesChannelCode: string | undefined;
}

type Suggestion = Pick<SearchSuggestItem, 'id' | 'name' | 'sku' | 'primaryAssetUrl'>;

export function ProductField(props: ProductFieldProps): ReactNode {
  const t = tForLocale(props.locale);
  const listboxId = useId();
  const statusId = `${props.id}-status`;
  const hintId = `${props.id}-hint`;
  const errorId = `${props.id}-error`;
  const [enhanced, setEnhanced] = useState(false);
  const [value, setValue] = useState(props.defaultValue ?? '');
  const [productId, setProductId] = useState(props.defaultProductId ?? '');
  const [chosenSku, setChosenSku] = useState('');
  const [results, setResults] = useState<Suggestion[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [minimum, setMinimum] = useState(DEFAULT_MINIMUM_QUERY_LENGTH);
  /** Set when the value changed by choosing, so the search does not run for the chosen name. */
  const choosing = useRef(false);
  /** Set by Escape until the next edit: results arriving late do not reopen a dismissed list. */
  const dismissed = useRef(false);

  useEffect(() => {
    if (props.apiBaseUrl) setEnhanced(true);
  }, [props.apiBaseUrl]);

  useEffect(() => {
    if (!enhanced || !props.apiBaseUrl) return undefined;
    if (choosing.current) {
      choosing.current = false;
      return undefined;
    }
    const query = value.trim();
    if (query.length < minimum) {
      setResults(null);
      setActive(-1);
      return undefined;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await getSuggestions({
            apiBaseUrl: props.apiBaseUrl!,
            q: query,
            limit: LIMIT,
            salesChannelCode: props.salesChannelCode,
            signal: abort.signal,
          });
          setMinimum(response.meta.minimumQueryLength);
          setResults(response.data);
          setActive(-1);
          // Late results do not reopen the list over a field the customer has already left.
          if (document.activeElement?.id === props.id && !dismissed.current) setOpen(true);
        } catch (err) {
          if ((err as { name?: string }).name === 'AbortError') return;
          // The search failing leaves a plain text field: the typed model still posts.
          setResults(null);
        }
      })();
    }, DEBOUNCE_MS);
    return (): void => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [enhanced, value, minimum, props.apiBaseUrl, props.salesChannelCode, props.id]);

  const expanded = enhanced && open && results !== null && results.length > 0;
  const optionId = (i: number): string => `${listboxId}-option-${i}`;

  function choose(item: Suggestion): void {
    choosing.current = true;
    setValue(item.name);
    setProductId(item.id);
    setChosenSku(item.sku);
    setOpen(false);
    setActive(-1);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    choosing.current = false;
    dismissed.current = false;
    setValue(event.target.value);
    // A changed text is a typed model: whatever was chosen no longer describes it.
    setProductId('');
    setChosenSku('');
    setOpen(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!enhanced) return;
    if (event.key === 'Escape') {
      dismissed.current = true;
      if (open) event.preventDefault();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (!results || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (event.key === 'Enter' && expanded && active >= 0) {
      // Choosing, not submitting the complaint.
      event.preventDefault();
      choose(results[active]!);
    }
  }

  const status = !enhanced || results === null
    ? ''
    : results.length === 0
      ? t('returns.elsewhere.productNoMatch')
      : format(t('returns.elsewhere.productResults'), { count: String(results.length) });

  const describedBy = [hintId, props.error ? errorId : ''].filter(Boolean).join(' ');

  return (
    <div className="b2b-auth__field relative">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        name={`${props.namePrefix}.modelName`}
        maxLength={255}
        autoComplete="off"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={(): void => setOpen(false)}
        aria-describedby={describedBy}
        {...(props.error ? { 'aria-invalid': true } : {})}
        {...(enhanced
          ? {
              role: 'combobox',
              'aria-autocomplete': 'list' as const,
              'aria-expanded': expanded,
              'aria-controls': listboxId,
              ...(expanded && active >= 0 ? { 'aria-activedescendant': optionId(active) } : {}),
            }
          : {})}
      />
      {productId ? <input type="hidden" name={`${props.namePrefix}.productId`} value={productId} /> : null}
      <p id={hintId} className="text-[12px] text-muted">
        {enhanced ? t('returns.elsewhere.productSearchHint') : props.hint}
      </p>
      {productId && chosenSku ? (
        <p className="m-0 text-[12px] text-fg-soft">{format(t('returns.elsewhere.productChosen'), { sku: chosenSku })}</p>
      ) : enhanced && !productId && value.trim() && !expanded ? (
        // Said in words, not only to a screen reader: a product no longer sold is filed as typed.
        <p className="m-0 text-[12px] text-fg-soft">{t('returns.elsewhere.productTyped')}</p>
      ) : null}
      {enhanced ? (
        <>
          <ul
            id={listboxId}
            role="listbox"
            aria-label={props.label}
            hidden={!expanded}
            className="absolute left-0 right-0 z-50 m-0 mt-1 max-h-[320px] list-none overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg"
          >
            {expanded
              ? results!.map((item, i) => (
                  <li
                    key={item.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    // Keeps the focus in the input, so the blur does not close the list first.
                    onMouseDown={(event): void => event.preventDefault()}
                    onClick={(): void => choose(item)}
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] ${
                      i === active ? 'bg-surface-alt outline outline-2 -outline-offset-2 outline-accent' : 'hover:bg-surface-alt'
                    }`}
                  >
                    <span className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded border border-line bg-surface-alt">
                      {item.primaryAssetUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={toAbsoluteAssetUrl(item.primaryAssetUrl)} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                      ) : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium text-fg">{item.name}</span>
                      <span className="truncate font-mono text-[11px] text-muted">{item.sku}</span>
                    </span>
                  </li>
                ))
              : null}
          </ul>
          <p id={statusId} role="status" className="sr-only">
            {status}
          </p>
        </>
      ) : null}
      {props.error ? (
        <p id={errorId} className="b2b-auth__error m-0">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}
