import { useMemo, useState, type ReactNode } from 'react';
import type {
  ConfigurationDto,
  ConfigurationTypeDescriptor,
  CreateConfiguration,
  FieldDefinition,
  UpdateConfiguration,
} from '@endora-commerce/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Dynamic create/edit form for a credential configuration (feature 058 US1).
 *
 * The type + provider pickers drive which fields render (from the descriptor's
 * `FieldDefinition[]`). Secret fields are write-only password inputs showing an
 * is-Set placeholder; a blank secret on edit preserves the stored value. Type,
 * provider and code are immutable once created.
 */
export interface ConfigurationFormProps {
  types: ConfigurationTypeDescriptor[];
  /** Present when editing an existing configuration. */
  existing?: ConfigurationDto | null;
  onCreate: (body: CreateConfiguration) => Promise<void>;
  onUpdate: (code: string, body: UpdateConfiguration) => Promise<void>;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
}

export function ConfigurationForm({
  types,
  existing,
  onCreate,
  onUpdate,
  onCancel,
  busy,
  error,
}: ConfigurationFormProps): ReactNode {
  const t = useTranslation('credentials');
  const isEdit = Boolean(existing);

  const [name, setName] = useState(existing?.name ?? '');
  const [code, setCode] = useState(existing?.code ?? '');
  const [typeCode, setTypeCode] = useState(existing?.typeCode ?? types[0]?.code ?? '');
  const descriptor = types.find((ty) => ty.code === typeCode);
  const [providerCode, setProviderCode] = useState(
    existing?.providerCode ?? descriptor?.providers[0]?.code ?? '',
  );
  const provider = descriptor?.providers.find((p) => p.code === providerCode);

  // Field values keyed by field key. Secret fields start blank (write-only);
  // non-secret fields prefill from the existing DTO.
  const initialValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of provider?.fields ?? []) {
      if (f.secret) continue;
      const dtoField = existing?.fields.find((x) => x.key === f.key);
      if (dtoField && 'value' in dtoField && dtoField.value !== undefined && dtoField.value !== null) {
        out[f.key] = String(dtoField.value);
      }
    }
    return out;
    // Recompute when the provider changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerCode, typeCode]);
  const [values, setValues] = useState<Record<string, string>>(initialValues);

  const secretIsSet = (key: string): boolean =>
    existing?.fields.find((x) => x.key === key)?.isSet === true;

  const setValue = (key: string, v: string): void => setValues((prev) => ({ ...prev, [key]: v }));

  const submit = async (): Promise<void> => {
    const payloadValues: Record<string, unknown> = {};
    for (const f of provider?.fields ?? []) {
      const raw = values[f.key];
      if (f.secret) {
        // Only send a secret when the operator typed a new one (write-only).
        if (raw && raw.length > 0) payloadValues[f.key] = raw;
        continue;
      }
      if (raw === undefined) continue;
      payloadValues[f.key] = coerce(f, raw);
    }

    if (isEdit && existing) {
      await onUpdate(existing.code, { name, values: payloadValues, expectedVersion: existing.version });
    } else {
      await onCreate({ code, name, typeCode, providerCode, values: payloadValues });
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cred-name">{t('form.name')}</Label>
          <Input id="cred-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cred-code">{t('form.code')}</Label>
          <Input
            id="cred-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={isEdit}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cred-type">{t('form.type')}</Label>
          <Select
            id="cred-type"
            value={typeCode}
            disabled={isEdit}
            onChange={(e) => {
              const next = e.target.value;
              setTypeCode(next);
              const nextProvider = types.find((ty) => ty.code === next)?.providers[0]?.code ?? '';
              setProviderCode(nextProvider);
              setValues({});
            }}
          >
            {types.map((ty) => (
              <option key={ty.code} value={ty.code}>
                {ty.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cred-provider">{t('form.provider')}</Label>
          <Select
            id="cred-provider"
            value={providerCode}
            disabled={isEdit}
            onChange={(e) => {
              setProviderCode(e.target.value);
              setValues({});
            }}
          >
            {(descriptor?.providers ?? []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        {(provider?.fields ?? []).map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`cred-field-${f.key}`}>
              {f.label}
              {f.required ? <span className="text-destructive"> *</span> : null}
            </Label>
            {renderField(f, values[f.key] ?? '', (v) => setValue(f.key, v), {
              secretPlaceholder: secretIsSet(f.key) ? t('form.secretSet') : t('form.secretUnset'),
              fieldId: `cred-field-${f.key}`,
            })}
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          {t('action.cancel')}
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {t('action.save')}
        </Button>
      </div>
    </div>
  );
}

function coerce(field: FieldDefinition, raw: string): unknown {
  if (field.kind === 'number') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (field.kind === 'boolean') return raw === 'true';
  return raw;
}

function renderField(
  field: FieldDefinition,
  value: string,
  onChange: (v: string) => void,
  opts: { secretPlaceholder: string; fieldId: string },
): ReactNode {
  if (field.secret) {
    return (
      <Input
        id={opts.fieldId}
        type="password"
        autoComplete="new-password"
        value={value}
        placeholder={opts.secretPlaceholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.kind === 'boolean') {
    return (
      <Select id={opts.fieldId} value={value || 'false'} onChange={(e) => onChange(e.target.value)}>
        <option value="false">false</option>
        <option value="true">true</option>
      </Select>
    );
  }
  if (field.kind === 'select') {
    return (
      <Select id={opts.fieldId} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <Input
      id={opts.fieldId}
      type={field.kind === 'number' ? 'number' : 'text'}
      value={value}
      placeholder={field.placeholder ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
