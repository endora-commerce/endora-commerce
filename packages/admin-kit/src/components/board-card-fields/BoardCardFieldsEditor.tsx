import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { ApiError } from '../../lib/api-client.js';
import { useUnsavedChangesPrompt } from '../../lib/use-unsaved-changes-prompt.js';
import { Alert, AlertDescription } from '../../ui/alert.js';
import { Button } from '../../ui/button.js';
import { useTranslation } from '../../i18n/useTranslation.js';

/** What the editor needs of a field: its reference and which group it is offered in. */
export interface BoardCardFieldChoice {
  ref: string;
  source: 'builtin' | 'custom';
}

/**
 * What `load` and `save` answer — the shape CRM's and Tasks' board-card
 * endpoints already return, so a module passes its API call straight through.
 */
export interface BoardCardFieldsConfig<F extends BoardCardFieldChoice = BoardCardFieldChoice> {
  /** The stored choice, resolved, in order. */
  fields: readonly F[];
  /** The catalogue: every field that can be chosen. */
  available: readonly F[];
  /** The most fields a card shows. */
  maxFields: number;
}

/** The three lines that name the module's own record; the rest is the kit's `core` copy. */
export interface BoardCardFieldsEditorCopy {
  /** Under the *Shown on the card* heading — "The title is always shown." */
  titleAlways: string;
  /** The built-in group's heading — "Opportunity fields", "Task fields". */
  builtinGroup: string;
  /** In the custom group when the catalogue has none — and where to define one. */
  noCustom: string;
}

export interface BoardCardFieldsEditorProps<F extends BoardCardFieldChoice> {
  /** Reads the stored choice, the catalogue and the limit. */
  load: () => Promise<BoardCardFieldsConfig<F>>;
  /** Stores the references in order and answers the server's own result. */
  save: (refs: string[]) => Promise<BoardCardFieldsConfig<F>>;
  /** A field's name in the admin's language. */
  fieldLabel: (field: F) => string;
  copy: BoardCardFieldsEditorCopy;
}

type CardAction = 'up' | 'down' | 'remove' | 'add';

/** Where focus goes after an edit: the first enabled of `actions` on `field`'s controls. */
interface FocusIntent {
  field: string;
  actions: readonly CardAction[];
}

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((ref, index) => ref === b[index]);

const refsOf = (fields: readonly BoardCardFieldChoice[]): string[] => fields.map((field) => field.ref);

/**
 * Which fields a board card shows, and in what order — issue #1506 (UX audit
 * 2026-11-17, WORK-15). CRM (`specs/143-crm-sales-opportunities/` User Story
 * 19) and Tasks (`specs/165-task-management/` FR-022) each kept a copy, and a
 * fix to one (#512) had to be ported to the other by hand.
 *
 * Two lists: what the card shows, in its order, and what can be added. A field
 * is moved with *Move up* / *Move down* — buttons, so the order is set without
 * a drag (WCAG 2.2 SC 2.5.7) — and the limit is said before it is reached:
 * once the card is full, *Add* is disabled and the count says why.
 *
 * Focus stays with the field an operator is working on (WCAG 2.4.3): after a
 * move, on the moved row's control in that direction — or the other one where
 * the row reached an end; after a removal, on the row that took its place, or
 * on the field's own *Add* when none is left; after an add, on the next field
 * offered in its group, or on the added row.
 *
 * Nothing is stored until *Save*, and leaving with a choice not saved asks
 * first; the answer is the server's own, so a field that stopped existing
 * meanwhile is gone from both lists afterwards. The catalogue and the limit
 * come with `load`'s answer, because the server owns both and refuses a choice
 * over its limit.
 */
export function BoardCardFieldsEditor<F extends BoardCardFieldChoice>({
  load,
  save,
  fieldLabel,
  copy,
}: BoardCardFieldsEditorProps<F>): ReactNode {
  const t = useTranslation('core');
  const idBase = useId();
  const [config, setConfig] = useState<BoardCardFieldsConfig<F> | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const focusIntent = useRef<FocusIntent | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  // After the edit's render: the control the intent names, if it is there and enabled.
  useEffect(() => {
    const intent = focusIntent.current;
    if (intent === null) return;
    focusIntent.current = null;
    const controls = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('button[data-card-field]') ?? [])];
    for (const action of intent.actions) {
      const control = controls.find(
        (candidate) =>
          candidate.dataset['cardField'] === intent.field && candidate.dataset['cardAction'] === action && !candidate.disabled,
      );
      if (control) {
        control.focus();
        return;
      }
    }
  });

  const accept = useCallback((loaded: BoardCardFieldsConfig<F>): void => {
    setConfig(loaded);
    setChosen(refsOf(loaded.fields));
  }, []);

  const read = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    try {
      accept(await loadRef.current());
    } catch {
      setLoadFailed(true);
    }
  }, [accept]);

  useEffect(() => {
    void read();
  }, [read]);

  const dirty = config !== null && !sameOrder(chosen, refsOf(config.fields));
  // A choice not yet saved is asked about before a link leaves the screen (issue #512).
  useUnsavedChangesPrompt(dirty);

  const byRef = useMemo(() => new Map((config?.available ?? []).map((field) => [field.ref, field])), [config]);

  if (config === null) {
    return loadFailed ? (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('boardCardFields.error.load')}</span>
          <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void read()}>
            {t('common.action.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    ) : (
      <p role="status" className="text-sm text-muted-foreground">
        {t('common.state.loading')}
      </p>
    );
  }

  const shown = chosen.map((ref) => byRef.get(ref)).filter((field): field is F => field !== undefined);
  const addable = config.available.filter((field) => !chosen.includes(field.ref));
  const full = chosen.length >= config.maxFields;
  const shownId = `${idBase}-shown`;
  const availableId = `${idBase}-available`;

  const edit = (next: string[]): void => {
    setChosen(next);
    setError(null);
    setNotice('');
  };
  const move = (index: number, by: -1 | 1): void => {
    const next = [...chosen];
    const [ref] = next.splice(index, 1);
    if (ref === undefined) return;
    next.splice(index + by, 0, ref);
    focusIntent.current = { field: ref, actions: by < 0 ? ['up', 'down', 'remove'] : ['down', 'up', 'remove'] };
    edit(next);
  };
  const remove = (ref: string): void => {
    const next = chosen.filter((candidate) => candidate !== ref);
    const index = chosen.indexOf(ref);
    const neighbour = next[index] ?? next[index - 1];
    focusIntent.current = neighbour ? { field: neighbour, actions: ['remove'] } : { field: ref, actions: ['add'] };
    edit(next);
  };
  const add = (field: F): void => {
    const offered = addable.filter((candidate) => candidate.source === field.source);
    const index = offered.findIndex((candidate) => candidate.ref === field.ref);
    const neighbour = offered[index + 1] ?? offered[index - 1];
    // A full card disables every *Add*: the added row is then the only place left.
    focusIntent.current =
      neighbour && chosen.length + 1 < config.maxFields
        ? { field: neighbour.ref, actions: ['add'] }
        : { field: field.ref, actions: ['up', 'down', 'remove'] };
    edit([...chosen, field.ref]);
  };

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setNotice('');
    try {
      accept(await save(chosen));
      setNotice(t('boardCardFields.saved'));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.envelope.error.message : t('boardCardFields.error.save'));
    } finally {
      setSaving(false);
    }
  };

  const group = (source: BoardCardFieldChoice['source']): ReactNode => {
    const fields = addable.filter((field) => field.source === source);
    const everyOffered = config.available.some((field) => field.source === source);
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {source === 'builtin' ? copy.builtinGroup : t('boardCardFields.available.custom')}
        </h4>
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {everyOffered ? t('boardCardFields.available.allShown') : copy.noCustom}
          </p>
        ) : (
          <ul role="list" className="flex flex-wrap gap-2">
            {fields.map((field) => (
              <li key={field.ref}>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-8"
                  disabled={full || saving}
                  aria-label={t('boardCardFields.add', { field: fieldLabel(field) })}
                  data-card-field={field.ref}
                  data-card-action="add"
                  onClick={(): void => add(field)}
                >
                  <Plus aria-hidden="true" />
                  {fieldLabel(field)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="space-y-5">
      <section aria-labelledby={shownId} className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id={shownId} className="text-sm font-semibold">
            {t('boardCardFields.shown.title')}
          </h3>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('boardCardFields.shown.count', { count: chosen.length, max: config.maxFields })}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{copy.titleAlways}</p>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('boardCardFields.shown.empty')}</p>
        ) : (
          <ol aria-labelledby={shownId} className="divide-y rounded-md border">
            {shown.map((field, index) => (
              <li key={field.ref} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 break-words text-sm">
                  <span className="mr-2 tabular-nums text-muted-foreground">{index + 1}.</span>
                  {fieldLabel(field)}
                </span>
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                    disabled={index === 0 || saving}
                    aria-label={t('boardCardFields.moveUp', { field: fieldLabel(field) })}
                    data-card-field={field.ref}
                    data-card-action="up"
                    onClick={(): void => move(index, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                    disabled={index === shown.length - 1 || saving}
                    aria-label={t('boardCardFields.moveDown', { field: fieldLabel(field) })}
                    data-card-field={field.ref}
                    data-card-action="down"
                    onClick={(): void => move(index, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                    disabled={saving}
                    aria-label={t('boardCardFields.remove', { field: fieldLabel(field) })}
                    data-card-field={field.ref}
                    data-card-action="remove"
                    onClick={(): void => remove(field.ref)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby={availableId} className="space-y-3">
        <h3 id={availableId} className="text-sm font-semibold">
          {t('boardCardFields.available.title')}
        </h3>
        {full ? (
          <p className="text-sm text-muted-foreground">{t('boardCardFields.available.full', { max: config.maxFields })}</p>
        ) : null}
        {group('builtin')}
        {group('custom')}
      </section>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          className="min-h-11 sm:min-h-9"
          disabled={!dirty || saving}
          aria-busy={saving}
          onClick={(): void => void submit()}
        >
          {t('common.action.save')}
        </Button>
        {dirty && !saving ? (
          <Button variant="ghost" className="min-h-11 sm:min-h-9" onClick={(): void => edit(refsOf(config.fields))}>
            {t('boardCardFields.discard')}
          </Button>
        ) : null}
        {/* Mounted before it has text, so the confirmation is spoken reliably. */}
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      </div>
    </div>
  );
}
