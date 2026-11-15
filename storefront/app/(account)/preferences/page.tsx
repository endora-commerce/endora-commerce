import type { ReactNode } from 'react';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { getMe } from '../../../lib/api/account';
import {
  listPaymentMethods,
  listDeliveryMethods,
  type DeliveryMethodSummary,
  type PaymentMethodSummary,
} from '../../../lib/api/methods';
import { listAddresses, type AddressSummary } from '../../../lib/api/organization';
import { getQuickOrderPreference, type QuickOrderPreference } from '../../../lib/api/quick-order';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { PREFERENCES_ERRORS } from '../../../lib/account/settings-errors';
import { organizationAreaAccess } from '../../../lib/account/organization-area';
import { saveOrderingPreferencesAction } from '../../../lib/actions/ordering-preferences';
import { tForLocale, type MessageKey } from '../../../lib/i18n/messages';
import { format } from '../../../lib/i18n/format';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Default ordering preferences (feature 039 / US2). Lets a customer set their
 * own default payment method, delivery method, billing address, and shipping
 * address. Each is optional — an empty selection inherits the organization
 * default. The selections are applied automatically at checkout and decide
 * whether one-click buying is offered.
 *
 * Issue #359:
 *  - the empty choice names the value it inherits, read from the
 *    Organization's row (every member may read it); when the row cannot be read
 *    it says only "use the organization default";
 *  - an Organization's *Administrator* — the reserved capability the API gates
 *    the organization scope on (`specs/170-organization-roles/` FR-012) — also
 *    sets the organization defaults, in a second form. A personal (B2C)
 *    Organization is not offered it: it is not a company, and its one member's
 *    own defaults already say the same thing (`lib/account/organization-area.ts`).
 *
 * The address choices are the Organization's book, the only one a default may
 * come from (issue #769, `specs/173-b2c-address-book-merge/`).
 */

type PreferenceField =
  | 'defaultPaymentMethodId'
  | 'defaultDeliveryMethodId'
  | 'defaultBillingAddressId'
  | 'defaultShippingAddressId';

interface Option {
  readonly id: string;
  readonly label: string;
}

interface FieldSpec {
  readonly name: PreferenceField;
  readonly label: MessageKey;
  readonly options: readonly Option[];
}

function localized(name: Record<string, string>, locale: string): string {
  return name[locale] ?? name['en-US'] ?? Object.values(name)[0] ?? '';
}

function addressLabel(a: AddressSummary): string {
  return `${a.recipientName} — ${a.street}, ${a.postalCode} ${a.city}, ${a.country}`;
}

function methodOptions(
  methods: readonly (PaymentMethodSummary | DeliveryMethodSummary)[],
  locale: string,
): Option[] {
  return methods.map((m) => ({ id: m.id, label: localized(m.name, locale) }));
}

export default async function PreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/preferences');
  const sp = await searchParams;
  const { locale, ctx } = await getServerContext();
  const t = tForLocale(locale);

  const [me, paymentMethods, deliveryMethods, deliveryAddresses, billingAddresses] =
    await Promise.all([
      getMe(session),
      // The buyer's defaults are chosen from what this channel offers.
      listPaymentMethods(ctx),
      listDeliveryMethods(ctx),
      listAddresses(session, 'delivery'),
      listAddresses(session, 'billing'),
    ]);

  const organizationId = me.customerAccount.organizationId ?? me.organization?.id ?? null;
  const managesOrganization = organizationAreaAccess(me, 'members') === 'allowed';
  const [own, organization] = await Promise.all([
    getQuickOrderPreference(session, 'customer', me.customerAccount.id).catch(() => null),
    // `undefined` — not known (no Organization, or the read failed); `null` — none set.
    organizationId
      ? getQuickOrderPreference(session, 'organization', organizationId).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  const fields: readonly FieldSpec[] = [
    {
      name: 'defaultPaymentMethodId',
      label: 'account.preferences.payment',
      options: methodOptions(paymentMethods, locale),
    },
    {
      name: 'defaultDeliveryMethodId',
      label: 'account.preferences.delivery',
      options: methodOptions(deliveryMethods, locale),
    },
    {
      name: 'defaultBillingAddressId',
      label: 'account.preferences.billingAddress',
      options: billingAddresses.map((a) => ({ id: a.id, label: addressLabel(a) })),
    },
    {
      name: 'defaultShippingAddressId',
      label: 'account.preferences.shippingAddress',
      options: deliveryAddresses.map((a) => ({ id: a.id, label: addressLabel(a) })),
    },
  ];

  /** What the buyer's empty choice stands for: the organization value, when this page can name it. */
  const inheritLabel = (field: FieldSpec): string => {
    if (organization === undefined) return t('account.preferences.inherit');
    const id = organization?.[field.name] ?? null;
    // A stored id this channel does not offer is not a usable default here, so it reads as none.
    const option = id ? field.options.find((o) => o.id === id) : undefined;
    return option
      ? format(t('account.preferences.inheritValue'), { value: option.label })
      : t('account.preferences.inheritNone');
  };

  const savedKey: MessageKey | null =
    sp.saved === 'organization'
      ? 'account.preferences.organization.saved'
      : sp.saved
        ? 'account.preferences.saved'
        : null;

  return (
    <>
      <h2>{t('account.preferences.heading')}</h2>
      <p className="b2b-auth__hint">{t('account.preferences.hint')}</p>

      {savedKey ? (
        <p className="b2b-auth__success" role="status">
          {t(savedKey)}
        </p>
      ) : null}
      {/* Issue #745 — `?error=` is a code; one this page does not know reads as its generic failure. */}
      {sp.error ? (
        <p className="b2b-auth__error" role="alert">
          {t(PREFERENCES_ERRORS.errorKey(sp.error)!)}
        </p>
      ) : null}

      <section aria-labelledby={managesOrganization ? 'preferences-own' : undefined}>
        {managesOrganization ? <h3 id="preferences-own">{t('account.preferences.own.heading')}</h3> : null}
        <PreferenceForm
          scope="customer"
          current={own}
          fields={fields}
          emptyLabel={inheritLabel}
          submit={t('account.preferences.submit')}
          t={t}
        />
      </section>

      {managesOrganization ? (
        <section aria-labelledby="preferences-organization" className="mt-8">
          <h3 id="preferences-organization">{t('account.preferences.organization.heading')}</h3>
          <p className="b2b-auth__hint">
            {format(t('account.preferences.organization.hint'), { organization: me.organization?.name ?? '' })}
          </p>
          <PreferenceForm
            scope="organization"
            current={organization ?? null}
            fields={fields}
            emptyLabel={() => t('account.preferences.organization.none')}
            submit={t('account.preferences.organization.submit')}
            t={t}
          />
        </section>
      ) : null}
    </>
  );
}

function PreferenceForm({
  scope,
  current,
  fields,
  emptyLabel,
  submit,
  t,
}: {
  scope: 'customer' | 'organization';
  current: QuickOrderPreference | null;
  fields: readonly FieldSpec[];
  emptyLabel: (field: FieldSpec) => string;
  submit: string;
  t: (key: MessageKey) => string;
}): ReactNode {
  return (
    <form action={saveOrderingPreferencesAction} className="b2b-auth__form">
      <input type="hidden" name="scope" value={scope} />
      {fields.map((field) => {
        // The buyer's form keeps the ids it always had; the organization's prefixes its own.
        const id = scope === 'customer' ? field.name : `organization-${field.name}`;
        return (
          <div className="b2b-auth__field" key={field.name}>
            <label htmlFor={id}>{t(field.label)}</label>
            <select id={id} name={field.name} defaultValue={current?.[field.name] ?? ''}>
              <option value="">{emptyLabel(field)}</option>
              {field.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      <div className="b2b-auth__actions">
        <button type="submit">{submit}</button>
      </div>
    </form>
  );
}
