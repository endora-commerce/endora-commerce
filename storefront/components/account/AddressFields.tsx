import type { ReactNode } from 'react';
import type { MessageKey } from '../../lib/i18n/messages';
import { CountryPicker } from '../../lib/dictionary/pickers/CountryPicker';

/**
 * The labelled address fields of the storefront (`specs/180-off-platform-complaints/` D-18;
 * design review R-2.3) — street, postcode, city, country and phone, and the company when
 * asked — extracted from `AddressForm` so the returns form reuses the same markup instead of
 * forking it (Constitution IX). Presentational and server-renderable: no state, no hooks; the
 * caller owns the form, the values and the messages.
 *
 * A field at fault carries `aria-invalid` and is described by its message under it, the
 * `AddressForm` pattern. `namePrefix` lets one form post two address-shaped groups.
 */
export type AddressFieldName = 'company' | 'street' | 'city' | 'postalCode' | 'country' | 'phone';

const ID_SUFFIX: Record<AddressFieldName, string> = {
  company: 'company',
  street: 'street',
  city: 'city',
  postalCode: 'postal',
  country: 'country',
  phone: 'phone',
};

export interface AddressFieldsProps {
  t: (key: MessageKey) => string;
  /** The ids are `{idPrefix}-street`, `{idPrefix}-city`, … and the messages `{id}-error`. */
  idPrefix: string;
  /** Prepended to every `name` (`returnAddress.` → `returnAddress.street`). */
  namePrefix?: string;
  defaults?: Partial<Record<AddressFieldName, string>>;
  errors?: Partial<Record<AddressFieldName, ReactNode>>;
  /** Render the optional company field first. */
  company?: boolean;
  /** The labels' keys, when a caller words a field otherwise. */
  companyLabel?: string;
  /** Render the phone field; off where the form asks for one phone elsewhere (180 R-2.3). */
  phone?: boolean;
}

export function AddressFields({
  t,
  idPrefix,
  namePrefix = '',
  defaults = {},
  errors = {},
  company = false,
  companyLabel,
  phone: withPhone = true,
}: AddressFieldsProps): ReactNode {
  const idOf = (field: AddressFieldName): string => `${idPrefix}-${ID_SUFFIX[field]}`;
  const nameOf = (field: AddressFieldName): string => `${namePrefix}${field}`;
  const fieldState = (field: AddressFieldName): { aria: Record<string, string | boolean>; note: ReactNode } => {
    const message = errors[field];
    const id = idOf(field);
    return message
      ? {
          aria: { 'aria-invalid': true, 'aria-describedby': `${id}-error` },
          note: (
            <p id={`${id}-error`} className="b2b-auth__error m-0">
              {message}
            </p>
          ),
        }
      : { aria: {}, note: null };
  };
  const value = (field: AddressFieldName): { defaultValue?: string } =>
    defaults[field] !== undefined ? { defaultValue: defaults[field] } : {};

  const companyState = fieldState('company');
  const street = fieldState('street');
  const city = fieldState('city');
  const postal = fieldState('postalCode');
  const country = fieldState('country');
  const phone = fieldState('phone');

  return (
    <>
      {company ? (
        <div className="b2b-auth__field">
          <label htmlFor={idOf('company')}>{companyLabel ?? t('returns.elsewhere.company')}</label>
          <input
            id={idOf('company')}
            name={nameOf('company')}
            maxLength={200}
            autoComplete="organization"
            placeholder=" "
            {...value('company')}
            {...companyState.aria}
          />
          {companyState.note}
        </div>
      ) : null}
      <div className="b2b-auth__field">
        <label htmlFor={idOf('street')}>{t('account.addresses.add.street')}</label>
        <input
          id={idOf('street')}
          name={nameOf('street')}
          required
          maxLength={255}
          autoComplete="street-address"
          placeholder=" "
          {...value('street')}
          {...street.aria}
        />
        {street.note}
      </div>
      <div className="b2b-auth__row">
        <div className="b2b-auth__field">
          <label htmlFor={idOf('city')}>{t('checkout.address.city')}</label>
          <input
            id={idOf('city')}
            name={nameOf('city')}
            required
            maxLength={120}
            autoComplete="address-level2"
            placeholder=" "
            {...value('city')}
            {...city.aria}
          />
          {city.note}
        </div>
        <div className="b2b-auth__field">
          <label htmlFor={idOf('postalCode')}>{t('checkout.address.postalCode')}</label>
          <input
            id={idOf('postalCode')}
            name={nameOf('postalCode')}
            required
            maxLength={20}
            autoComplete="postal-code"
            placeholder=" "
            {...value('postalCode')}
            {...postal.aria}
          />
          {postal.note}
        </div>
      </div>
      <div className={withPhone ? 'b2b-auth__row' : undefined}>
        <div className="b2b-auth__field">
          <label htmlFor={idOf('country')}>{t('account.addresses.add.country')}</label>
          <CountryPicker
            id={idOf('country')}
            name={nameOf('country')}
            required
            defaultValue={defaults.country ?? 'PL'}
            {...country.aria}
          />
          {country.note}
        </div>
        {withPhone ? (
          <div className="b2b-auth__field">
            <label htmlFor={idOf('phone')}>{t('checkout.address.phone')}</label>
            <input
              id={idOf('phone')}
              name={nameOf('phone')}
              type="tel"
              maxLength={32}
              autoComplete="tel"
              placeholder=" "
              {...value('phone')}
              {...phone.aria}
            />
            {phone.note}
          </div>
        ) : null}
      </div>
    </>
  );
}
