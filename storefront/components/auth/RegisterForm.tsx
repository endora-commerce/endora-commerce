'use client';

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { CountryPicker } from '../../lib/dictionary/pickers/CountryPicker';
import { tForLocale } from '../../lib/i18n/messages';

type Translate = ReturnType<typeof tForLocale>;
type MessageKey = Parameters<Translate>[0];
import { format } from '../../lib/i18n/format';
import {
  INITIAL_REGISTER_FORM_STATE,
  type RegisterCompanyField,
  type RegisterFormState,
  type RegisterFormValues,
  type RegisterLookupState,
} from '../../lib/auth/register-form-state';

/**
 * The business registration form (feature 173,
 * `specs/173-registration-registry-lookup/contracts/storefront-ux.md`).
 *
 * One `useActionState` action serves both buttons, so **without JavaScript**
 * "Fetch company data" (`intent=lookup`, `formNoValidate`) posts the form and
 * the page comes back pre-filled, every value but the password kept, nothing in
 * the URL. **With JavaScript** the lookup runs in a transition through
 * `lookupAction` and fills the company fields in place; registration submits
 * from `onSubmit` inside a transition, as `RoleEditorForm` does, so React does
 * not reset what was typed after a refusal.
 *
 * Which button an Enter means (research R-10, decided in the designer review
 * T060): an Enter in a field clicks the form's *default* button, the first
 * submit button in tree order. When the lookup is on, that is a visually hidden
 * "register" button, out of the tab order and the accessibility tree, placed
 * before "Fetch company data" — so an Enter registers, with or without
 * JavaScript, as on every other form (Jakob's Law), and a buyer without
 * JavaScript no longer loses the password to a lookup they did not ask for.
 * With JavaScript an Enter in the tax ID field fetches instead (its own key
 * handler); without it, that Enter registers and the browser's validation
 * points at the first empty field, and the visible button still fetches.
 *
 * Accessibility: the outcome region is mounted empty, `role="status"` with
 * `aria-live="polite"`, after the tax ID row, so its text is announced when it
 * arrives (WCAG 4.1.3); focus stays on the control that started the lookup; a
 * refused registration is announced in a `role="alert"` region that takes focus.
 * A filled field says so in text, not colour alone.
 */

type CompanyValues = Pick<RegisterFormValues, 'organizationName' | 'taxId' | 'country' | RegisterCompanyField>;

const COMPANY_FIELDS: readonly RegisterCompanyField[] = ['organizationName', 'street', 'postalCode', 'city'];

function companyOf(values: RegisterFormValues): CompanyValues {
  return {
    organizationName: values.organizationName,
    taxId: values.taxId,
    country: values.country,
    street: values.street,
    postalCode: values.postalCode,
    city: values.city,
  };
}

/** The fields a found answer filled, as far as a returned state can tell. */
function filledOf(state: RegisterFormState): ReadonlySet<RegisterCompanyField> {
  const lookup = state.lookup;
  if (lookup?.status !== 'found' || lookup.noDetails || lookup.source === null) return new Set();
  return new Set(COMPANY_FIELDS.filter((field) => state.values[field] !== ''));
}

export type RegisterLookupAction = (input: {
  taxId: string;
  country: string;
}) => Promise<{ lookup: RegisterLookupState; company: Partial<RegisterFormValues> | null }>;

export function RegisterForm({
  locale,
  lookupEnabled,
  action,
  lookupAction,
  initialState = INITIAL_REGISTER_FORM_STATE,
  termsVersion = '2025-01',
}: {
  locale: string;
  lookupEnabled: boolean;
  action: (state: RegisterFormState, formData: FormData) => Promise<RegisterFormState>;
  lookupAction: RegisterLookupAction;
  initialState?: RegisterFormState;
  termsVersion?: string;
}): ReactNode {
  const t = tForLocale(locale);
  const [state, formAction] = useActionState(action, initialState);
  const [company, setCompany] = useState<CompanyValues>(() => companyOf(initialState.values));
  const [lookup, setLookup] = useState<RegisterLookupState | null>(initialState.lookup);
  const [filled, setFilled] = useState<ReadonlySet<RegisterCompanyField>>(() => filledOf(initialState));
  const [lookupPending, startLookup] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);
  const seen = useRef(state);

  // Every state after the first is an answer of the action: a lookup posted as
  // a form, or a refused registration. It re-seeds the company fields.
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    setCompany(companyOf(state.values));
    setLookup(state.lookup);
    setFilled(filledOf(state));
    if (state.error) errorRef.current?.focus();
  }, [state]);

  const runLookup = (): void => {
    if (lookupPending) return;
    const request = { taxId: company.taxId, country: company.country };
    startLookup(async () => {
      const answer = await lookupAction(request);
      setLookup(answer.lookup);
      if (answer.company) {
        const values = answer.company;
        setCompany((current) => ({ ...current, ...values }));
        setFilled(new Set(COMPANY_FIELDS.filter((field) => values[field] !== undefined)));
      }
    });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    // Only the visible button itself is a lookup: an Enter in a field arrives
    // with the hidden default "register" button as its submitter.
    if (lookupEnabled && submitter?.value === 'lookup') {
      runLookup();
      return;
    }
    const data = new FormData(event.currentTarget);
    data.set('intent', 'register');
    startTransition(() => formAction(data));
  };

  const onTaxIdKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!lookupEnabled || event.key !== 'Enter') return;
    event.preventDefault();
    runLookup();
  };

  /** A change of the number or the country makes the reference stale (the backend would ignore it anyway). */
  const setIdentity = (patch: Partial<Pick<CompanyValues, 'taxId' | 'country'>>): void => {
    setCompany((current) => ({ ...current, ...patch }));
    setLookup(null);
  };

  const setField = (field: RegisterCompanyField, value: string): void => {
    setCompany((current) => ({ ...current, [field]: value }));
    if (filled.has(field)) setFilled((current) => new Set([...current].filter((f) => f !== field)));
  };

  const messages = lookupEnabled ? lookupMessages(t, lookup) : [];
  const describedBy = lookupEnabled ? 'org-tax-hint org-lookup-status' : undefined;

  const companyField = (field: RegisterCompanyField, id: string, labelKey: MessageKey, maxLength: number): ReactNode => (
    <div className="b2b-auth__field">
      <label htmlFor={id}>{t(labelKey)}</label>
      <input
        id={id}
        name={field}
        required
        maxLength={maxLength}
        placeholder=" "
        value={company[field]}
        onChange={(event) => setField(field, event.target.value)}
        aria-describedby={filled.has(field) ? `${id}-filled` : undefined}
      />
      {filled.has(field) ? (
        <span id={`${id}-filled`} className="b2b-auth__filled">
          {t('auth.register.lookup.filledMark')}
        </span>
      ) : null}
    </div>
  );

  return (
    <form action={formAction} onSubmit={onSubmit} className="b2b-auth__form">
      <div
        ref={errorRef}
        tabIndex={-1}
        role="alert"
        className={state.error ? 'b2b-auth__error' : undefined}
      >
        {state.error?.message ?? null}
      </div>
      {lookupEnabled ? (
        // The form's default button (research R-10, T060): an Enter in any field
        // clicks the first submit button in tree order, and this one registers.
        // Hidden from sight, the tab order and assistive technology — the
        // visible "Create account" below is the one a person operates.
        <button type="submit" name="intent" value="register" tabIndex={-1} aria-hidden="true" className="sr-only">
          {t('auth.common.createAccount')}
        </button>
      ) : null}
      <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
        <legend style={{ fontWeight: 600 }}>{t('auth.register.organizationLegend')}</legend>
        <div className="b2b-auth__field">
          <label htmlFor="addr-country">{t('auth.register.country')}</label>
          <CountryPicker
            id="addr-country"
            name="country"
            required
            value={company.country}
            onChange={(event) => setIdentity({ country: event.target.value })}
          />
        </div>
        <div className={lookupEnabled ? 'b2b-auth__lookup' : undefined}>
          <div className="b2b-auth__field">
            <label htmlFor="org-tax">{t('auth.register.taxId')}</label>
            <input
              id="org-tax"
              name="taxId"
              required
              minLength={8}
              maxLength={32}
              placeholder=" "
              autoComplete="off"
              inputMode="text"
              value={company.taxId}
              onChange={(event) => setIdentity({ taxId: event.target.value })}
              onKeyDown={onTaxIdKeyDown}
              aria-describedby={describedBy}
              aria-invalid={(lookupEnabled && lookup?.status === 'invalid_tax_id') || undefined}
            />
          </div>
          {lookupEnabled ? (
            <button
              type="submit"
              name="intent"
              value="lookup"
              formNoValidate
              className="b2b-auth__secondary"
              aria-disabled={lookupPending || undefined}
              aria-busy={lookupPending || undefined}
              onClick={(event) => {
                if (lookupPending) event.preventDefault();
              }}
            >
              {lookupPending ? <Spinner /> : null}
              {lookupPending ? t('auth.register.lookup.loading') : t('auth.register.lookup.button')}
            </button>
          ) : null}
        </div>
        {lookupEnabled ? (
          // One block, so the hint sits closer to the tax ID than the next field
          // does (Law of Proximity) and the empty status region adds no gap. The
          // region is never `display: none` — a live region that is not rendered
          // when its text arrives is not reliably announced (WCAG 4.1.3).
          <div className="b2b-auth__lookup-help">
            <p id="org-tax-hint" className="b2b-auth__hint m-0">
              {t('auth.register.lookup.hint')}
            </p>
            <div id="org-lookup-status" role="status" aria-live="polite" className="b2b-auth__lookup-status">
              {messages.map((message) => (
                <p key={message} className="m-0">
                  {message}
                </p>
              ))}
            </div>
          </div>
        ) : null}
        {companyField('organizationName', 'org-name', 'auth.register.legalName', 255)}
        {companyField('street', 'addr-street', 'auth.register.street', 255)}
        <div className="b2b-auth__row">
          {companyField('postalCode', 'addr-postal', 'checkout.address.postalCode', 20)}
          {companyField('city', 'addr-city', 'checkout.address.city', 120)}
        </div>
        <input type="hidden" name="registryLookupId" value={lookup?.lookupId ?? ''} />
      </fieldset>
      <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
        <legend style={{ fontWeight: 600 }}>{t('auth.register.ownerLegend')}</legend>
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="user-first">{t('auth.field.firstName')}</label>
            <input
              id="user-first"
              name="firstName"
              required
              maxLength={120}
              placeholder=" "
              defaultValue={state.values.firstName}
            />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="user-last">{t('auth.field.lastName')}</label>
            <input
              id="user-last"
              name="lastName"
              required
              maxLength={120}
              placeholder=" "
              defaultValue={state.values.lastName}
            />
          </div>
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="user-email">{t('auth.field.email')}</label>
          <input
            id="user-email"
            name="email"
            type="email"
            required
            placeholder=" "
            defaultValue={state.values.email}
          />
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="user-password">{t('auth.field.newPasswordMin')}</label>
          {/* Never seeded: the password is not part of the form state. */}
          <input
            id="user-password"
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={256}
            placeholder=" "
            autoComplete="new-password"
          />
        </div>
      </fieldset>
      <input type="hidden" name="acceptedTermsVersion" value={termsVersion} />
      <div className="b2b-auth__actions">
        <button type="submit" name="intent" value="register">
          {t('auth.common.createAccount')}
        </button>
      </div>
    </form>
  );
}

/** The sentences the status region shows for one lookup outcome. */
const SOURCE_KEYS = {
  gus: 'auth.register.lookup.source.gus',
  mf: 'auth.register.lookup.source.mf',
  vies: 'auth.register.lookup.source.vies',
} as const satisfies Record<'gus' | 'mf' | 'vies', MessageKey>;

export function lookupMessages(t: Translate, lookup: RegisterLookupState | null): string[] {
  if (!lookup) return [];
  switch (lookup.status) {
    case 'found': {
      if (lookup.source === null) return [];
      if (lookup.noDetails) return [t('auth.register.lookup.noDetails')];
      const lines = [
        format(t('auth.register.lookup.found'), { source: t(SOURCE_KEYS[lookup.source]) }),
      ];
      const vat: MessageKey =
        lookup.vatStatus === 'active'
          ? 'auth.register.lookup.vat.active'
          : lookup.vatStatus === 'exempt'
            ? 'auth.register.lookup.vat.exempt'
            : lookup.vatStatus === 'not_registered'
              ? 'auth.register.lookup.vat.notRegistered'
              : 'auth.register.lookup.vat.unknown';
      lines.push(t(vat));
      if (lookup.activityStatus === 'ceased') lines.push(t('auth.register.lookup.ceased'));
      return lines;
    }
    case 'not_found':
      return [t('auth.register.lookup.notFound')];
    case 'unavailable':
      return [t('auth.register.lookup.unavailable')];
    case 'invalid_tax_id':
      return [t('auth.register.lookup.invalidTaxId')];
    case 'unsupported_country':
      return [t('auth.register.lookup.unsupportedCountry')];
    case 'rate_limited':
      return [t('auth.register.lookup.rateLimited')];
  }
}

function Spinner(): ReactNode {
  return (
    <svg
      className="b2b-spin"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
