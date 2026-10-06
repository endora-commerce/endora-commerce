import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Package, ShoppingCart } from 'lucide-react';
import {
  formatOpportunityReferenceToken,
  type OpportunityReferenceType,
} from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Button, Combobox, Textarea, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';

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
 * The codes of the two lists a reference is chosen from. They are their
 * owners' — `catalog`'s product list and `orders`' order list — and a role
 * without one is simply not offered that button (research N-H3).
 */
const PRODUCT_LIST_PERMISSION = 'catalog:read';
const ORDER_LIST_PERMISSION = 'orders:read';

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
 * The textarea of a description, a note or a message, with the two buttons
 * that put a reference into it (User Story 12, FR-044).
 *
 * A reference is a token in the text — `[[product:<id>]]`, `[[order:<id>]]` —
 * written by `formatOpportunityReferenceToken`, the one place the grammar
 * lives. *Insert product* and *Insert order* each open a search under the
 * field; choosing a result writes its token **where the caret was** and puts
 * the caret after it, so the sentence can simply be carried on. The token is
 * what is stored; once saved, the text is shown with the Product's current name
 * or the Order's number in its place.
 *
 * Only what the reader may search is offered: the product search needs
 * `catalog:read`, the order search `orders:read` and an Organization. With
 * neither, this is a plain textarea — and a token typed or pasted by hand is
 * resolved all the same.
 */
export function ReferenceTextarea(props: ReferenceTextareaProps): ReactNode {
  const { value, onValueChange, organizationId, maxLength, disabled, ...rest } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { hasPermission } = useAuth();
  const baseId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  /** Where the next token goes: the last selection the field had. */
  const caret = useRef<{ start: number; end: number } | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const [picker, setPicker] = useState<OpportunityReferenceType | null>(null);
  const [orders, setOrders] = useState<ComboboxOption<string>[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);

  const canProducts = hasPermission(PRODUCT_LIST_PERMISSION);
  const canOrders = hasPermission(ORDER_LIST_PERMISSION) && organizationId !== null;

  const remember = (): void => {
    const element = field.current;
    if (element) caret.current = { start: element.selectionStart, end: element.selectionEnd };
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
  }, [value]);

  const insert = (type: OpportunityReferenceType, id: string): void => {
    const token = formatOpportunityReferenceToken(type, id);
    const at = caret.current ?? { start: value.length, end: value.length };
    const next = `${value.slice(0, at.start)}${token}${value.slice(at.end)}`;
    if (typeof maxLength === 'number' && next.length > maxLength) {
      setProblem(t('references.error.tooLong'));
      return;
    }
    setProblem(null);
    pendingCaret.current = at.start + token.length;
    onValueChange(next);
    setPicker(null);
    setNotice(t(`references.inserted.${type}`));
  };

  const searchOrders = useCallback(
    async (query: string): Promise<void> => {
      if (organizationId === null) return;
      const current = ++sequence.current;
      setSearching(true);
      setSearchFailed(false);
      try {
        const found = await crmApi.searchOrders(organizationId, query);
        if (current === sequence.current) {
          setOrders(found.map((order) => ({ value: order.id, label: order.businessId })));
        }
      } catch {
        if (current === sequence.current) {
          setOrders([]);
          setSearchFailed(true);
        }
      } finally {
        if (current === sequence.current) setSearching(false);
      }
    },
    [organizationId],
  );

  useEffect(() => {
    if (picker === 'order') void searchOrders('');
    return (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [picker, searchOrders]);

  const toggle = (type: OpportunityReferenceType): void => {
    setProblem(null);
    setNotice('');
    setPicker((current) => (current === type ? null : type));
  };

  return (
    <div className="space-y-2">
      <Textarea
        {...rest}
        ref={field}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event): void => {
          onValueChange(event.target.value);
          setProblem(null);
        }}
        onSelect={remember}
        onBlur={remember}
      />

      {canProducts || canOrders ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
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
            <span className="text-xs text-muted-foreground">{t('references.hint')}</span>
          </div>

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
            {picker === 'order' ? (
              <Combobox<string>
                ariaLabel={t('references.search.order')}
                options={orders}
                value={null}
                onChange={(id): void => {
                  if (id) insert('order', id);
                }}
                onSearchChange={(query): void => {
                  if (timer.current !== null) clearTimeout(timer.current);
                  timer.current = setTimeout(() => void searchOrders(query), SEARCH_DEBOUNCE_MS);
                }}
                manualFilter
                loading={searching}
                placeholder={t('references.search.orderPlaceholder')}
                emptyMessage={
                  searchFailed ? t('references.error.search') : t('references.search.orderEmpty')
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
