import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type {
  Address,
  AdminZoneProps,
  PayerCommercialTerms,
  RelatedPayerAddressScope,
  RelatedPayerLink,
} from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ConfirmDialog, ImmediateBadge, OrganizationPicker } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  EditorSection,
  Input,
  Label,
  Select,
  Switch,
} from '@endora-commerce/admin-kit/ui';
import { relatedPayersClient } from '../api.js';
import {
  errorMessage,
  payerCommercialTermsLabels,
  relatedPayerAddressScopeLabels,
  relatedPayerLinkOriginLabels,
  relatedPayerLinkStateLabels,
} from '../lib/labels.js';
import { endOfDayInstant, localDateOf, startOfDayInstant } from '../lib/window.js';
import { NewOrganizationFields, newOrganizationBody, useNewOrganizationFields } from '../components/NewOrganizationFields.js';

/**
 * The organization card's **Payers** section (`specs/182-related-payers/` FR-020 –
 * FR-022; RP-12: a section in `organization.detail.after`, no tab strip).
 *
 * Two lists — the payers of this Organization, and the Organizations it pays for — and,
 * for `related_payers:manage`, the operator's link actions: add an existing payer,
 * create a new payer Organization (registry-prefilled, with an optional first-user
 * invitation), change the commercial terms, the billing address restriction, the
 * validity window and the payer e-mails switch, deactivate / activate, revoke.
 *
 * Every action is an immediate audited write (FR-022): the section carries the
 * immediate-action marking and does **not** join the card's Save — it never touches the
 * `saveSession` the zone hands it.
 */
export type PayersPanelProps = AdminZoneProps<'organization.detail.after'>;

type Lists = { asBuyer: RelatedPayerLink[]; asPayer: RelatedPayerLink[] };

export function PayersPanel({ organizationId }: PayersPanelProps): ReactNode {
  const t = useTranslation('related_payers');
  const { hasPermission } = useAuth();
  const canManage = hasPermission('related_payers:manage');
  const canCreate = canManage && hasPermission('customers:manage');
  const [lists, setLists] = useState<Lists | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<RelatedPayerLink | null>(null);
  const [form, setForm] = useState<'add' | 'create' | null>(null);
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    relatedPayersClient
      .list(organizationId)
      .then((res) => {
        if (!cancelled) setLists(res.data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const run = useCallback(
    async (key: string, action: () => Promise<unknown>, done: string): Promise<boolean> => {
      setBusy(key);
      setError(null);
      setStatus(null);
      try {
        await action();
        setStatus(done);
        reload();
        return true;
      } catch (err) {
        setError(errorMessage(err, t('panel.error.write')));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [reload, t],
  );

  const row = (link: RelatedPayerLink, side: 'asBuyer' | 'asPayer'): ReactNode => {
    const name = side === 'asBuyer' ? link.payerName : link.buyerName;
    const live = link.state !== 'revoked';
    return (
      <li key={link.id} className="grid gap-1 border-b py-2 last:border-b-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{name}</span>
          {side === 'asBuyer' && link.payerTaxId ? (
            <span className="text-xs text-muted-foreground">{link.payerTaxId}</span>
          ) : null}
          <span className="rounded-md border px-2 py-0.5 text-xs">{relatedPayerLinkStateLabels.label(t, link.state)}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground sm:grid-cols-5">
          <div>
            <dt className="sr-only">{t('panel.field.addressScope')}</dt>
            <dd>{relatedPayerAddressScopeLabels.label(t, link.addressScope)}</dd>
          </div>
          <div>
            <dt className="sr-only">{t('panel.field.window')}</dt>
            <dd>
              {link.validFrom || link.validTo
                ? t('panel.window', { from: localDateOf(link.validFrom) || '…', to: localDateOf(link.validTo) || '…' })
                : t('panel.window.open')}
            </dd>
          </div>
          <div>
            <dt className="sr-only">{t('panel.field.terms')}</dt>
            <dd>{payerCommercialTermsLabels.label(t, link.commercialTerms)}</dd>
          </div>
          <div>
            <dt className="sr-only">{t('panel.field.origin')}</dt>
            <dd>{relatedPayerLinkOriginLabels.label(t, link.origin)}</dd>
          </div>
          <div>
            <dt className="sr-only">{t('panel.field.notifyPayerOnOrders')}</dt>
            <dd>{t(link.notifyPayerOnOrders ? 'panel.notify.on' : 'panel.notify.off')}</dd>
          </div>
        </dl>
        {canManage && live ? (
          <div className="flex flex-wrap items-center gap-2">
            <Label className="sr-only" htmlFor={`terms-${link.id}`}>
              {t('panel.field.terms')}
            </Label>
            <Select
              id={`terms-${link.id}`}
              value={link.commercialTerms}
              disabled={busy !== null}
              onChange={(event) =>
                void run(
                  link.id,
                  () => relatedPayersClient.update(link, { commercialTerms: event.target.value as PayerCommercialTerms }),
                  t('panel.status.saved', { name }),
                )
              }
            >
              {payerCommercialTermsLabels.options(t).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  link.id,
                  () => relatedPayersClient.update(link, { state: link.state === 'active' ? 'inactive' : 'active' }),
                  t('panel.status.saved', { name }),
                )
              }
            >
              {t(link.state === 'active' ? 'panel.actions.deactivate' : 'panel.actions.activate')}
            </Button>
            <WindowEditor
              link={link}
              disabled={busy !== null}
              onSave={(validFrom, validTo) =>
                run(link.id, () => relatedPayersClient.update(link, { validFrom, validTo }), t('panel.status.saved', { name }))
              }
            />
            <AddressEditor
              link={link}
              disabled={busy !== null}
              onSave={(addressScope) =>
                run(link.id, () => relatedPayersClient.update(link, { addressScope }), t('panel.status.saved', { name }))
              }
            />
            <div className="flex items-center gap-2">
              <Switch
                id={`notify-${link.id}`}
                checked={link.notifyPayerOnOrders}
                busy={busy === `notify-${link.id}`}
                disabled={busy !== null && busy !== `notify-${link.id}`}
                onCheckedChange={(next) =>
                  void run(
                    `notify-${link.id}`,
                    () => relatedPayersClient.update(link, { notifyPayerOnOrders: next }),
                    t('panel.status.saved', { name }),
                  )
                }
              />
              <Label htmlFor={`notify-${link.id}`} className="text-xs font-normal">
                {t('panel.field.notifyPayerOnOrders')}
              </Label>
            </div>
            <Button type="button" size="sm" variant="destructive" disabled={busy !== null} onClick={() => setRevoking(link)}>
              {t('panel.actions.revoke')}
            </Button>
          </div>
        ) : null}
      </li>
    );
  };

  const list = (side: 'asBuyer' | 'asPayer'): ReactNode => {
    const headingId = `${titleId}-${side}`;
    const links = lists?.[side] ?? [];
    return (
      <section aria-labelledby={headingId} className="grid gap-1">
        <h3 id={headingId} className="text-sm font-medium">
          {t(`panel.${side}.title`)}
        </h3>
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`panel.${side}.empty`)}</p>
        ) : (
          <ul>{links.map((link) => row(link, side))}</ul>
        )}
      </section>
    );
  };

  return (
    // Issue #1515 — a section of the organization detail's Commerce tab, like every other
    // `organization.detail.after` panel there: the host's card frames it (Common Region).
    <EditorSection
      id="payers"
      title={
        <>
          {t('panel.title')}
          <ImmediateBadge className="align-middle" />
        </>
      }
      description={t('panel.description')}
      contentClassName="grid gap-4"
    >
        {loadError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{t('panel.error.load')}</span>
              <Button type="button" variant="outline" size="sm" onClick={reload}>
                {t('panel.actions.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : lists === null ? (
          <p className="text-sm text-muted-foreground">{t('panel.loading')}</p>
        ) : (
          <>
            {list('asBuyer')}
            {list('asPayer')}
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setForm(form === 'add' ? null : 'add')}>
                  {t('panel.actions.add')}
                </Button>
                {canCreate ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setForm(form === 'create' ? null : 'create')}
                  >
                    {t('panel.actions.create')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {form === 'add' ? (
              <AddPayerForm
                organizationId={organizationId}
                busy={busy !== null}
                onSubmit={(body) =>
                  run(
                    'add',
                    () => relatedPayersClient.add(organizationId, body),
                    t('panel.status.added'),
                  ).then((ok) => ok && setForm(null))
                }
              />
            ) : null}
            {form === 'create' ? (
              <CreatePayerForm
                organizationId={organizationId}
                busy={busy !== null}
                run={run}
                onDone={() => setForm(null)}
              />
            ) : null}
          </>
        )}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      {revoking ? (
        <ConfirmDialog
          title={t('panel.revoke.title')}
          message={t('panel.revoke.message', { name: revoking.payerName })}
          confirmLabel={t('panel.revoke.confirm')}
          destructive
          busy={busy !== null}
          onCancel={() => setRevoking(null)}
          onConfirm={() =>
            void run(revoking.id, () => relatedPayersClient.revoke(revoking), t('panel.status.revoked')).then(() =>
              setRevoking(null),
            )
          }
        />
      ) : null}
    </EditorSection>
  );
}

function TermsSelect(props: { id: string; value: PayerCommercialTerms; onChange: (v: PayerCommercialTerms) => void }) {
  const t = useTranslation('related_payers');
  return (
    <div className="grid gap-1">
      <Label htmlFor={props.id}>{t('panel.field.terms')}</Label>
      <Select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value as PayerCommercialTerms)}>
        {payerCommercialTermsLabels.options(t).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** RP-15 — the operator's two dates, sent as the start / end of those days in their zone. */
function WindowFields(props: {
  id: string;
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
}): ReactNode {
  const t = useTranslation('related_payers');
  return (
    <div className="flex flex-wrap gap-3">
      <div className="grid gap-1">
        <Label htmlFor={`${props.id}-from`}>{t('panel.field.validFrom')}</Label>
        <Input
          id={`${props.id}-from`}
          type="date"
          value={props.from}
          onChange={(e) => props.onChange({ from: e.target.value, to: props.to })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${props.id}-to`}>{t('panel.field.validTo')}</Label>
        <Input
          id={`${props.id}-to`}
          type="date"
          value={props.to}
          min={props.from || undefined}
          onChange={(e) => props.onChange({ from: props.from, to: e.target.value })}
        />
      </div>
    </div>
  );
}

function windowInstants(range: { from: string; to: string }): { validFrom: string | null; validTo: string | null } {
  return { validFrom: startOfDayInstant(range.from), validTo: endOfDayInstant(range.to) };
}

/** A select's value for an address scope: `all`, or the one billing address's id. */
type AddressChoice = 'all' | (string & {});

function addressScopeOf(choice: AddressChoice): RelatedPayerAddressScope {
  return choice === 'all' ? { kind: 'all' } : { kind: 'one', billingAddressId: choice };
}

function addressLabel(address: Address): string {
  return `${address.recipientName} — ${address.street}, ${address.postalCode} ${address.city}`;
}

/** FR-021 — the payer's live billing addresses, loaded for the address restriction's choices. */
function useBillingAddresses(payerOrganizationId: string | null): { addresses: Address[] | null; failed: boolean } {
  const [state, setState] = useState<{ addresses: Address[] | null; failed: boolean }>({ addresses: null, failed: false });
  useEffect(() => {
    let cancelled = false;
    setState({ addresses: null, failed: false });
    if (!payerOrganizationId) return;
    relatedPayersClient
      .payerBillingAddresses(payerOrganizationId)
      .then((addresses) => {
        if (!cancelled) setState({ addresses, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ addresses: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [payerOrganizationId]);
  return state;
}

/**
 * FR-021 — which of the payer's billing addresses a link allows: all of them, or one.
 * An address the link names that is no longer live stays selectable, so opening the
 * editor never changes the link by itself.
 */
function AddressScopeSelect(props: {
  id: string;
  payerOrganizationId: string;
  value: AddressChoice;
  onChange: (next: AddressChoice) => void;
}): ReactNode {
  const t = useTranslation('related_payers');
  const { addresses, failed } = useBillingAddresses(props.payerOrganizationId);
  if (failed) return <p className="text-sm text-destructive">{t('panel.address.error')}</p>;
  if (addresses === null) return <p className="text-sm text-muted-foreground">{t('panel.address.loading')}</p>;
  if (addresses.length === 0 && props.value === 'all') {
    return <p className="text-sm text-muted-foreground">{t('panel.address.none')}</p>;
  }
  const stale = props.value !== 'all' && !addresses.some((address) => address.id === props.value);
  return (
    <div className="grid gap-1">
      <Label htmlFor={props.id}>{t('panel.field.billingAddress')}</Label>
      <Select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="all">{relatedPayerAddressScopeLabels.label(t, 'all')}</option>
        {addresses.map((address) => (
          <option key={address.id} value={address.id}>
            {addressLabel(address)}
          </option>
        ))}
        {stale ? <option value={props.value}>{relatedPayerAddressScopeLabels.label(t, 'one')}</option> : null}
      </Select>
    </div>
  );
}

function AddressEditor(props: {
  link: RelatedPayerLink;
  disabled: boolean;
  onSave: (addressScope: RelatedPayerAddressScope) => Promise<unknown>;
}): ReactNode {
  const t = useTranslation('related_payers');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<AddressChoice>(props.link.billingAddressId ?? 'all');
  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" disabled={props.disabled} onClick={() => setOpen(true)}>
        {t('panel.actions.editAddress')}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-label={t('panel.actions.editAddress')}
      onSubmit={(event) => {
        event.preventDefault();
        void props.onSave(addressScopeOf(choice)).then(() => setOpen(false));
      }}
    >
      <AddressScopeSelect
        id={`${id}-address`}
        payerOrganizationId={props.link.payerOrganizationId}
        value={choice}
        onChange={setChoice}
      />
      <Button type="submit" size="sm" disabled={props.disabled}>
        {t('panel.address.save')}
      </Button>
    </form>
  );
}

/** FR-021, RP-17 (b) — the link's payer e-mails (placed and cancelled orders), in a form. */
function NotifyCheckbox(props: { id: string; checked: boolean; onChange: (next: boolean) => void }): ReactNode {
  const t = useTranslation('related_payers');
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={props.id} checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <Label htmlFor={props.id} className="font-normal">
        {t('panel.field.notifyPayerOnOrders')}
      </Label>
    </div>
  );
}

function WindowEditor(props: {
  link: RelatedPayerLink;
  disabled: boolean;
  onSave: (validFrom: string | null, validTo: string | null) => Promise<unknown>;
}): ReactNode {
  const t = useTranslation('related_payers');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState({ from: localDateOf(props.link.validFrom), to: localDateOf(props.link.validTo) });
  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" disabled={props.disabled} onClick={() => setOpen(true)}>
        {t('panel.actions.editWindow')}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-label={t('panel.actions.editWindow')}
      onSubmit={(event) => {
        event.preventDefault();
        const { validFrom, validTo } = windowInstants(range);
        void props.onSave(validFrom, validTo).then(() => setOpen(false));
      }}
    >
      <WindowFields id={id} from={range.from} to={range.to} onChange={setRange} />
      <Button type="submit" size="sm" disabled={props.disabled}>
        {t('panel.window.save')}
      </Button>
    </form>
  );
}

function AddPayerForm(props: {
  organizationId: string;
  busy: boolean;
  onSubmit: (body: {
    payerOrganizationId: string;
    commercialTerms: PayerCommercialTerms;
    addressScope: RelatedPayerAddressScope;
    notifyPayerOnOrders: boolean;
    validFrom: string | null;
    validTo: string | null;
  }) => Promise<unknown>;
}): ReactNode {
  const t = useTranslation('related_payers');
  const id = useId();
  const [payer, setPayer] = useState<string | null>(null);
  const [terms, setTerms] = useState<PayerCommercialTerms>('buyer');
  const [address, setAddress] = useState<AddressChoice>('all');
  const [notify, setNotify] = useState(false);
  const [range, setRange] = useState({ from: '', to: '' });
  const choosePayer = (next: string | null) => {
    setPayer(next);
    setAddress('all');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!payer) return;
    void props.onSubmit({
      payerOrganizationId: payer,
      commercialTerms: terms,
      addressScope: addressScopeOf(address),
      notifyPayerOnOrders: notify,
      ...windowInstants(range),
    });
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-md border p-3" aria-label={t('panel.add.title')}>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-payer`}>{t('panel.field.payer')}</Label>
        <OrganizationPicker id={`${id}-payer`} value={payer} onChange={choosePayer} statusFilter={['active']} />
      </div>
      {payer && payer !== props.organizationId ? (
        <AddressScopeSelect id={`${id}-address`} payerOrganizationId={payer} value={address} onChange={setAddress} />
      ) : null}
      <TermsSelect id={`${id}-terms`} value={terms} onChange={setTerms} />
      <WindowFields id={`${id}-range`} from={range.from} to={range.to} onChange={setRange} />
      <NotifyCheckbox id={`${id}-notify`} checked={notify} onChange={setNotify} />
      <div>
        <Button type="submit" size="sm" disabled={props.busy || payer === null || payer === props.organizationId}>
          {t('panel.add.submit')}
        </Button>
      </div>
    </form>
  );
}

function CreatePayerForm(props: {
  organizationId: string;
  busy: boolean;
  run: (key: string, action: () => Promise<unknown>, done: string) => Promise<boolean>;
  onDone: () => void;
}): ReactNode {
  const t = useTranslation('related_payers');
  const id = useId();
  const organization = useNewOrganizationFields();
  const [inviteEmail, setInviteEmail] = useState('');
  const [terms, setTerms] = useState<PayerCommercialTerms>('buyer');
  const [notify, setNotify] = useState(false);
  const [range, setRange] = useState({ from: '', to: '' });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void props
      .run(
        'create',
        async () => {
          const res = await relatedPayersClient.createOrganization(props.organizationId, {
            organization: newOrganizationBody(organization.fields),
            link: { commercialTerms: terms, notifyPayerOnOrders: notify, ...windowInstants(range) },
          });
          if (inviteEmail.trim()) {
            await relatedPayersClient.inviteFirstUser(res.data.organizationId, inviteEmail.trim());
          }
        },
        t('panel.status.created'),
      )
      .then((ok) => ok && props.onDone());
  };

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-md border p-3" aria-label={t('panel.create.title')}>
      <NewOrganizationFields id={id} state={organization} />
      <TermsSelect id={`${id}-terms`} value={terms} onChange={setTerms} />
      <WindowFields id={`${id}-range`} from={range.from} to={range.to} onChange={setRange} />
      {/* A new Organization has no billing address yet, so its link allows all of them. */}
      <p className="text-sm text-muted-foreground">{t('panel.create.addressHint')}</p>
      <NotifyCheckbox id={`${id}-notify`} checked={notify} onChange={setNotify} />
      <div className="grid gap-1">
        <Label htmlFor={`${id}-inviteEmail`}>{t('panel.field.inviteEmail')}</Label>
        <Input id={`${id}-inviteEmail`} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required={false} />
      </div>
      <div>
        <Button type="submit" size="sm" disabled={props.busy}>
          {t('panel.create.submit')}
        </Button>
      </div>
    </form>
  );
}

/** The zone renderer loads a contribution through a dynamic-import factory and reads its default export. */
export default PayersPanel;
