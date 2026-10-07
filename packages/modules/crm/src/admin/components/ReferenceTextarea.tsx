import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { AtSign, Package, ShoppingCart } from 'lucide-react';
import {
  foldDiacritics,
  formatOpportunityReferenceToken,
  type OpportunityReferenceType,
} from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Button, Combobox, Textarea, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { applyMention, findMentionTrigger, type MentionTrigger } from '../lib/mention-trigger.js';

const SEARCH_DEBOUNCE_MS = 250;

/**
 * The kit's product picker, fetched when *Insert product* is first pressed:
 * every note and message composer carries this textarea, and most are used
 * without ever referring to a product.
 */
const ProductPicker = lazy(() =>
  import('@endora-commerce/admin-kit/components').then((kit) => ({ default: kit.ProductPicker })),
);

/**
 * The codes of the lists a reference is chosen from. Two are their owners' —
 * `catalog`'s product list and `orders`' order list — and a role without one is
 * simply not offered that button or that shortcut (research N-H3). The people
 * who may be mentioned are CRM's own lookup, offered to whoever may write.
 */
const PRODUCT_LIST_PERMISSION = 'catalog:read';
const ORDER_LIST_PERMISSION = 'orders:read';
const PEOPLE_LIST_PERMISSION = 'crm:write';

/** What the three kinds are called in this module's bundle keys. */
const KIND_KEY = { admin_user: 'person', order: 'order', product: 'product' } as const;

interface Suggestion {
  id: string;
  label: string;
  description?: string;
}

/** A Product's name in the language on screen, then any name it has, then its SKU. */
function productLabel(name: Record<string, string>, sku: string, language: string): string {
  const base = language.split('-')[0] ?? language;
  const sameLanguage = Object.keys(name).find((locale) => locale === base || locale.startsWith(`${base}-`));
  return name[language] || (sameLanguage ? name[sameLanguage] : undefined) || Object.values(name).find(Boolean) || sku;
}

export interface ReferenceTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string;
  onValueChange: (next: string) => void;
  /**
   * The Organization whose Orders may be referred to — the Opportunity's.
   * `null` while none is chosen (the create form): Orders are not offered yet.
   */
  organizationId: string | null;
}

/**
 * The textarea of a description, a note or a message, and the two ways it puts
 * a reference into the text (User Stories 12 and 18; FR-045, FR-081, FR-082).
 *
 * A reference is a token in the text — `[[admin_user:<id>]]`,
 * `[[order:<id>]]`, `[[product:<id>]]` — written by
 * `formatOpportunityReferenceToken`, the one place the grammar lives. The token
 * is what is stored; once saved, the text is shown with the person's name, the
 * Order's number or the Product's current name in its place.
 *
 * **While typing**: `@` opens a list of people under the field, `@@` of the
 * Organization's Orders, `@@@` of Products, narrowed by whatever is typed next
 * (`lib/mention-trigger.ts` says exactly when). Arrow keys move through it,
 * Enter or Tab puts the token where the `@`s and the letters were, Escape
 * closes it and leaves them as typed — as does typing on past the last match.
 * The option the arrow keys reach is kept in view.
 * The `@` of an e-mail address opens nothing. While the list is open the field
 * is a combobox to assistive technology, its active option announced as the
 * arrow keys move; closed, it is the textarea it always was.
 *
 * **By button**: *Mention a person*, *Insert order* and *Insert product* each
 * open a search under the field; choosing a result writes its token **where the
 * caret was** and puts the caret after it.
 *
 * Only what the reader may search is offered, by either way: the product search
 * needs `catalog:read`, the order search `orders:read` and an Organization, the
 * people `crm:write`. A shortcut that is not offered leaves the characters as
 * typed — and a token typed or pasted by hand is resolved all the same.
 */
export function ReferenceTextarea(props: ReferenceTextareaProps): ReactNode {
  const {
    value,
    onValueChange,
    organizationId,
    maxLength,
    disabled,
    onKeyDown,
    'aria-describedby': describedBy,
    ...rest
  } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const baseId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  /** Where the next token goes: the last selection the field had. */
  const caret = useRef<{ start: number; end: number } | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const [picker, setPicker] = useState<OpportunityReferenceType | null>(null);
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);

  // --- Typing: the `@` shortcuts ------------------------------------------------
  /** The caret while the field has focus and nothing is selected; otherwise no list is open. */
  const [typingAt, setTypingAt] = useState<number | null>(null);
  /** The run Escape closed: it stays closed until its `@` is gone. */
  const [dismissed, setDismissed] = useState<number | null>(null);
  /** The last answer, and the search it answers — which may no longer be the one in the field. */
  const [answer, setAnswer] = useState<{
    kind: OpportunityReferenceType;
    query: string;
    found: Suggestion[];
    failed: boolean;
  } | null>(null);
  const [active, setActive] = useState(0);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestSequence = useRef(0);

  const canProducts = hasPermission(PRODUCT_LIST_PERMISSION);
  const canOrders = hasPermission(ORDER_LIST_PERMISSION) && organizationId !== null;
  const canPeople = hasPermission(PEOPLE_LIST_PERMISSION);
  const offered = useCallback(
    (kind: OpportunityReferenceType): boolean =>
      kind === 'admin_user' ? canPeople : kind === 'order' ? canOrders : canProducts,
    [canPeople, canOrders, canProducts],
  );

  const remember = (): void => {
    const element = field.current;
    if (!element) return;
    caret.current = { start: element.selectionStart, end: element.selectionEnd };
    setTypingAt(
      document.activeElement === element && element.selectionStart === element.selectionEnd
        ? element.selectionStart
        : null,
    );
  };

  // After an insertion the caret goes behind the token, once the new value is in the field.
  useEffect(() => {
    if (pendingCaret.current === null) return;
    const position = pendingCaret.current;
    pendingCaret.current = null;
    const element = field.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(position, position);
    caret.current = { start: position, end: position };
    setTypingAt(position);
  }, [value]);

  const fits = (next: string): boolean => {
    if (typeof maxLength === 'number' && next.length > maxLength) {
      setProblem(t('references.error.tooLong'));
      return false;
    }
    setProblem(null);
    return true;
  };

  const insert = (type: OpportunityReferenceType, id: string): void => {
    const token = formatOpportunityReferenceToken(type, id);
    const at = caret.current ?? { start: value.length, end: value.length };
    const next = `${value.slice(0, at.start)}${token}${value.slice(at.end)}`;
    if (!fits(next)) return;
    pendingCaret.current = at.start + token.length;
    onValueChange(next);
    setPicker(null);
    setNotice(t(`references.inserted.${type}`));
  };

  // --- By button: a search under the field -------------------------------------
  const search = useCallback(
    async (type: OpportunityReferenceType, query: string): Promise<void> => {
      const current = ++sequence.current;
      setSearching(true);
      setSearchFailed(false);
      try {
        const found =
          type === 'order'
            ? organizationId === null
              ? []
              : (await crmApi.searchOrders(organizationId, query)).map((order) => ({
                  value: order.id,
                  label: order.businessId,
                }))
            : (await crmApi.lookupMentionable(organizationId, query)).map((person) => ({
                value: person.id,
                label: person.name,
              }));
        if (current === sequence.current) setOptions(found);
      } catch {
        if (current === sequence.current) {
          setOptions([]);
          setSearchFailed(true);
        }
      } finally {
        if (current === sequence.current) setSearching(false);
      }
    },
    [organizationId],
  );

  useEffect(() => {
    if (picker === 'order' || picker === 'admin_user') {
      setOptions([]);
      void search(picker, '');
    }
    return (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [picker, search]);

  const toggle = (type: OpportunityReferenceType): void => {
    setProblem(null);
    setNotice('');
    setPicker((current) => (current === type ? null : type));
  };

  // --- While typing: the list under the field -----------------------------------
  const trigger = useMemo<MentionTrigger | null>(() => {
    if (disabled || typingAt === null) return null;
    const found = findMentionTrigger(value, typingAt);
    return found && offered(found.kind) ? found : null;
  }, [disabled, typingAt, value, offered]);
  const triggerKind = trigger?.kind ?? null;
  const triggerStart = trigger?.start ?? null;
  const triggerQuery = trigger?.query ?? null;
  const live = trigger !== null && triggerStart !== dismissed;

  // A run that is gone takes its dismissal with it: the next `@` opens again.
  useEffect(() => {
    if (triggerStart === null) setDismissed(null);
  }, [triggerStart]);

  useEffect(() => {
    if (!live || triggerKind === null || triggerQuery === null) {
      suggestSequence.current += 1;
      setAnswer(null);
      return undefined;
    }
    const current = ++suggestSequence.current;
    const run = async (): Promise<void> => {
      try {
        const found: Suggestion[] =
          triggerKind === 'admin_user'
            ? (await crmApi.lookupMentionable(organizationId, triggerQuery)).map((person) => ({
                id: person.id,
                label: person.name,
              }))
            : triggerKind === 'order'
              ? organizationId === null
                ? []
                : (await crmApi.searchOrders(organizationId, triggerQuery)).map((order) => ({
                    id: order.id,
                    label: order.businessId,
                  }))
              : (await crmApi.searchProducts(triggerQuery)).map((product) => ({
                  id: product.id,
                  label: productLabel(product.name, product.sku, language),
                  description: product.sku,
                }));
        if (current !== suggestSequence.current) return;
        setAnswer({ kind: triggerKind, query: triggerQuery, found, failed: false });
      } catch {
        if (current !== suggestSequence.current) return;
        setAnswer({ kind: triggerKind, query: triggerQuery, found: [], failed: true });
      }
    };
    // The bare `@` answers at once; a search waits for a pause in the typing.
    suggestTimer.current = setTimeout(() => void run(), triggerQuery === '' ? 0 : SEARCH_DEBOUNCE_MS);
    return (): void => {
      if (suggestTimer.current !== null) clearTimeout(suggestTimer.current);
    };
  }, [live, triggerKind, triggerQuery, organizationId, language]);

  // Every new search starts at its first result.
  useEffect(() => {
    setActive(0);
  }, [triggerKind, triggerQuery]);

  // Between a keystroke and its answer the list is the previous answer, narrowed
  // by what is in the field now: Enter never chooses somebody the typed letters
  // have already ruled out, and the list does not blink on every key.
  const answered = answer !== null && answer.kind === triggerKind && answer.query === triggerQuery;
  const suggestions = useMemo<Suggestion[]>(() => {
    if (answer === null || answer.kind !== triggerKind || triggerQuery === null) return [];
    if (answer.query === triggerQuery) return answer.found;
    const needle = foldDiacritics(triggerQuery).toLowerCase();
    return answer.found.filter((suggestion) =>
      [suggestion.label, suggestion.description ?? ''].some((text) =>
        foldDiacritics(text).toLowerCase().includes(needle),
      ),
    );
  }, [answer, triggerKind, triggerQuery]);
  const failed = answered && answer?.failed === true;
  // Typed on past the last match — "@home tomorrow" — is a sentence, not a search.
  const exhausted =
    answered && !failed && suggestions.length === 0 && triggerQuery !== null && /\s/.test(triggerQuery);
  const open = live && !exhausted;
  const listed = open && suggestions.length > 0;
  const activeIndex = Math.min(active, Math.max(suggestions.length - 1, 0));
  const listId = `${baseId}-suggestions`;
  const hintId = `${baseId}-shortcuts`;
  const optionId = (index: number): string => `${listId}-${index}`;
  const activeOptionId = listed ? optionId(activeIndex) : null;

  // The focus stays in the field, so nothing scrolls by itself: the option the
  // arrow keys reach is brought into view — within a list longer than its
  // window, and on the screen when the list opened below its edge.
  useEffect(() => {
    if (activeOptionId === null) return;
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionId]);

  const choose = (suggestion: Suggestion): void => {
    if (!trigger) return;
    const next = applyMention(value, trigger, suggestion.id);
    if (!fits(next.text)) return;
    pendingCaret.current = next.caret;
    onValueChange(next.text);
    setAnswer(null);
    setNotice(t(`references.inserted.${trigger.kind}`));
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !open) return;
    // An input method composing a character owns Enter, Tab, Escape and the
    // arrows until it is done: they confirm or move within what it composes.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      // Closes the list and nothing else: a dialog around the field stays open.
      event.preventDefault();
      event.stopPropagation();
      setDismissed(triggerStart);
      return;
    }
    if (!listed) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const chosen = suggestions[activeIndex];
      if (!chosen) return;
      event.preventDefault();
      choose(chosen);
    }
  };

  const shortcuts = [
    canPeople ? t('references.shortcut.person') : null,
    canOrders ? t('references.shortcut.order') : null,
    canProducts ? t('references.shortcut.product') : null,
  ].filter((item): item is string => item !== null);
  const anything = shortcuts.length > 0;
  const description = [describedBy, anything ? hintId : null].filter(Boolean).join(' ');
  const kindKey = triggerKind ? KIND_KEY[triggerKind] : 'person';

  return (
    <div className="space-y-2">
      <div className="relative">
        <Textarea
          {...rest}
          ref={field}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          {...(description ? { 'aria-describedby': description } : {})}
          {...(listed
            ? {
                role: 'combobox',
                'aria-expanded': true,
                'aria-haspopup': 'listbox' as const,
                'aria-autocomplete': 'list' as const,
                'aria-controls': listId,
                'aria-activedescendant': optionId(activeIndex),
              }
            : {})}
          onChange={(event): void => {
            onValueChange(event.target.value);
            setProblem(null);
            caret.current = { start: event.target.selectionStart, end: event.target.selectionEnd };
            setTypingAt(
              event.target.selectionStart === event.target.selectionEnd ? event.target.selectionStart : null,
            );
          }}
          onKeyDown={keyDown}
          onSelect={remember}
          onFocus={remember}
          onBlur={(): void => {
            const element = field.current;
            if (element) caret.current = { start: element.selectionStart, end: element.selectionEnd };
            setTypingAt(null);
          }}
        />

        {open ? (
          <div className="absolute left-0 top-full z-50 mt-1 w-full max-w-sm rounded-md border border-input bg-background p-1 text-sm shadow-md">
            <p className="px-2 py-1 text-xs text-muted-foreground">{t(`references.suggest.title.${kindKey}`)}</p>
            {listed ? (
              <ul
                id={listId}
                role="listbox"
                aria-label={t(`references.suggest.title.${kindKey}`)}
                className="max-h-60 overflow-y-auto"
              >
                {suggestions.map((suggestion, index) => (
                  <li
                    key={suggestion.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === activeIndex}
                    // The field keeps the focus: the list is its popup, not a stop of its own.
                    onMouseDown={(event): void => event.preventDefault()}
                    onMouseEnter={(): void => setActive(index)}
                    onClick={(): void => choose(suggestion)}
                    className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 sm:min-h-9 ${
                      index === activeIndex ? 'bg-accent text-accent-foreground' : ''
                    }`}
                  >
                    <span className="truncate">{suggestion.label}</span>
                    {suggestion.description ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{suggestion.description}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-1.5 text-muted-foreground">
                {failed
                  ? t('references.suggest.error')
                  : answered
                    ? t(`references.suggest.empty.${kindKey}`)
                    : tCore('common.state.loading')}
              </p>
            )}
          </div>
        ) : null}
      </div>

      {anything ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {canPeople ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
                disabled={disabled}
                aria-expanded={picker === 'admin_user'}
                aria-controls={`${baseId}-picker`}
                onClick={(): void => toggle('admin_user')}
              >
                <AtSign aria-hidden="true" className="size-4" />
                {t('references.insert.person')}
              </Button>
            ) : null}
            {canOrders ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
                disabled={disabled}
                aria-expanded={picker === 'order'}
                aria-controls={`${baseId}-picker`}
                onClick={(): void => toggle('order')}
              >
                <ShoppingCart aria-hidden="true" className="size-4" />
                {t('references.insert.order')}
              </Button>
            ) : null}
            {canProducts ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
                disabled={disabled}
                aria-expanded={picker === 'product'}
                aria-controls={`${baseId}-picker`}
                onClick={(): void => toggle('product')}
              >
                <Package aria-hidden="true" className="size-4" />
                {t('references.insert.product')}
              </Button>
            ) : null}
          </div>
          <p id={hintId} className="text-xs text-muted-foreground">
            <span>{t('references.shortcuts', { list: shortcuts.join(', ') })}</span>{' '}
            <span>{t('references.hint')}</span>
          </p>

          <div id={`${baseId}-picker`}>
            {picker === 'product' ? (
              <Suspense
                fallback={
                  <p className="text-sm text-muted-foreground">{tCore('common.state.loading')}</p>
                }
              >
                <ProductPicker
                  mode="select"
                  value={null}
                  onChange={(id): void => {
                    if (id) insert('product', id);
                  }}
                  ariaLabel={t('references.search.product')}
                  placeholder={t('references.search.productPlaceholder')}
                />
              </Suspense>
            ) : null}
            {picker === 'order' || picker === 'admin_user' ? (
              <Combobox<string>
                key={picker}
                ariaLabel={t(`references.search.${KIND_KEY[picker]}`)}
                options={options}
                value={null}
                onChange={(id): void => {
                  if (id) insert(picker, id);
                }}
                onSearchChange={(query): void => {
                  if (timer.current !== null) clearTimeout(timer.current);
                  timer.current = setTimeout(() => void search(picker, query), SEARCH_DEBOUNCE_MS);
                }}
                manualFilter
                loading={searching}
                placeholder={t(`references.search.${KIND_KEY[picker]}Placeholder`)}
                emptyMessage={
                  searchFailed
                    ? t('references.error.search')
                    : t(`references.search.${KIND_KEY[picker]}Empty`)
                }
              />
            ) : null}
          </div>

          {problem ? (
            <p role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          ) : null}
          {/*
            A polite live region, mounted before it has text. Not `role="status"`:
            the thread around this field owns the one status of its tab.
          */}
          <p aria-live="polite" className="sr-only">
            {notice}
          </p>
        </div>
      ) : null}
    </div>
  );
}
