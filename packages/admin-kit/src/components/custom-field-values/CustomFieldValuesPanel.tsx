import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CustomFieldDefinitionDto, SupportedEntityType } from '@endora-commerce/contracts';
// `apiClient` comes through the kit's published `lib` **barrel** rather than
// through `../../lib/api-client.js` — see the note in
// `../sales-channel-picker/SalesChannelPicker.tsx`: the barrel is the only
// spelling `vi.mock` can name from outside the package.
import { ApiError, apiClient } from '../../lib/index.js';
import { Alert, AlertDescription } from '../../ui/alert.js';
import { Button } from '../../ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.js';
import { Label } from '../../ui/label.js';
import { Select } from '../../ui/select.js';
import { useTranslation } from '../../i18n/useTranslation.js';

export interface CustomFieldValuesPanelProps {
  entityType: SupportedEntityType;
  /** Current stored values for the host record. */
  values: Record<string, unknown>;
  /**
   * Persist the edited bag. Host owns the write (its own endpoint). Omit it,
   * and pass `onChange`, to embed the fields in a form of the host's own: the
   * panel then renders no button and the host submits the bag with its form.
   */
  save?: (values: Record<string, unknown>) => Promise<void>;
  /**
   * Told the whole edited bag on every change. With no `save`, this is the
   * only way the values leave the panel (the embedded mode).
   */
  onChange?: (values: Record<string, unknown>) => void;
  /**
   * A refusal per field, keyed by definition key, shown at that field. The
   * host owns the write, so the host is who learns which field was refused.
   */
  fieldErrors?: Readonly<Record<string, string>>;
  /**
   * The language field and option labels are shown in, falling back to the
   * definition's default label. `en` when omitted, as before the prop existed.
   */
  language?: string;
}

/**
 * Reusable admin panel that renders custom-field value inputs for one host
 * record (feature 055). Fetches the entity type's definitions and maps each
 * `valueType` to a design-system input; the host page supplies `save`.
 *
 * **It is a published component, not a zone contribution** (feature 091, P4e;
 * `admin-component-contribution.md` §9.1). Its props are
 * `(entityType, values, save)` — data in, edited data back — so each of its four
 * call sites hands it the **host's own** stored bag and the host's own writer:
 * `customFieldValues` is a column on the host's row and the host owns the
 * endpoint that writes it, `quote_requests`' optimistic-concurrency header
 * included. Principle XIV working as designed is what puts it there. So the
 * reach was never *"the owner mounts its screen fragment in the consumer's
 * screen"* — nothing here is the owner's code.
 *
 * **The request is built here**, on P2's terms: one `GET` for the definitions,
 * off the published `apiClient` and the owner's contract types, which both sides
 * already compile. No admin API client of another module's crosses the seam, and
 * the two strings come out of `core`, so R6 (as R-1 reads it) is satisfied by
 * construction rather than by exception.
 *
 * **A failed definitions load is not an empty entity type.** The
 * `defs.length === 0` return below used to sit **above** the error `Alert`, so
 * the panel rendered nothing either way and an operator could not tell a broken
 * request from "no custom fields are defined for this entity type". The empty
 * return is now conditional on the load having actually answered.
 *
 * The old ordering was argued to be accidentally right for one case — a 503
 * from a switched-off `custom_fields` — and that case does not exist.
 * `custom_fields` declares `activation.nonDeactivatable`, which since issue #258
 * makes it a **required** module: `requiredModulesFrom` puts it in the
 * composition's required set, `composeModules` refuses a composition that would
 * reach its boot phase without it, and D-69 refuses every disable and every
 * uninstall. A platform that cannot serve this endpoint does not boot, so
 * `MODULE_DISABLED` is unreachable here and there is no branch to preserve for
 * it.
 *
 * **Embedded mode** (feature 143). A create form has no record to save a bag
 * against, and a second button inside a form is a second way to submit half of
 * it. With `onChange` and no `save` the panel is the same fields and no
 * button: the host keeps the bag and sends it with its own request.
 * `fieldErrors` and `language` are optional in both modes and change nothing
 * for a caller that passes neither.
 */
export function CustomFieldValuesPanel({
  entityType,
  values,
  save,
  onChange,
  fieldErrors,
  language = 'en',
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
        const res = await apiClient.get<{ data: CustomFieldDefinitionDto[] }>(
          `/api/v1/admin/custom-fields/definitions?entityType=${entityType}`,
        );
        if (live) {
          setDefs(res.data);
          // A previous entity type's failure must not outlive the read that
          // succeeded — it is now the thing that decides the empty branch below.
          setError(null);
        }
      } catch (err) {
        if (live) setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
      }
    })();
    return () => {
      live = false;
    };
  }, [entityType]);

  const set = (key: string, value: unknown): void => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onChange?.(next);
  };

  const onSave = useCallback(async (): Promise<void> => {
    if (!save) return;
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

  // Nothing defined for this entity type — but only once the load has answered.
  // With `error` set, the same empty `defs` means the load failed, and the panel
  // owes the operator the message rather than an absence.
  if (defs.length === 0 && error === null) return null;

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
        {defs.map((d) => {
          const fieldError = fieldErrors?.[d.key];
          return (
            <div key={d.id} className="space-y-1">
              <Label htmlFor={`cf-${d.key}`}>
                {d.label[language] ?? d.labelDefault}
                {d.required && <span className="text-destructive"> *</span>}
              </Label>
              {renderInput(d, draft[d.key], (v) => set(d.key, v), language)}
              {fieldError ? (
                <p role="alert" className="text-xs text-destructive">
                  {fieldError}
                </p>
              ) : null}
            </div>
          );
        })}
        {save && defs.length > 0 && (
          <Button size="sm" disabled={saving} onClick={() => void onSave()}>
            {t('customFields.save')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const inputClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

function renderInput(
  def: CustomFieldDefinitionDto,
  value: unknown,
  onChange: (v: unknown) => void,
  language: string,
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
              {o.label[language] ?? o.labelDefault}
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
              {o.label[language] ?? o.labelDefault}
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
