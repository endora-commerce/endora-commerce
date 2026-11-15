'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { tForLocale } from '../../lib/i18n/messages';
import { LIST_QUANTITY_MAX, parseListQuantity } from '../../lib/shoppingListQuantity';
import {
  NAME_FIELD,
  NAME_WAS_FIELD,
  isListNameValid,
  quantityField,
  quantityWasField,
} from '../../lib/account/shopping-list-edits';

type FormAction = (formData: FormData) => void | Promise<void>;

/** One line of the list, as the page resolved it. */
export interface ShoppingListEditorRow {
  id: string;
  quantity: number;
  note: string | null;
  /** The product cell — name, SKU and link — rendered by the server page. */
  product: ReactNode;
}

/**
 * The shopping-list page's one form (issue #1251): the list's name, every line quantity, one
 * *Save changes*, and the four conversions, which submit the same fields so the server action
 * saves what the buyer typed before converting it. Remove stays one immediate form per row,
 * declared beside the list form (a table cannot hold nested forms) and reached through the
 * button's `form` attribute; Clear stays its dialog on the page.
 *
 * It is a plain server-action form: without JavaScript every field still submits and the
 * server action validates. With it, the form says while there are unsaved edits, and holds a
 * submit with a refused value back in the browser — the field says why, carries
 * `aria-invalid`, and takes focus — so the other typed quantities are not lost to a round
 * trip. A refusal the server reported (`qtyErrorItemId`, `nameError`) is shown the same way
 * and focused when the page mounts.
 */
export function ShoppingListEditor({
  listId,
  locale,
  name: initialName,
  canEdit,
  canConvertToCart,
  canConvertToQuote,
  rows,
  qtyErrorItemId,
  nameError,
  heading,
  empty,
  saveListAction,
  removeAction,
  convertAllToCartAction,
  convertSelectedToCartAction,
  convertAllToRfqAction,
  convertSelectedToRfqAction,
}: {
  listId: string;
  /** The page language, from the server page that renders this. */
  locale: string;
  /** The list's name as the page shows it. */
  name: string;
  canEdit: boolean;
  canConvertToCart: boolean;
  canConvertToQuote: boolean;
  rows: ShoppingListEditorRow[];
  /** The line whose quantity the last submit refused, as the server reported it. */
  qtyErrorItemId: string | null;
  /** Whether the last submit was refused for an empty name. */
  nameError: boolean;
  /** The heading above the lines. */
  heading: ReactNode;
  /** What the page says in place of the table for a list with no lines. */
  empty: ReactNode;
  saveListAction: FormAction;
  removeAction: FormAction;
  convertAllToCartAction: FormAction;
  convertSelectedToCartAction: FormAction;
  convertAllToRfqAction: FormAction;
  convertSelectedToRfqAction: FormAction;
}): ReactNode {
  const t = tForLocale(locale);
  const shown = useMemo(
    () => Object.fromEntries(rows.map((row) => [row.id, String(row.quantity)])) as Record<string, string>,
    [rows],
  );
  const [name, setName] = useState(initialName);
  const [quantities, setQuantities] = useState<Record<string, string>>(shown);
  // What the server last showed. When it changes — after a Remove, a Save, another tab's
  // write — a field the buyer has not touched takes the new stored value, and a field they
  // typed in keeps what they typed; a removed row drops out (issue #1251).
  const [prevShown, setPrevShown] = useState(shown);
  const [prevName, setPrevName] = useState(initialName);
  if (prevShown !== shown || prevName !== initialName) {
    setPrevShown(shown);
    setPrevName(initialName);
    setQuantities((current) =>
      Object.fromEntries(
        rows.map((row) => {
          const typed = current[row.id];
          const untouched = typed === undefined || typed === prevShown[row.id];
          return [row.id, untouched ? shown[row.id]! : typed];
        }),
      ),
    );
    if (name === prevName) setName(initialName);
  }
  const [nameInvalid, setNameInvalid] = useState(nameError);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(
    () => new Set(qtyErrorItemId && rows.some((row) => row.id === qtyErrorItemId) ? [qtyErrorItemId] : []),
  );
  const nameRef = useRef<HTMLInputElement>(null);
  const quantityRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (qtyErrorItemId) quantityRefs.current.get(qtyErrorItemId)?.focus();
    else if (nameError) nameRef.current?.focus();
    // Once, on mount: the refusal the server rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canConvert = rows.length > 0 && (canConvertToCart || canConvertToQuote);
  const dirty =
    canEdit &&
    (name.trim() !== initialName || rows.some((row) => parseListQuantity(quantities[row.id]) !== row.quantity));

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    if (!canEdit) return;
    const badName = !isListNameValid(name);
    const badRows = rows.filter((row) => parseListQuantity(quantities[row.id]) === null).map((row) => row.id);
    if (!badName && badRows.length === 0) return;
    event.preventDefault();
    setNameInvalid(badName);
    setInvalid(new Set(badRows));
    if (badName) nameRef.current?.focus();
    else quantityRefs.current.get(badRows[0]!)?.focus();
  };

  const nameErrorId = 'sl-name-error';
  return (
    <>
      {/* `noValidate`: the browser's own bubbles speak the browser's language; the form and
          the action say what is wrong beside the field, in the page's (U4). */}
      <form id="sl-list" action={saveListAction} noValidate onSubmit={onSubmit}>
        <input type="hidden" name="listId" value={listId} />
        {canEdit ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="sl-name" className="text-sm text-fg-soft">
              {t('account.shoppingList.name.label')}
            </label>
            <input
              ref={nameRef}
              id="sl-name"
              name={NAME_FIELD}
              value={name}
              onChange={(event): void => {
                setName(event.target.value);
                setNameInvalid(false);
              }}
              required
              maxLength={160}
              {...(nameInvalid ? { 'aria-invalid': true, 'aria-describedby': nameErrorId } : {})}
              className="w-full rounded-md border border-line px-3 py-2 text-sm"
            />
            <input type="hidden" name={NAME_WAS_FIELD} value={initialName} />
            {/* Mounted empty so the live region exists before it carries text (WCAG 4.1.3). */}
            <p id={nameErrorId} role="status" className="m-0 text-[12px] font-semibold text-bad">
              {nameInvalid ? t('account.shoppingLists.nameRequired') : ''}
            </p>
          </div>
        ) : null}

        {heading}
        {rows.length === 0 ? (
          empty
        ) : (
          <table className="b2b-account__table">
            <thead>
              <tr>
                {canConvert ? <th></th> : null}
                <th>{t('account.common.product')}</th>
                <th>{t('account.common.quantity')}</th>
                <th>{t('account.shoppingList.col.note')}</th>
                {canEdit ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const errorId = `sl-qty-error-${row.id}`;
                const rowInvalid = invalid.has(row.id);
                return (
                  <tr key={row.id}>
                    {canConvert ? (
                      <td>
                        <input type="checkbox" name="itemIds" value={row.id} />
                      </td>
                    ) : null}
                    <td>{row.product}</td>
                    <td>
                      {canEdit ? (
                        <span className="inline-flex flex-col gap-1">
                          <input
                            ref={(el): void => {
                              if (el) quantityRefs.current.set(row.id, el);
                              else quantityRefs.current.delete(row.id);
                            }}
                            type="number"
                            name={quantityField(row.id)}
                            min={1}
                            max={LIST_QUANTITY_MAX}
                            value={quantities[row.id] ?? ''}
                            onChange={(event): void => {
                              const value = event.target.value;
                              setQuantities((current) => ({ ...current, [row.id]: value }));
                              setInvalid((current) => {
                                if (!current.has(row.id)) return current;
                                const next = new Set(current);
                                next.delete(row.id);
                                return next;
                              });
                            }}
                            aria-label={t('common.quantity')}
                            {...(rowInvalid ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})}
                            className="rounded-md border border-line px-2 py-1 text-sm"
                            style={{ width: '5rem' }}
                          />
                          <input type="hidden" name={quantityWasField(row.id)} value={String(row.quantity)} />
                          {/* Mounted empty on every row so the polite live region exists before it
                              carries text (WCAG 4.1.3), as on the cart line. */}
                          <p id={errorId} role="status" className="m-0 text-[12px] font-semibold text-bad">
                            {rowInvalid ? t('shoppingList.qty.invalid') : ''}
                          </p>
                        </span>
                      ) : (
                        row.quantity
                      )}
                    </td>
                    <td>{row.note ?? ''}</td>
                    {canEdit ? (
                      <td>
                        <button type="submit" form={`sl-remove-${row.id}`} className="btn btn--outline btn--sm">
                          {t('account.common.remove')}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* The Save comes first in the form, so Enter in a field saves rather than converts. */}
        {canEdit ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SubmitButton className={dirty ? 'btn btn--primary' : 'btn btn--outline'}>
              {t('account.shoppingList.save')}
            </SubmitButton>
            {/* Mounted empty so the live region exists before it carries text (WCAG 4.1.3). */}
            <p id="sl-unsaved" role="status" className="m-0 text-sm text-fg-soft">
              {dirty ? t(canConvert ? 'account.shoppingList.unsavedConvert' : 'account.shoppingList.unsaved') : ''}
            </p>
          </div>
        ) : null}

        {canConvert ? (
          <div className="mt-6 mb-10 flex flex-wrap gap-2">
            {canConvertToCart ? (
              <>
                <SubmitButton formAction={convertAllToCartAction} className="btn btn--primary">
                  {t('account.shoppingList.toCart.all')}
                </SubmitButton>
                <SubmitButton formAction={convertSelectedToCartAction} className="btn btn--outline">
                  {t('account.shoppingList.toCart.selected')}
                </SubmitButton>
              </>
            ) : null}
            {canConvertToQuote ? (
              <>
                <SubmitButton
                  formAction={convertAllToRfqAction}
                  className={canConvertToCart ? 'btn btn--outline' : 'btn btn--primary'}
                >
                  {t('account.shoppingList.toQuote.all')}
                </SubmitButton>
                <SubmitButton formAction={convertSelectedToRfqAction} className="btn btn--outline">
                  {t('account.shoppingList.toQuote.selected')}
                </SubmitButton>
              </>
            ) : null}
          </div>
        ) : null}
      </form>

      {canEdit
        ? rows.map((row) => (
            <form key={`remove-${row.id}`} id={`sl-remove-${row.id}`} action={removeAction}>
              <input type="hidden" name="listId" value={listId} />
              <input type="hidden" name="itemId" value={row.id} />
            </form>
          ))
        : null}
    </>
  );
}

/** A submit button of the list form, held while one of its submits is under way. */
function SubmitButton({
  formAction,
  className,
  children,
}: {
  formAction?: FormAction;
  className: string;
  children: ReactNode;
}): ReactNode {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      {...(formAction ? { formAction } : {})}
      disabled={pending}
      aria-busy={pending || undefined}
      className={className}
    >
      {children}
    </button>
  );
}
