import { type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CountrySelect } from '@/components/country-select';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Setting code whose JSON value holds the seller's company data. The Settings
 * page renders this with a structured field-by-field editor instead of a raw
 * JSON textarea (the value still round-trips as serialized JSON via the
 * draft text, so the page-level save logic is unchanged).
 */
export const SELLER_COMPANY_DATA_CODE = 'invoices.seller.company_data';

/** Ordered field list mirroring `sellerCompanyDataSchema` in @b2b/contracts. */
const FIELDS = [
  'legalName',
  'addressLine1',
  'addressLine2',
  'postalCode',
  'city',
  'country',
  'taxId',
  'bankName',
  'bankAccount',
  'swift',
  'email',
  'phone',
] as const;
type Field = (typeof FIELDS)[number];

function parse(text: string): Record<string, string> {
  if (text.trim() === '') return {};
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === 'object' ? (obj as Record<string, string>) : {};
  } catch {
    return {};
  }
}

interface Props {
  /** Current value as a serialized JSON string (the setting draft text). */
  value: string;
  /** Emits the next serialized JSON string. */
  onChange: (next: string) => void;
}

/**
 * Field-by-field editor for the seller company-data JSON setting. Each input
 * patches its key and the whole object is re-serialized so the existing
 * JSON-typed save path keeps working without changes.
 */
export function SellerCompanyDataInput({ value, onChange }: Props): ReactNode {
  const t = useTranslation('settings');
  const obj = parse(value);

  const setField = (field: Field, next: string): void => {
    const updated = { ...obj, [field]: next };
    onChange(JSON.stringify(updated));
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {FIELDS.map((field) => (
        <div key={field} className="space-y-1">
          <Label htmlFor={`seller-${field}`} className="text-xs">
            {t(`editor.sellerCompanyData.${field}`)}
          </Label>
          {field === 'country' ? (
            <CountrySelect
              id={`seller-${field}`}
              ariaLabel={t(`editor.sellerCompanyData.${field}`)}
              value={obj[field] ?? null}
              clearable
              onChange={(code): void => setField(field, code ?? '')}
            />
          ) : (
            <Input
              id={`seller-${field}`}
              value={obj[field] ?? ''}
              onChange={(e): void => setField(field, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
