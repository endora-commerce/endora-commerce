'use client';

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import { CountryPicker } from '../../lib/dictionary/pickers/CountryPicker';
import {
  ADDRESS_ERRORS,
  IDLE_ADDRESS_FORM,
  fieldErrorKey,
  type AddressField,
  type AddressFormState,
  type FieldError,
} from '../../lib/account/address-errors';
import type { AddressBookPath } from '../../lib/account/address-book';
import { CartSubmitButton } from '../CartSubmitButton';

/**
 * The add form of the one address book (`AddressBook`), on `/addresses` and on
 * `/organization/addresses` (`specs/173-b2c-address-book-merge/`; issues #745,
 * #792).
 *
 * A refused create answers as `useActionState` state ({@link AddressFormState})
 * — the refusal's code and, for each field at fault, why — instead of a
 * redirect with the API's sentence in `?error=`. The form keeps what was typed,
 * and nothing of it travels in a URL. Each field at fault says what is wrong
 * with it and what to do, in the store's language; the validator's own text is
 * never shown (`lib/account/address-errors.ts`).
 *
 * As in `RoleEditorForm`, the submit is dispatched from `onSubmit` inside a
 * transition: React resets a form's uncontrolled fields after an `action`-prop
 * submission, which is exactly the input a refused create must keep. `action`
 * stays set, so the form still posts without JavaScript.
 *
 * Accessibility: the announcement region (`role="alert"`) is mounted empty
 * before any refusal, so its text is announced when it arrives (WCAG 4.1.3).
 * Each field at fault carries `aria-invalid` and is described by its own
 * message; after a refusal focus moves to the first of them, or to the region.
 */
export function AddressForm({
  action,
  locale,
  returnTo,
  initialState = IDLE_ADDRESS_FORM,
}: {
  action: (state: AddressFormState, formData: FormData) => Promise<AddressFormState>;
  locale: string;
  /** The page the book is on, where a successful create lands. */
  returnTo: AddressBookPath;
  /** `useActionState`'s starting state — no refusal. */
  initialState?: AddressFormState;
}): ReactNode {
  const t = tForLocale(locale);
  const [state, formAction] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const answered = useRef(false);

  const errorKey = ADDRESS_ERRORS.errorKey(state.error ?? undefined);
  const invalid = new Map<AddressField, FieldError>(state.fields.map((error) => [error.field, error]));

  useEffect(() => {
    // The initial state is not an answer; every state after it is one.
    if (!answered.current) {
      answered.current = true;
      return;
    }
    if (!state.error) return;
    const first = state.fields[0]?.field;
    const target = first ? formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`) : null;
    (target ?? regionRef.current)?.focus();
  }, [state]);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  /** The `aria-*` a field carries, and the message under it when it is at fault. */
  const fieldState = (field: AddressField, id: string): { aria: Record<string, string | boolean>; note: ReactNode } => {
    const error = invalid.get(field);
    return error
      ? {
          aria: { 'aria-invalid': true, 'aria-describedby': `${id}-error` },
          note: (
            <p id={`${id}-error`} className="b2b-auth__error m-0">
              {t(fieldErrorKey(error))}
            </p>
          ),
        }
      : { aria: {}, note: null };
  };

  const kind = fieldState('kind', 'addr-kind');
  const recipient = fieldState('recipientName', 'addr-recipient');
  const street = fieldState('street', 'addr-street');
  const city = fieldState('city', 'addr-city');
  const postal = fieldState('postalCode', 'addr-postal');
  const country = fieldState('country', 'addr-country');
  const phone = fieldState('phone', 'addr-phone');

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="b2b-auth__form">
      <input type="hidden" name="returnTo" value={returnTo} />
      <div
        id="address-form-error"
        ref={regionRef}
        tabIndex={-1}
        role="alert"
        className={errorKey ? 'b2b-auth__error m-0 focus-visible:outline-2' : undefined}
      >
        {errorKey ? t(errorKey) : null}
      </div>
      <div className="b2b-auth__row">
        <div className="b2b-auth__field">
          <label htmlFor="addr-kind">{t('account.addresses.col.kind')}</label>
          <select id="addr-kind" name="kind" defaultValue="delivery" {...kind.aria}>
            <option value="delivery">{t('account.addressKind.delivery')}</option>
            <option value="billing">{t('account.addressKind.billing')}</option>
          </select>
          {kind.note}
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="addr-recipient">{t('account.addresses.col.recipient')}</label>
          <input
            id="addr-recipient"
            name="recipientName"
            required
            maxLength={160}
            autoComplete="name"
            placeholder=" "
            {...recipient.aria}
          />
          {recipient.note}
        </div>
      </div>
      <div className="b2b-auth__field">
        <label htmlFor="addr-street">{t('account.addresses.add.street')}</label>
        <input
          id="addr-street"
          name="street"
          required
          maxLength={255}
          autoComplete="street-address"
          placeholder=" "
          {...street.aria}
        />
        {street.note}
      </div>
      <div className="b2b-auth__row">
        <div className="b2b-auth__field">
          <label htmlFor="addr-city">{t('checkout.address.city')}</label>
          <input
            id="addr-city"
            name="city"
            required
            maxLength={120}
            autoComplete="address-level2"
            placeholder=" "
            {...city.aria}
          />
          {city.note}
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="addr-postal">{t('checkout.address.postalCode')}</label>
          <input
            id="addr-postal"
            name="postalCode"
            required
            maxLength={20}
            autoComplete="postal-code"
            placeholder=" "
            {...postal.aria}
          />
          {postal.note}
        </div>
      </div>
      <div className="b2b-auth__row">
        <div className="b2b-auth__field">
          <label htmlFor="addr-country">{t('account.addresses.add.country')}</label>
          <CountryPicker id="addr-country" name="country" required defaultValue="PL" {...country.aria} />
          {country.note}
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="addr-phone">{t('checkout.address.phone')}</label>
          <input
            id="addr-phone"
            name="phone"
            type="tel"
            maxLength={32}
            autoComplete="tel"
            placeholder=" "
            {...phone.aria}
          />
          {phone.note}
        </div>
      </div>
      <label>
        <input type="checkbox" name="isDefault" value="true" /> {t('account.addresses.add.makeDefault')}
      </label>
      <div className="b2b-auth__actions">
        <CartSubmitButton label={t('account.addresses.add.submit')} />
      </div>
    </form>
  );
}
