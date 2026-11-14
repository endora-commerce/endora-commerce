import type { ReactNode } from 'react';
import type { AddressSummary } from '../../lib/api/organization';
import { tForLocale, type MessageKey } from '../../lib/i18n/messages';
import { codeLabel } from '../../lib/account/labels';
import { ADDRESS_ERRORS } from '../../lib/account/address-errors';
import { ADDRESS_BOOK_STATUS, type AddressBookPath } from '../../lib/account/address-book';
import {
  createAddressAction,
  removeAddressAction,
  setDefaultAddressAction,
} from '../../lib/actions/addresses';
import { AddressForm } from './AddressForm';

/**
 * The one address book (`specs/173-b2c-address-book-merge/`, Principle IX): the
 * customer's Organization book, as `/addresses` shows it to a B2C customer and
 * `/organization/addresses` to a company member. The list, *Make default*,
 * *Remove* and the add form are the same on both, and every write goes to
 * `/api/v1/organizations/mine/addresses` — which checkout offers and writes
 * too, so the two always agree.
 *
 * A member whose role lacks `addresses.manage` reads the list without the
 * controls and gets one line saying why in place of the add form
 * (`specs/170-organization-roles/` WP-16; owner ruling of 2026-11-04). The API
 * is the gate.
 *
 * `status` and `error` are the codes the book's own actions redirect with; a
 * code the page does not know reads as the generic failure, and nothing else of
 * the URL reaches the page (issue #745).
 */
/**
 * Issue #663 — the row actions in the storefront's button classes, as on the
 * roles and members screens: a 44px target (Fitts's Law, WCAG 2.5.8), and
 * *Remove* in the role-deletion button's `border-bad text-bad`, its label
 * still naming it.
 */
const ROW_ACTION_CLASS = 'btn btn--outline btn--sm min-h-11';

export function AddressBook({
  heading,
  addresses,
  canManage,
  locale,
  returnTo,
  status,
  error,
}: {
  heading: MessageKey;
  addresses: readonly AddressSummary[];
  canManage: boolean;
  locale: string;
  returnTo: AddressBookPath;
  status?: string | undefined;
  error?: string | undefined;
}): ReactNode {
  const t = tForLocale(locale);
  const notice = status !== undefined && status in ADDRESS_BOOK_STATUS
    ? ADDRESS_BOOK_STATUS[status as keyof typeof ADDRESS_BOOK_STATUS]
    : null;
  const errorKey = ADDRESS_ERRORS.errorKey(error);

  return (
    <>
      <h2>{t(heading)}</h2>
      {notice ? <p className="b2b-auth__success">{t(notice)}</p> : null}
      {errorKey ? (
        <p className="b2b-auth__error" role="alert">
          {t(errorKey)}
        </p>
      ) : null}

      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>{t('account.addresses.col.kind')}</th>
            <th>{t('account.addresses.col.recipient')}</th>
            <th>{t('account.addresses.col.address')}</th>
            <th>{t('account.addresses.col.default')}</th>
            {canManage ? <th></th> : null}
          </tr>
        </thead>
        <tbody>
          {addresses.length === 0 ? (
            <tr>
              <td colSpan={canManage ? 5 : 4}>{t('account.addresses.empty')}</td>
            </tr>
          ) : (
            addresses.map((a) => (
              <tr key={a.id}>
                <td>{codeLabel(t, 'account.addressKind', a.kind)}</td>
                <td>{a.recipientName}</td>
                <td>
                  {a.street}, {a.postalCode} {a.city}, {a.country}
                </td>
                <td>
                  {a.isDefault ? (
                    t('account.addresses.isDefault')
                  ) : canManage ? (
                    <form action={setDefaultAddressAction} className="inline">
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button type="submit" className={ROW_ACTION_CLASS}>
                        {t('account.addresses.makeDefault')}
                      </button>
                    </form>
                  ) : null}
                </td>
                {canManage ? (
                  <td>
                    <form action={removeAddressAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <button type="submit" className={`${ROW_ACTION_CLASS} border-bad text-bad`}>
                        {t('account.common.remove')}
                      </button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {canManage ? (
        <>
          <h3>{t('account.addresses.add.heading')}</h3>
          <AddressForm action={createAddressAction} locale={locale} returnTo={returnTo} />
        </>
      ) : (
        <p className="b2b-auth__hint">{t('account.addresses.manageNotAllowed')}</p>
      )}
    </>
  );
}
