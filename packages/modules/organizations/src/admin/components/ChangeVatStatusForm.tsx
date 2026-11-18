import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { AdminOrganization, AdminOrganizationDetail } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { ImmediateBadge } from '@endora-commerce/admin-kit/components';
import { Alert, AlertDescription, Button, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Issue #1468 (SALES-01, owner ruling OQ-1 = B) — an existing Organization's VAT status
 * correction, the one admin editor of it since the staged select left the page's one Save.
 *
 * - It applies immediately, and says so: the value decides the tax of every later order
 *   (`taxes.appliesToVatStatuses`), so it is not a change to leave staged beside unrelated ones.
 * - It sends the existing `PATCH /api/v1/admin/organizations/:id` with only `vatStatus` and
 *   `expectedUpdatedAt` — the audited `organization.admin_patch` Command, whose entry records
 *   the VAT codes before and after. No new Command and no contract change.
 * - Choosing the stored value sends nothing and says so.
 * - A version conflict is an alert in the dialog, and the page re-reads the Organization so the
 *   next attempt is made against what is stored.
 */

type VatStatus = AdminOrganizationDetail['vatStatus'];

const VAT_STATUSES: readonly VatStatus[] = ['vat_payer', 'vat_exempt', 'reverse_charge'];

export interface ChangeVatStatusFormProps {
  organizationId: string;
  currentVatStatus: VatStatus;
  /** The stored `updatedAt`, the PATCH's optimistic check. */
  expectedUpdatedAt?: string | undefined;
  /** `changed` is `false` when the chosen value was the stored one: nothing was sent. */
  onChanged: (changed: boolean) => void;
  /** The stored Organization moved on: the page re-reads it. */
  onStale: () => void;
  onCancel?: () => void;
}

export function ChangeVatStatusForm(props: ChangeVatStatusFormProps): ReactNode {
  const t = useTranslation('organizations');
  const prefix = useId();
  const [vatStatus, setVatStatus] = useState<VatStatus>(props.currentVatStatus);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fieldId = `${prefix}-vatStatus`;
  const explanationId = `${prefix}-explanation`;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    setRefusal(null);
    if (vatStatus === props.currentVatStatus) {
      props.onChanged(false);
      return;
    }
    setSaving(true);
    try {
      await apiClient.patch<{ data: AdminOrganization }>(`/api/v1/admin/organizations/${props.organizationId}`, {
        vatStatus,
        ...(props.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: props.expectedUpdatedAt } : {}),
      });
      setSaving(false);
      props.onChanged(true);
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
        setRefusal(t('changeVatStatus.error.conflict'));
        props.onStale();
      } else {
        setRefusal(err instanceof ApiError ? err.envelope.error.message : t('changeVatStatus.error.generic'));
      }
    }
  };

  return (
    <form className="grid gap-4" noValidate onSubmit={(e): void => void submit(e)}>
      <div className="grid gap-2">
        <ImmediateBadge className="ml-0 w-fit" />
        <p id={explanationId} className="text-sm text-muted-foreground">
          {t('changeVatStatus.explanation')}
        </p>
      </div>
      <div className="grid gap-1.5 md:max-w-sm">
        <Label htmlFor={fieldId}>{t('changeVatStatus.field.vatStatus')}</Label>
        <Select
          id={fieldId}
          value={vatStatus}
          aria-describedby={explanationId}
          disabled={saving}
          onChange={(e): void => setVatStatus(e.target.value as VatStatus)}
        >
          {VAT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`vatStatus.${status}`)}
            </option>
          ))}
        </Select>
      </div>
      {refusal ? (
        <Alert variant="destructive">
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {props.onCancel ? (
          <Button type="button" variant="outline" onClick={props.onCancel} disabled={saving}>
            {t('changeVatStatus.cancel')}
          </Button>
        ) : null}
        <Button type="submit" disabled={saving} aria-busy={saving}>
          {t('changeVatStatus.submit')}
        </Button>
      </div>
    </form>
  );
}
