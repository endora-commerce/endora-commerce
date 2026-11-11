import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Checkbox, Input, Label } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * A company Organization's tax-ID correction (issue #1040), shared by the
 * dialog on the Organization's page and the ⌘K action's screen.
 *
 * - The field starts on the stored tax ID: a correction is usually one
 *   mistyped character, so the operator edits rather than retypes.
 * - The value is normalised on blur — spaces and dashes removed, upper-cased —
 *   so a pasted `526-025-09-95` is accepted as typed and read back as stored
 *   (Postel).
 * - Errors are checked on submit, never on the first keystroke, linked to the
 *   field with `aria-describedby` and `aria-invalid`. A tax ID held elsewhere
 *   lands on the field; a refusal of the change itself is an alert above the
 *   actions.
 * - The VAT validation runs after the change commits and never undoes it
 *   (D-290 / OD-2). It is a `customers:manage` write, so it is offered only to
 *   an operator holding that code.
 */

export type TaxIdChangeVatOutcome = { outcome: string; provider: string | null } | null;

export interface ChangeTaxIdResult {
  data: { id: string; taxId: string | null };
  /** `false` when the value was already the stored one: nothing changed. */
  changed: boolean;
  vatValidation: TaxIdChangeVatOutcome;
}

export interface ChangeTaxIdFormProps {
  organizationId: string;
  currentTaxId: string | null;
  /** Whether the operator may run a VAT validation (`customers:manage`). */
  canValidate: boolean;
  onChanged: (result: ChangeTaxIdResult) => void;
  onCancel?: () => void;
}

/** The admin boundary's normalisation (`normalizeTaxId` in `@endora-commerce/contracts`). */
function normalizeTaxIdInput(value: string): string {
  return value.replace(/[\s-]+/g, '').toUpperCase();
}

export function ChangeTaxIdForm(props: ChangeTaxIdFormProps): ReactNode {
  const t = useTranslation('organizations');
  const prefix = useId();
  const [taxId, setTaxId] = useState(props.currentTaxId ?? '');
  const [validateTaxId, setValidateTaxId] = useState(props.canValidate);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fieldId = `${prefix}-taxId`;
  const errorId = `${prefix}-taxId-error`;
  const explanationId = `${prefix}-explanation`;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    const normalised = normalizeTaxIdInput(taxId);
    const found = !normalised
      ? t('changeTaxId.error.required')
      : normalised.length < 8 || normalised.length > 32
        ? t('changeTaxId.error.taxIdLength')
        : null;
    setError(found);
    setRefusal(null);
    if (found) return;
    setSaving(true);
    try {
      const result = await apiClient.post<ChangeTaxIdResult>(
        `/api/v1/admin/organizations/${props.organizationId}/change-tax-id`,
        { taxId: normalised, validateTaxId: props.canValidate && validateTaxId },
      );
      setSaving(false);
      props.onChanged(result);
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError && err.envelope.error.code === 'ORGANIZATION_TAX_ID_EXISTS') {
        setError(err.envelope.error.message);
      } else {
        setRefusal(err instanceof ApiError ? err.envelope.error.message : t('changeTaxId.error.generic'));
      }
    }
  };

  return (
    <form className="grid gap-4" noValidate onSubmit={(e): void => void submit(e)}>
      <p id={explanationId} className="text-sm text-muted-foreground">
        {t('changeTaxId.explanation')}
      </p>
      <div className="grid gap-1.5 md:max-w-sm">
        <Label htmlFor={fieldId}>{t('changeTaxId.field.taxId')}</Label>
        <Input
          id={fieldId}
          value={taxId}
          onChange={(e): void => setTaxId(e.target.value)}
          onBlur={(): void => setTaxId(normalizeTaxIdInput(taxId))}
          maxLength={40}
          autoComplete="off"
          {...(error ? { 'aria-invalid': 'true', 'aria-describedby': errorId } : {})}
        />
        {error ? (
          <p id={errorId} className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {props.canValidate ? (
        <label htmlFor={`${prefix}-validate`} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            id={`${prefix}-validate`}
            checked={validateTaxId}
            onChange={(e): void => setValidateTaxId((e.target as HTMLInputElement).checked)}
          />
          {t('changeTaxId.field.validate')}
        </label>
      ) : null}
      {refusal ? (
        <Alert variant="destructive">
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {props.onCancel ? (
          <Button type="button" variant="outline" onClick={props.onCancel} disabled={saving}>
            {t('changeTaxId.cancel')}
          </Button>
        ) : null}
        <Button type="submit" disabled={saving} aria-busy={saving}>
          {t('changeTaxId.submit')}
        </Button>
      </div>
    </form>
  );
}

/** The success line after a change: unchanged, or the VAT validation's outcome when one ran. */
export function taxIdChangeMessage(t: (key: string) => string, result: ChangeTaxIdResult): string {
  if (!result.changed) return t('changeTaxId.success.unchanged');
  const outcome = result.vatValidation?.outcome;
  if (!outcome) return t('changeTaxId.success.plain');
  const known = ['validated', 'invalid', 'deferred', 'failed'];
  return t(`changeTaxId.success.${known.includes(outcome) ? outcome : 'failed'}`);
}
