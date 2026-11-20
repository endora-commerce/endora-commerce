import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, EditorSection, Label } from '@endora-commerce/admin-kit/ui';
import { OrganizationPicker, CustomerGroupPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { addressKindLabels } from '../lib/labels.js';

interface CommonProps {
  customerId: string;
  onChanged: () => void;
}

function useAction(onChanged: () => void): {
  busy: boolean;
  error: string | null;
  run: (fn: () => Promise<unknown>) => Promise<void>;
} {
  const t = useTranslation('customers');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        onChanged();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('detail.actionError'));
      } finally {
        setBusy(false);
      }
    },
    [onChanged, t],
  );
  return { busy, error, run };
}

/**
 * Issue #1517 (UX audit SALES-22) — the organization as a field of the Profile
 * tab's account section, not a card of its own holding one picker and one
 * button. The picker starts on the current organization; *Assign* is live
 * once another one is picked, and applies at once, like every control in that
 * section (its heading carries the `ImmediateBadge`). Mount it with
 * `key={organizationId}` so a re-read after the change resets the draft.
 */
export function OrganizationAssignmentField({
  customerId,
  organizationId,
  organizationName,
  onChanged,
}: CommonProps & { organizationId: string | null; organizationName: string | null }): ReactNode {
  const t = useTranslation('customers');
  const { busy, error, run } = useAction(onChanged);
  const [orgId, setOrgId] = useState<string | null>(organizationId);
  const label = t('detail.field.organization');

  return (
    <div className="space-y-2">
      <Label htmlFor="assign-org">{label}</Label>
      <div className="flex gap-2">
        <OrganizationPicker
          id="assign-org"
          value={orgId}
          onChange={setOrgId}
          ariaLabel={label}
          clearable={false}
          {...(organizationName === null ? {} : { selectedLabel: organizationName })}
          className="min-w-0 flex-1"
        />
        <Button
          variant="outline"
          disabled={busy || orgId === null || orgId === organizationId}
          aria-busy={busy}
          onClick={(): void => {
            if (!orgId) return;
            void run(() => apiClient.post(`/api/v1/admin/customers/${customerId}/organization`, { organizationId: orgId }));
          }}
        >
          {t('detail.org.assign')}
        </Button>
      </div>
      {organizationId ? (
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            disabled={busy}
            aria-describedby="assign-org-unassign-hint"
            onClick={(): void => void run(() => apiClient.delete(`/api/v1/admin/customers/${customerId}/organization`))}
          >
            {t('detail.org.unassign')}
          </Button>
          {/*
            D-178 — the operation moves the customer to their own personal
            organization rather than leaving them without one, and the button
            said "Unassign", which described the outcome it used to have.
          */}
          <p id="assign-org-unassign-hint" className="text-xs text-muted-foreground">
            {t('detail.org.unassignHint')}
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Issue #1517 — the customer group as a field beside the organization: the
 * picker starts on the current group and clears to "no group"; *Set* applies
 * whichever differs, at once. Mount it with `key={customerGroupId}`.
 */
export function CustomerGroupField({
  customerId,
  customerGroupId,
  onChanged,
}: CommonProps & { customerGroupId: string | null }): ReactNode {
  const t = useTranslation('customers');
  const { busy, error, run } = useAction(onChanged);
  const [groupId, setGroupId] = useState<string | null>(customerGroupId);
  const label = t('detail.field.group');

  return (
    <div className="space-y-2">
      <Label htmlFor="set-group">{label}</Label>
      <div className="flex gap-2">
        <CustomerGroupPicker
          id="set-group"
          value={groupId}
          onChange={setGroupId}
          ariaLabel={label}
          placeholder={t('detail.group.none')}
          className="min-w-0 flex-1"
        />
        <Button
          variant="outline"
          disabled={busy || groupId === customerGroupId}
          aria-busy={busy}
          onClick={(): void =>
            void run(() => apiClient.put(`/api/v1/admin/customers/${customerId}/customer-group`, { customerGroupId: groupId }))
          }
        >
          {t('detail.group.set')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One line of the addresses section — an Organization address or a refused personal-book row. */
interface AdminAddressLine {
  id: string;
  kind: 'delivery' | 'billing';
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

/** `GET /api/v1/admin/customers/:id/addresses` (`customerAddressBookSchema`). */
interface AdminCustomerAddressBook {
  organization: AdminAddressLine[];
  personal: Array<AdminAddressLine & { mergeRefusal?: string | null }>;
}

export function AddressesPanel({ customerId }: CommonProps): ReactNode {
  const t = useTranslation('customers');
  const [book, setBook] = useState<AdminCustomerAddressBook | null>(null);
  const [failed, setFailed] = useState(false);

  // `specs/173-b2c-address-book-merge/` (OD-6) — read-only. The card lists the
  // book the customer orders from, their Organization's, and then any
  // personal-book row the release-1 retirement job refused, with its reason.
  // There is no form: the personal book is retired, and admin editing of
  // Organization addresses is a separate follow-up.
  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<{ data: AdminCustomerAddressBook }>(
        `/api/v1/admin/customers/${customerId}/addresses`,
      );
      setBook(res.data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const line = (a: AdminAddressLine): ReactNode => (
    <>
      <span className="text-muted-foreground">{addressKindLabels.label(t, a.kind)}</span> · {a.recipientName} — {a.street}, {a.postalCode}{' '}
      {a.city}, {a.country}
      {a.isDefault ? ` (${t('detail.addresses.default')})` : ''}
    </>
  );

  return (
    <EditorSection title={t('detail.addresses.title')}>
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>{t('detail.panel.error')}</AlertDescription>
          </Alert>
        ) : null}
        {book ? (
          <>
            <section aria-labelledby="customer-addresses-organization" className="space-y-1">
              <h3 id="customer-addresses-organization" className="text-sm font-medium">
                {t('detail.addresses.organizationBook')}
              </h3>
              {book.organization.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('detail.addresses.empty')}</p>
              ) : (
                <ul className="divide-y text-sm">
                  {book.organization.map((a) => (
                    <li key={a.id} className="py-2">
                      {line(a)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {book.personal.length > 0 ? (
              <section aria-labelledby="customer-addresses-refused" className="space-y-1">
                <h3 id="customer-addresses-refused" className="text-sm font-medium">
                  {t('detail.addresses.refused')}
                </h3>
                <p className="text-sm text-muted-foreground">{t('detail.addresses.refusedHint')}</p>
                <ul className="divide-y text-sm">
                  {book.personal.map((a) => (
                    <li key={a.id} className="py-2">
                      {line(a)}
                      {a.mergeRefusal ? (
                        <span className="block text-xs text-muted-foreground">
                          {t('detail.addresses.refusalReason')}: <code>{a.mergeRefusal}</code>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
    </EditorSection>
  );
}
