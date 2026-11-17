import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  CustomFieldAdminAccess,
  CustomFieldDefinitionDto,
  EditorSaveSessionHandle,
  SupportedEntityType,
} from '@endora-commerce/contracts';
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
import { INERT_SAVE_SESSION, useSaveParticipant } from '../../save-session/SaveSessionProvider.js';
import type { SaveParticipantHandlers } from '../../save-session/session-store.js';

export interface CustomFieldValuesPanelProps {
  entityType: SupportedEntityType;
  /** Current stored values for the host record. */
  values: Record<string, unknown>;
  /**
   * Persist the edited bag. Host owns the write (its own endpoint). A field the
   * operator cleared is in the bag as `null` (an empty string for text, an
   * empty array for a multiselect) — never `undefined`, which JSON would drop
   * and the server would read as "not edited". The bag carries only the keys of
   * `edit`-level definitions (feature 175) whose value the operator changed from
   * the one the panel loaded (issue #1007); every other stored value is left to
   * the server's merge. Forward the bag as it is. Omit it,
   * and pass `onChange`, to embed the fields in a form of the host's own: the
   * panel then renders no button and the host submits the bag with its form.
   */
  save?: (values: Record<string, unknown>) => Promise<void>;
  /**
   * Told the edited bag — its changed `edit`-level keys, as `save` is — on every
   * change. With no `save`, this is the only way the values leave the panel (the
   * embedded mode).
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
  /**
   * Feature 180 (FR-062, OQ-11 = A) — the host editor's save session. Given one, the panel
   * takes part in the page's one Save as a **host-owned section** (under the session's
   * `hostModule`) and renders no Save of its own: the page Save writes it through `save`,
   * after the host's own write. Without one, the panel is unchanged.
   */
  saveSession?: EditorSaveSessionHandle;
  /**
   * Show every field as a value with no input, as an `edit`-level definition is shown at `read`
   * — for an operator who may not write the host record (feature 180, WP-7: a page Save that
   * would never write the bag must not offer to edit it). `false` when omitted, as before.
   */
  readOnly?: boolean;
}

type Bag = Record<string, unknown>;

/** Whether two stored values are the same value (they are JSON on the wire). */
function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** The keys of `keys` whose value in `bag` differs from the one in `baseline`, with that value. */
function changedOf(bag: Bag, baseline: Bag, keys: ReadonlySet<string>): Bag {
  return Object.fromEntries(
    Object.entries(bag).filter(([key, value]) => keys.has(key) && !sameValue(value, baseline[key])),
  );
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
 *
 * **A cleared field is `null`, not `undefined`** (issue #176). The hosts send
 * the bag as JSON, which omits a key whose value is `undefined`, and the
 * server's merge reads an absent key as "not edited" and keeps the stored
 * value — so a cleared number, date or choice used to save successfully and
 * change nothing. `null` survives serialisation and is what the merge reads as
 * "clear this". It also lets a host tell a cleared field from an untouched one.
 *
 * **Admin access** (feature 175, `specs/175-buyer-input-custom-fields/` R-9). A
 * `read` definition renders as its value with no input; a `hidden` one is not
 * rendered. The bag handed to `save` and `onChange` is projected to the keys of
 * `edit` definitions, so a panel save never overwrites a value it did not let
 * the operator edit — including one an integration wrote after the page loaded:
 * the server's merge keeps every key absent from the patch. This is a panel
 * convenience, not access control; the API accepts every level. A refusal the
 * host reports for a non-`edit` field is shown at the top of the panel with the
 * field's label and level, since there is no input to show it at.
 *
 * **Only the changed keys** (issue #1007). Every host's write merges per key —
 * a key the request leaves out keeps the value it holds when the write commits
 * — but a key the request carries is written as the request has it. So the bag
 * is narrowed further, to the `edit` keys whose value differs from the one the
 * panel loaded (its baseline): an untouched key that another writer changed
 * after the page loaded is not written back stale. A cleared field differs from
 * a stored value, so it is still sent. The standalone panel moves its baseline
 * to what a successful save wrote, so the next save does not send those keys
 * again; under a page Save the session holds the baseline. A key edited back to
 * the loaded value is not sent.
 *
 * **Under a page Save** (feature 180, FR-062). With `saveSession` the edited bag lives in the
 * session, so it survives the panel unmounting, counts one change per edited `edit`-level key,
 * and is written by the page's Save through the host's `save` — the panel's own button is not
 * rendered. A refusal of that write shows at its field, as one from `fieldErrors` does.
 */
export function CustomFieldValuesPanel({
  entityType,
  values,
  save,
  onChange,
  fieldErrors,
  language = 'en',
  saveSession,
  readOnly = false,
}: CustomFieldValuesPanelProps): ReactNode {
  const t = useTranslation('core');
  const [defs, setDefs] = useState<CustomFieldDefinitionDto[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>(values);
  // What the standalone panel compares its draft against (issue #1007): the bag it loaded, then
  // what each successful save wrote. Under a page Save the session holds the baseline instead.
  const [baseline, setBaseline] = useState<Record<string, unknown>>(values);
  // The server's message when it sent one, otherwise the `core` key of the
  // translated fallback — resolved at render (issue #1433).
  const [error, setError] = useState<{ message: string | null; fallbackKey: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // Per-field refusals the host's own `save` answered with (feature 175) — only
  // the ones for a non-`edit` field are shown from here, since an editable
  // field's refusal is the host's to place through `fieldErrors`.
  const [saveRefusals, setSaveRefusals] = useState<Record<string, string>>({});

  // `readOnly` lowers every `edit` definition to `read`: shown, not editable, never in the bag.
  const levelOf = useCallback(
    (def: CustomFieldDefinitionDto): CustomFieldAdminAccess => {
      const level = accessOf(def);
      return readOnly && level === 'edit' ? 'read' : level;
    },
    [readOnly],
  );
  const editKeys = useMemo(
    () => new Set(defs.filter((d) => levelOf(d) === 'edit').map((d) => d.key)),
    [defs, levelOf],
  );
  // The bag that leaves the panel: the `edit` keys the operator changed from `from`.
  const project = useCallback(
    (bag: Record<string, unknown>, from: Record<string, unknown>): Record<string, unknown> =>
      changedOf(bag, from, editKeys),
    [editKeys],
  );

  // Feature 180 — the page-Save participation. The hook runs in both modes (hooks cannot be
  // conditional); with no session it is handed the inert handle and takes part in nothing.
  const inSession = saveSession !== undefined;
  // `loaded` seeds the session by identity, and a host may pass a fresh object each render.
  const valuesKey = JSON.stringify(values);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `valuesKey` is the bag's identity.
  const loaded = useMemo(() => values, [valuesKey]);
  const handlers = useMemo<SaveParticipantHandlers<Bag>>(
    () => ({
      changeCount: (next, baseline) => [...editKeys].filter((key) => !sameValue(next[key], baseline[key])).length,
      validate: async () => ({ fields: {} }),
      save: async (next, _ctx, from) => {
        if (save) await save(project(next, from));
        return next;
      },
    }),
    [editKeys, project, save],
  );
  const participant = useSaveParticipant<Bag>(
    saveSession ?? INERT_SAVE_SESSION,
    {
      key: 'custom-fields',
      label: t('customFields.title'),
      writable: inSession && save !== undefined && editKeys.size > 0,
      loaded,
    },
    handlers,
  );
  const current: Bag = inSession ? (participant.draft ?? values) : draft;
  const refusals: Readonly<Record<string, string>> = {
    ...(participant.issues?.fields ?? {}),
    ...(fieldErrors ?? {}),
  };

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
        if (live) {
          setError({
            message: err instanceof ApiError ? err.envelope.error.message : null,
            fallbackKey: 'customFields.loadFailed',
          });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [entityType]);

  const set = (key: string, value: unknown): void => {
    const next = { ...current, [key]: value };
    if (inSession) participant.setDraft((previous) => ({ ...previous, [key]: value }));
    else setDraft(next);
    onChange?.(project(next, inSession ? loaded : baseline));
  };

  const onSave = useCallback(async (): Promise<void> => {
    if (!save) return;
    setError(null);
    setSaveRefusals({});
    setSaving(true);
    try {
      const written = project(draft, baseline);
      await save(written);
      setBaseline((previous) => ({ ...previous, ...written }));
    } catch (err) {
      setError({
        message: err instanceof ApiError ? err.envelope.error.message : null,
        fallbackKey: 'customFields.saveFailed',
      });
      if (err instanceof ApiError) setSaveRefusals(refusalsOf(err.envelope.error.details));
    } finally {
      setSaving(false);
    }
  }, [baseline, draft, project, save]);

  const shown = defs.filter((d) => levelOf(d) !== 'hidden');
  const nonEditRefusals = defs.flatMap((d) => {
    const level = levelOf(d);
    if (level === 'edit') return [];
    const message = refusals[d.key] ?? saveRefusals[d.key];
    if (!message) return [];
    return [
      {
        key: d.key,
        text: t('customFields.nonEditableRefusal', {
          label: d.label[language] ?? d.labelDefault,
          level: t(`customFields.adminAccess.${level}`),
          message,
        }),
      },
    ];
  });

  // Nothing to show for this entity type — but only once the load has
  // answered. With `error` set, the same empty list means the load failed, and
  // the panel owes the operator the message rather than an absence. A type
  // whose every definition is `hidden` renders nothing either (feature 175).
  if (shown.length === 0 && error === null && nonEditRefusals.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('customFields.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error.message ?? t(error.fallbackKey)}</AlertDescription>
          </Alert>
        )}
        {nonEditRefusals.map((r) => (
          <Alert key={`refusal-${r.key}`} variant="destructive">
            <AlertDescription>{r.text}</AlertDescription>
          </Alert>
        ))}
        {shown.map((d) => {
          if (levelOf(d) === 'read') {
            return (
              <div key={d.id} className="space-y-1">
                <Label>{d.label[language] ?? d.labelDefault}</Label>
                <p id={`cf-${d.key}`} aria-readonly="true" className="text-sm">
                  {formatReadValue(d, current[d.key], language, t)}
                </p>
              </div>
            );
          }
          const fieldError = refusals[d.key];
          return (
            <div key={d.id} className="space-y-1">
              <Label htmlFor={`cf-${d.key}`}>
                {d.label[language] ?? d.labelDefault}
                {d.required && <span className="text-destructive"> *</span>}
              </Label>
              {renderInput(d, current[d.key], (v) => set(d.key, v), language)}
              {fieldError ? (
                <p role="alert" className="text-xs text-destructive">
                  {fieldError}
                </p>
              ) : null}
            </div>
          );
        })}
        {save && !inSession && editKeys.size > 0 && (
          <Button size="sm" disabled={saving} onClick={() => void onSave()}>
            {t('customFields.save')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const inputClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

/** `edit` for a definition read from a server that predates feature 175. */
function accessOf(def: CustomFieldDefinitionDto): CustomFieldAdminAccess {
  return def.adminAccess ?? 'edit';
}

/**
 * `{ [key]: sentence }` out of a `CUSTOM_FIELD_VALUE_INVALID` envelope's
 * details: the hosts' `{ path, issue }` entries, or `{ field, message }`.
 */
function refusalsOf(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) return {};
  const out: Record<string, string> = {};
  for (const entry of details as unknown[]) {
    if (entry && typeof entry === 'object') {
      const { path, issue, field, message } = entry as Record<string, unknown>;
      const key = typeof path === 'string' ? path : field;
      const sentence = typeof issue === 'string' ? issue : message;
      if (typeof key === 'string' && typeof sentence === 'string') out[key] = sentence;
    }
  }
  return out;
}

/** A `read` field's stored value as text — a dash when there is none. */
function formatReadValue(
  def: CustomFieldDefinitionDto,
  value: unknown,
  language: string,
  t: (key: string) => string,
): string {
  if (value === undefined || value === null || value === '') return '—';
  const optionLabel = (v: unknown): string => {
    const option = def.options.find((o) => o.value === v);
    return option ? (option.label[language] ?? option.labelDefault) : String(v);
  };
  switch (def.valueType) {
    case 'boolean':
      return value === true ? t('customFields.value.yes') : t('customFields.value.no');
    case 'select':
      return optionLabel(value);
    case 'multiselect':
      return Array.isArray(value) && value.length > 0 ? value.map(optionLabel).join(', ') : '—';
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

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
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <input
          id={`cf-${def.key}`}
          type="date"
          className={inputClass}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case 'select':
      return (
        <Select
          id={`cf-${def.key}`}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
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
