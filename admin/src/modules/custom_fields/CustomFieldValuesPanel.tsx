import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import { customFieldsClient } from './api/custom-fields-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';
import type { CustomFieldDefinitionDto, SupportedEntityType } from '@endora-commerce/contracts';

export interface CustomFieldValuesPanelProps {
  entityType: SupportedEntityType;
  /** Current stored values for the host record. */
  values: Record<string, unknown>;
  /** Persist the edited bag. Host owns the write (its own endpoint). */
  save: (values: Record<string, unknown>) => Promise<void>;
}

/**
 * Reusable admin panel that renders custom-field value inputs for one host
 * record (feature 055). Fetches the entity type's definitions and maps each
 * `valueType` to a design-system input; the host page supplies `save`.
 */
export function CustomFieldValuesPanel({
  entityType,
  values,
  save,
}: CustomFieldValuesPanelProps): ReactNode {
  const t = useTranslation('core');
  const [defs, setDefs] = useState<CustomFieldDefinitionDto[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>(values);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const list = await customFieldsClient.list(entityType);
        if (live) setDefs(list);
      } catch (err) {
        if (live) setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
      }
    })();
    return () => {
      live = false;
    };
  }, [entityType]);

  const set = useCallback((key: string, value: unknown): void => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const onSave = useCallback(async (): Promise<void> => {
    setError(null);
    setSaving(true);
    try {
      await save(draft);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [draft, save]);

  if (defs.length === 0) return null; // nothing defined for this entity type

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('customFields.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {defs.map((d) => (
          <div key={d.id} className="space-y-1">
            <Label htmlFor={`cf-${d.key}`}>
              {d.label['en'] ?? d.labelDefault}
              {d.required && <span className="text-destructive"> *</span>}
            </Label>
            {renderInput(d, draft[d.key], (v) => set(d.key, v))}
          </div>
        ))}
        <Button size="sm" disabled={saving} onClick={() => void onSave()}>
          {t('customFields.save')}
        </Button>
      </CardContent>
    </Card>
  );
}

const inputClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

function renderInput(
  def: CustomFieldDefinitionDto,
  value: unknown,
  onChange: (v: unknown) => void,
): ReactNode {
  switch (def.valueType) {
    case 'boolean':
      return (
        <input
          id={`cf-${def.key}`}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'number':
      return (
        <input
          id={`cf-${def.key}`}
          type="number"
          className={inputClass}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <input
          id={`cf-${def.key}`}
          type="date"
          className={inputClass}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case 'select':
      return (
        <Select
          id={`cf-${def.key}`}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">—</option>
          {def.options.map((o) => (
            <option key={o.id ?? o.value} value={o.value}>
              {o.label['en'] ?? o.labelDefault}
            </option>
          ))}
        </Select>
      );
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {def.options.map((o) => (
            <label key={o.id ?? o.value} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, o.value]
                      : selected.filter((v) => v !== o.value),
                  )
                }
              />
              {o.label['en'] ?? o.labelDefault}
            </label>
          ))}
        </div>
      );
    }
    default:
      return (
        <input
          id={`cf-${def.key}`}
          className={inputClass}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
