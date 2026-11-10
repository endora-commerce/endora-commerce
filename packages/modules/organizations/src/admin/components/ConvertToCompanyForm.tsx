import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Checkbox, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { CountrySelect } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * The company details a personal Organization is converted with
 * (`specs/177-tax-id-scope/` FR-042; `contracts/admin-surfaces.md` §4.2), shared
 * by the dialog on the Organization's page and the standalone screen.
 *
 * - The company name starts empty: the personal Organization's name is a
 *   person's, not a company's.
 * - The tax ID is normalised on blur — spaces and dashes removed, upper-cased —
 *   so a pasted `526-025-09-95` is accepted as typed and read back as stored
 *   (Postel).
 * - Errors are checked on submit, never on the first keystroke, each linked to
 *   its field with `aria-describedby` and `aria-invalid`. A taken tax ID lands
 *   on the tax-ID field; a refusal of the conversion itself is an alert above
 *   the actions.
 * - The VAT validation runs after the conversion commits, so its checkbox is on
 *   by default and its outcome never undoes the conversion (D-290 / OD-2).
 */

export type ConversionVatOutcome = { outcome: string; provider: string | null } | null;

export interface ConvertToCompanyResult {
  data: { id: string; name: string; isPersonal: boolean };
  vatValidation: ConversionVatOutcome;
}

export interface ConvertToCompanyFormProps {
  organizationId: string;
  /** The country the registered-address picker starts on. */
  defaultCountry?: string | null;
  onConverted: (result: ConvertToCompanyResult) => void;
  onCancel?: () => void;
}

type FieldName = 'name' | 'taxId' | 'street' | 'postalCode' | 'city' | 'country';

const VAT_STATUSES = ['vat_payer', 'vat_exempt', 'reverse_charge'] as const;
type VatStatus = (typeof VAT_STATUSES)[number];

/** The admin boundary's normalisation (`normalizeTaxId` in `@endora-commerce/contracts`). */
function normalizeTaxIdInput(value: string): string {
  return value.replace(/[\s-]+/g, '').toUpperCase();
}

export function ConvertToCompanyForm(props: ConvertToCompanyFormProps): ReactNode {
  const t = useTranslation('organizations');
  const prefix = useId();
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [street, setStreet] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState<string | null>(
    props.defaultCountry && /^[A-Za-z]{2}$/.test(props.defaultCountry) ? props.defaultCountry.toUpperCase() : null,
  );
  const [vatStatus, setVatStatus] = useState<VatStatus>('vat_payer');
  const [validateTaxId, setValidateTaxId] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const id = (field: string): string => `${prefix}-${field}`;
  const errorId = (field: FieldName): string => `${prefix}-${field}-error`;

  const validate = (): Partial<Record<FieldName, string>> => {
    const required = t('convertToCompany.error.required');
    const found: Partial<Record<FieldName, string>> = {};
    if (!name.trim()) found.name = required;
    const normalised = normalizeTaxIdInput(taxId);
    if (!normalised) found.taxId = required;
    else if (normalised.length < 8 || normalised.length > 32) found.taxId = t('convertToCompany.error.taxIdLength');
    if (!street.trim()) found.street = required;
    if (!postalCode.trim()) found.postalCode = required;
    if (!city.trim()) found.city = required;
    if (!country) found.country = required;
    return found;
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    const found = validate();
    setErrors(found);
    setRefusal(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const result = await apiClient.post<ConvertToCompanyResult>(
        `/api/v1/admin/organizations/${props.organizationId}/convert-to-company`,
        {
          name: name.trim(),
          ...(legalName.trim() ? { legalName: legalName.trim() } : {}),
          taxId: normalizeTaxIdInput(taxId),
          registeredAddress: { street: street.trim(), city: city.trim(), postalCode: postalCode.trim(), country: country! },
          vatStatus,
          validateTaxId,
        },
      );
      setSaving(false);
      props.onConverted(result);
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError && err.envelope.error.code === 'ORGANIZATION_TAX_ID_EXISTS') {
        setErrors({ taxId: err.envelope.error.message });
      } else {
        setRefusal(err instanceof ApiError ? err.envelope.error.message : t('convertToCompany.error.generic'));
      }
    }
  };

  const describe = (field: FieldName, help?: string): Record<string, string> => {
    const ids = [errors[field] ? errorId(field) : null, help ?? null].filter(Boolean).join(' ');
    return {
      ...(ids ? { 'aria-describedby': ids } : {}),
      ...(errors[field] ? { 'aria-invalid': 'true' } : {}),
    };
  };

  const fieldError = (field: FieldName): ReactNode =>
    errors[field] ? (
      <p id={errorId(field)} className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null;

  const textField = (field: Exclude<FieldName, 'country'>, value: string, set: (v: string) => void, extra: Record<string, unknown> = {}): ReactNode => (
    <div className="grid gap-1.5">
      <Label htmlFor={id(field)}>{t(`convertToCompany.field.${field}`)}</Label>
      <Input id={id(field)} value={value} onChange={(e): void => set(e.target.value)} {...describe(field)} {...extra} />
      {fieldError(field)}
    </div>
  );

  return (
    <form className="grid gap-4" noValidate onSubmit={(e): void => void submit(e)}>
      <p className="text-sm text-muted-foreground">{t('convertToCompany.explanation')}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {textField('name', name, setName, { maxLength: 255 })}
        <div className="grid gap-1.5">
          <Label htmlFor={id('legalName')}>{t('convertToCompany.field.legalName')}</Label>
          <Input id={id('legalName')} value={legalName} onChange={(e): void => setLegalName(e.target.value)} maxLength={255} />
        </div>
      </div>
      <div className="grid gap-1.5 md:max-w-sm">
        <Label htmlFor={id('taxId')}>{t('convertToCompany.field.taxId')}</Label>
        <Input
          id={id('taxId')}
          value={taxId}
          onChange={(e): void => setTaxId(e.target.value)}
          onBlur={(): void => setTaxId(normalizeTaxIdInput(taxId))}
          maxLength={40}
          autoComplete="off"
          {...describe('taxId')}
        />
        {fieldError('taxId')}
      </div>
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">{t('convertToCompany.field.registeredAddress')}</legend>
        {textField('street', street, setStreet, { maxLength: 255, autoComplete: 'street-address' })}
        <div className="grid gap-3 md:grid-cols-3">
          {textField('postalCode', postalCode, setPostalCode, { maxLength: 20, autoComplete: 'postal-code' })}
          {textField('city', city, setCity, { maxLength: 120, autoComplete: 'address-level2' })}
          <div className="grid gap-1.5">
            <Label htmlFor={id('country')}>{t('convertToCompany.field.country')}</Label>
            <CountrySelect
              id={id('country')}
              ariaLabel={t('convertToCompany.field.country')}
              value={country}
              onChange={setCountry}
              disabled={saving}
            />
            {fieldError('country')}
          </div>
        </div>
      </fieldset>
      <div className="grid gap-1.5 md:max-w-xs">
        <Label htmlFor={id('vatStatus')}>{t('convertToCompany.field.vatStatus')}</Label>
        <Select id={id('vatStatus')} value={vatStatus} onChange={(e): void => setVatStatus(e.target.value as VatStatus)}>
          {VAT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`convertToCompany.vatStatus.${status}`)}
            </option>
          ))}
        </Select>
      </div>
      <label htmlFor={id('validate')} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          id={id('validate')}
          checked={validateTaxId}
          onChange={(e): void => setValidateTaxId((e.target as HTMLInputElement).checked)}
        />
        {t('convertToCompany.field.validate')}
      </label>
      {refusal ? (
        <Alert variant="destructive">
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {props.onCancel ? (
          <Button type="button" variant="outline" onClick={props.onCancel} disabled={saving}>
            {t('convertToCompany.cancel')}
          </Button>
        ) : null}
        <Button type="submit" disabled={saving} aria-busy={saving}>
          {t('convertToCompany.submit')}
        </Button>
      </div>
    </form>
  );
}
