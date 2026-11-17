import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import type { TaskBoardCardConfig, TaskBoardCardField } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';
import { boardFieldLabel } from './TaskCard.js';

type CardAction = 'up' | 'down' | 'remove' | 'add';

/** Where focus goes after an edit: the first enabled of `actions` on `field`'s controls. */
interface FocusIntent {
  field: string;
  actions: readonly CardAction[];
}

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((ref, index) => ref === b[index]);

/**
 * Which fields a Task board card shows, and in what order
 * (`specs/165-task-management/` FR-022, research R-11) — CRM's editor
 * (`specs/143-crm-sales-opportunities/` User Story 19), the model, on the
 * Task workflow screen.
 *
 * Two lists: what the card shows, in its order, and what can be added. A field
 * is moved with *Move up* / *Move down* — buttons, so the order is set without
 * a drag (WCAG 2.2 SC 2.5.7) — and the limit is said before it is reached:
 * once the card is full, *Add* is disabled and the count says why.
 *
 * Focus stays with the field an operator is working on (WCAG 2.4.3, T092):
 * after a move, on the moved row's control in that direction — or the other
 * one where the row reached an end; after a removal, on the row that took its
 * place, or on the field's own *Add* when none is left; after an add, on the
 * next field offered in its group, or on the added row.
 *
 * Nothing is stored until *Save*, and leaving with a choice not saved asks first; the answer is the server's own, so a field
 * that stopped existing meanwhile is gone from both lists afterwards.
 */
export function BoardCardFieldsEditor(): ReactNode {
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const [config, setConfig] = useState<TaskBoardCardConfig | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const focusIntent = useRef<FocusIntent | null>(null);

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

  const accept = useCallback((loaded: TaskBoardCardConfig): void => {
    setConfig(loaded);
    setChosen(loaded.fields.map((field) => field.ref));
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    try {
      accept(await tasksApi.boardCardFields());
    } catch {
      setLoadFailed(true);
    }
  }, [accept]);

  useEffect(() => {
    void load();
  }, [load]);

  // A choice not yet saved is asked about before a link leaves the screen (issue #512).
  useUnsavedChangesPrompt(config !== null && !sameOrder(chosen, config.fields.map((field) => field.ref)));

  const byRef = useMemo(
    () => new Map((config?.available ?? []).map((field) => [field.ref, field])),
    [config],
  );

  if (config === null) {
    return loadFailed ? (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('boardCard.error.load')}</span>
          <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
            {tCore('common.action.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    ) : (
      <p role="status" className="text-sm text-muted-foreground">
        {tCore('common.state.loading')}
      </p>
    );
  }

  const name = (field: TaskBoardCardField): string => boardFieldLabel(field, language, t);
  const shown = chosen
    .map((ref) => byRef.get(ref))
    .filter((field): field is TaskBoardCardField => field !== undefined);
  const addable = config.available.filter((field) => !chosen.includes(field.ref));
  const full = chosen.length >= config.maxFields;
  const dirty = !sameOrder(chosen, config.fields.map((field) => field.ref));

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
  const add = (field: TaskBoardCardField): void => {
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

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setNotice('');
    try {
      accept(await tasksApi.setBoardCardFields(chosen));
      setNotice(t('boardCard.saved'));
    } catch (failure) {
      setError(errorMessage(failure, t('boardCard.error.save')));
    } finally {
      setSaving(false);
    }
  };

  const group = (source: TaskBoardCardField['source']): ReactNode => {
    const fields = addable.filter((field) => field.source === source);
    const everyOffered = config.available.some((field) => field.source === source);
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t(`boardCard.available.${source}`)}
        </h4>
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(everyOffered ? 'boardCard.available.allShown' : 'boardCard.available.noCustom')}
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
                  aria-label={t('boardCard.add', { field: name(field) })}
                  data-card-field={field.ref}
                  data-card-action="add"
                  onClick={(): void => add(field)}
                >
                  <Plus aria-hidden="true" />
                  {name(field)}
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
      <section aria-labelledby="tasks-board-card-shown" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="tasks-board-card-shown" className="text-sm font-semibold">
            {t('boardCard.shown.title')}
          </h3>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('boardCard.shown.count', { count: chosen.length, max: config.maxFields })}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{t('boardCard.shown.titleAlways')}</p>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('boardCard.shown.empty')}</p>
        ) : (
          <ol aria-labelledby="tasks-board-card-shown" className="divide-y rounded-md border">
            {shown.map((field, index) => (
              <li key={field.ref} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 break-words text-sm">
                  <span className="mr-2 tabular-nums text-muted-foreground">{index + 1}.</span>
                  {name(field)}
                </span>
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                    disabled={index === 0 || saving}
                    aria-label={t('boardCard.moveUp', { field: name(field) })}
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
                    aria-label={t('boardCard.moveDown', { field: name(field) })}
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
                    aria-label={t('boardCard.remove', { field: name(field) })}
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

      <section aria-labelledby="tasks-board-card-available" className="space-y-3">
        <h3 id="tasks-board-card-available" className="text-sm font-semibold">
          {t('boardCard.available.title')}
        </h3>
        {full ? (
          <p className="text-sm text-muted-foreground">{t('boardCard.available.full', { max: config.maxFields })}</p>
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
          onClick={(): void => void save()}
        >
          {tCore('common.action.save')}
        </Button>
        {dirty && !saving ? (
          <Button
            variant="ghost"
            className="min-h-11 sm:min-h-9"
            onClick={(): void => edit(config.fields.map((field) => field.ref))}
          >
            {t('boardCard.discard')}
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
