import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Button, Checkbox, Input, Label } from '@endora-commerce/admin-kit/ui';
import { ReorderAnnouncer, TouchReorderButtons, resolveCustomFieldLabel } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import {
  ERROR_CODES,
  type CustomFieldDefinitionDto,
  type CustomFieldOptionDto,
  type CustomFieldValueType,
  type LocalizedLabel,
} from '@endora-commerce/contracts';
import { customFieldsClient } from '../api/custom-fields-client.js';
import type { CarryCounterpart, DefinitionChange } from '../lib/carry-drift.js';
import { maxDefaultOptions, optionValueIssue, singleDefaultConflict, type OptionIssues } from '../lib/definition-draft.js';
import { LABEL_LANGUAGES, labelTexts, sameLabel, useLanguageName, withLanguages } from './localized-label.js';

/**
 * Asks before an option change that breaks an enabled carry (feature 162,
 * `specs/162-custom-fields-value-carry/contracts/admin-surfaces.md` §1.4). The
 * page that renders this editor owns the question; the editor only says
 * which change it is about to make.
 */
export interface CarryDriftGuard {
  /** The enabled carries `change` would break; `[]` asks nothing. */
  brokenBy: (change: DefinitionChange) => CarryCounterpart[];
  /** Shows the warning; answers `true` once the operator proceeds, `false` on cancel. */
  confirm: (
    counterparts: readonly CarryCounterpart[],
    /** `action` is the change asked about — the warning's proceed button names it. */
    options: { action: DefinitionChange['kind']; lead?: string },
  ) => Promise<boolean>;
}

/** Live mode: an existing definition's options, each action saved at once. */
export interface LiveOptionsEditorProps {
  mode?: 'live';
  definition: CustomFieldDefinitionDto;
  /** Re-reads the definition after an option action. */
  onChanged: () => Promise<void>;
  disabled?: boolean;
  /** Feature 162 — present where a change can break a carry. */
  carryGuard?: CarryDriftGuard;
}

/**
 * Draft mode (issue #447): the options of a field still being created, edited
 * as a local list with no API call — the create request carries them.
 */
export interface DraftOptionsEditorProps {
  mode: 'draft';
  valueType: CustomFieldValueType;
  options: readonly CustomFieldOptionDto[];
  onChange: (next: CustomFieldOptionDto[]) => void;
  /** The form's refusals per row, by position, as sentences. */
  errors?: Readonly<Record<number, Readonly<OptionIssues>>>;
  disabled?: boolean;
}

export type DefinitionOptionsEditorProps = LiveOptionsEditorProps | DraftOptionsEditorProps;

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The server's refusal to remove an option some record still holds. */
function isOptionInUse(error: unknown): boolean {
  return error instanceof ApiError && error.envelope.error.code === ERROR_CODES.CUSTOM_FIELD_OPTION_IN_USE;
}

/** The server's sentence for a refusal — never its code — else the generic one. */
function sentenceOf(error: unknown, t: Translate): string {
  return error instanceof ApiError && error.status < 500
    ? error.envelope.error.message
    : t('customFields.editor.option.failed');
}

/**
 * The options of a select / multiselect definition. One editor serves both
 * views of the definition form (issue #447): `mode: 'draft'` edits the local
 * list a create request will carry, the default `live` mode edits an existing
 * definition's options through their sub-routes.
 */
export function DefinitionOptionsEditor(props: DefinitionOptionsEditorProps): ReactNode {
  return props.mode === 'draft' ? <DraftOptionsEditor {...props} /> : <LiveOptionsEditor {...props} />;
}

/**
 * The options of a select / multiselect definition, edited one action at a
 * time through the option sub-routes (feature 157, `admin-surfaces.md` §3.1).
 * An option's stored value is shown, never edited; an action sends only that
 * option's changed members. After every action the page re-reads the
 * definition.
 *
 * **A save never takes the operator's place.** Rows are keyed by the option
 * alone, so a re-read relabels a row rather than replacing it; inputs stay
 * enabled while a save is in flight (the row says `aria-busy`); and an input
 * adopts the re-read value only when it is not being typed in. A reorder hands
 * focus back to the moved row's button.
 */
function LiveOptionsEditor({
  definition,
  onChanged,
  disabled = false,
  carryGuard,
}: LiveOptionsEditorProps): ReactNode {
  const t = useTranslation('custom_fields');
  const [announcement, setAnnouncement] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [moving, setMoving] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<{ optionId: string; direction: -1 | 1 } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = [...definition.options].sort((a, b) => a.sortOrder - b.sortOrder);

  const setRowError = useCallback(
    (optionId: string, message: string | null): void =>
      setRowErrors((current) => {
        const next = { ...current };
        if (message === null) delete next[optionId];
        else next[optionId] = message;
        return next;
      }),
    [],
  );

  // After a reorder settles: the moved row's matching button, or its other one
  // when the move left the matching one disabled (first or last place).
  useEffect(() => {
    if (pendingFocus === null || moving) return;
    const wrapper = rootRef.current?.querySelector(`[data-reorder-for="${pendingFocus.optionId}"]`);
    const buttons = wrapper ? Array.from(wrapper.querySelectorAll('button')) : [];
    const preferred = buttons[pendingFocus.direction < 0 ? 0 : 1];
    const other = buttons[pendingFocus.direction < 0 ? 1 : 0];
    const target = preferred && !preferred.disabled ? preferred : other;
    target?.focus();
    setPendingFocus(null);
  }, [pendingFocus, moving, definition]);

  const move = async (index: number, direction: -1 | 1): Promise<void> => {
    const target = index + direction;
    const moved = options[index];
    if (moved?.id === undefined || target < 0 || target >= options.length) return;
    const movedId = moved.id;
    const order = [...options];
    order.splice(index, 1);
    order.splice(target, 0, moved);
    setMoving(true);
    setRowError(movedId, null);
    try {
      // Only the options whose position changed are patched.
      for (const [position, option] of order.entries()) {
        if (option.id !== undefined && option.sortOrder !== position) {
          await customFieldsClient.updateOption(definition.id, option.id, { sortOrder: position });
        }
      }
      setAnnouncement(
        t(direction < 0 ? 'customFields.editor.option.moveUp' : 'customFields.editor.option.moveDown', {
          label: moved.labelDefault,
          position: target + 1,
          count: order.length,
        }),
      );
    } catch (error) {
      setRowError(movedId, sentenceOf(error, t));
    } finally {
      // Re-read either way: a reorder refused half-way leaves an order on the
      // server that is neither the old one nor the one asked for.
      try {
        await onChanged();
      } catch {
        // The rows keep what they show; the next action re-reads again.
      }
      setPendingFocus({ optionId: movedId, direction });
      setMoving(false);
    }
  };

  return (
    <div ref={rootRef} className="space-y-3">
      <ReorderAnnouncer message={announcement} />
      {options.map((option, index) => (
        <OptionRow
          key={option.id ?? option.value}
          definitionId={definition.id}
          valueType={definition.valueType}
          options={options}
          option={option}
          error={option.id === undefined ? undefined : rowErrors[option.id]}
          setError={(message): void => {
            if (option.id !== undefined) setRowError(option.id, message);
          }}
          onChanged={onChanged}
          disabled={disabled}
          carryGuard={carryGuard}
          reorder={
            <div data-reorder-for={option.id ?? option.value}>
              <TouchReorderButtons
                onMoveUp={(): void => void move(index, -1)}
                onMoveDown={(): void => void move(index, 1)}
                disableUp={index === 0}
                disableDown={index === options.length - 1}
                disabled={disabled || moving}
              />
            </div>
          }
          t={t}
        />
      ))}
      <AddOptionRow
        definitionId={definition.id}
        existingValues={options.map((option) => option.value)}
        nextSortOrder={options.reduce((max, option) => Math.max(max, option.sortOrder), -1) + 1}
        onChanged={onChanged}
        disabled={disabled}
        carryGuard={carryGuard}
        t={t}
      />
    </div>
  );
}

/** The label inputs of one option row: its default label and one per label language. */
const DEFAULT_FIELD = 'default';

interface LabelDrafts {
  values: Readonly<Record<string, string>>;
  setValue: (field: string, next: string) => void;
  refs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  /** Per field, the value of a save still on its way, `null` when none is. */
  sent: MutableRefObject<Record<string, string | null>>;
}

/**
 * The drafts of a row's label inputs. Each adopts its stored value when that
 * changes, but not while its input has focus, and not while a save of a
 * different value is still on its way back — so a re-read never overwrites
 * what is being typed.
 */
function useLabelDrafts(stored: Readonly<Record<string, string>>): LabelDrafts {
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...stored }));
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const sent = useRef<Record<string, string | null>>({});
  const storedKey = JSON.stringify(stored);
  useEffect(() => {
    const adopted: Record<string, string> = {};
    for (const [field, value] of Object.entries(stored)) {
      const input = refs.current[field];
      if (input !== null && input !== undefined && input === document.activeElement) continue;
      const inFlight = sent.current[field] ?? null;
      if (inFlight !== null && inFlight !== value) continue;
      sent.current[field] = null;
      adopted[field] = value;
    }
    setValues((current) => ({ ...current, ...adopted }));
    // `storedKey` is `stored` by value: a re-read with the same labels adopts nothing new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);
  const setValue = useCallback((field: string, next: string): void => {
    setValues((current) => ({ ...current, [field]: next }));
  }, []);
  return { values, setValue, refs, sent };
}

interface OptionRowProps {
  definitionId: string;
  valueType: CustomFieldValueType;
  /** Every option of the definition, to hold the default-option count. */
  options: readonly CustomFieldOptionDto[];
  option: CustomFieldOptionDto;
  error: string | undefined;
  setError: (message: string | null) => void;
  onChanged: () => Promise<void>;
  disabled: boolean;
  carryGuard: CarryDriftGuard | undefined;
  reorder: ReactNode;
  t: Translate;
}

function OptionRow({
  definitionId,
  valueType,
  options,
  option,
  error,
  setError,
  onChanged,
  disabled,
  carryGuard,
  reorder,
  t,
}: OptionRowProps): ReactNode {
  const id = useId();
  const { language } = useTranslationContext();
  const languageName = useLanguageName();
  const drafts = useLabelDrafts({ [DEFAULT_FIELD]: option.labelDefault, ...labelTexts(option.label) });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [saved, setSaved] = useState('');
  const keepRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes once the confirmation has opened or closed. */
  const focusNext = useRef<'keep' | 'remove' | null>(null);
  const optionId = option.id;

  useEffect(() => {
    if (focusNext.current === 'keep') keepRef.current?.focus();
    if (focusNext.current === 'remove') removeRef.current?.focus();
    focusNext.current = null;
  }, [confirming]);

  const act = async (fn: () => Promise<unknown>, onRefusal?: (err: unknown) => string): Promise<boolean> => {
    if (optionId === undefined) return false;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
      return true;
    } catch (err) {
      setError(onRefusal ? onRefusal(err) : sentenceOf(err, t));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const commitLabels = (): void => {
    if (optionId === undefined) return;
    const trimmedDefault = (drafts.values[DEFAULT_FIELD] ?? '').trim();
    if (trimmedDefault === '') {
      setError(t('customFields.editor.labelDefaultRequired'));
      return;
    }
    // A value already on its way is not sent again (Enter, then the blur that follows).
    const patch: { labelDefault?: string; label?: LocalizedLabel } = {};
    if (trimmedDefault !== option.labelDefault && trimmedDefault !== drafts.sent.current[DEFAULT_FIELD]) {
      patch.labelDefault = trimmedDefault;
    }
    const texts = Object.fromEntries(
      LABEL_LANGUAGES.map((language) => [language, (drafts.values[language] ?? '').trim()]),
    );
    const label = withLanguages(option.label, texts);
    const labelInFlight = LABEL_LANGUAGES.every((language) => drafts.sent.current[language] === texts[language]);
    if (!sameLabel(label, option.label) && !labelInFlight) patch.label = label;
    if (Object.keys(patch).length === 0) return;
    if (patch.labelDefault !== undefined) drafts.sent.current[DEFAULT_FIELD] = patch.labelDefault;
    if (patch.label !== undefined) {
      for (const language of LABEL_LANGUAGES) drafts.sent.current[language] = texts[language] ?? '';
    }
    setSaved('');
    void act(() => customFieldsClient.updateOption(definitionId, optionId, patch)).then((ok) => {
      if (ok) {
        setSaved(t('customFields.editor.option.saved'));
        return;
      }
      drafts.sent.current = {};
    });
  };

  const onEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    commitLabels();
  };

  const labelInput = (field: string, text: string): ReactNode => (
    <div key={field} className="min-w-0 space-y-1">
      <Label htmlFor={`${id}-${field}`}>{text}</Label>
      <Input
        ref={(element): void => {
          drafts.refs.current[field] = element;
        }}
        id={`${id}-${field}`}
        className="min-w-0"
        value={drafts.values[field] ?? ''}
        disabled={disabled}
        aria-describedby={error ? errorId : undefined}
        onChange={(event): void => {
          drafts.setValue(field, event.target.value);
          setSaved('');
        }}
        onBlur={commitLabels}
        onKeyDown={onEnter}
      />
    </div>
  );

  const shownLabel = resolveCustomFieldLabel(option.label, option.labelDefault, language);
  const remove = (): void => {
    if (optionId === undefined) return;
    void act(
      () => customFieldsClient.removeOption(definitionId, optionId),
      (err) => (isOptionInUse(err) ? t('customFields.editor.option.inUse', { label: shownLabel }) : sentenceOf(err, t)),
    );
  };
  const errorId = `${id}-error`;
  return (
    <div role="group" aria-label={option.labelDefault} aria-busy={busy} className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words text-sm">
          <span className="text-muted-foreground">{t('customFields.editor.option.value')}: </span>
          <code className="font-mono text-xs">{option.value}</code>
        </p>
        {reorder}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {labelInput(DEFAULT_FIELD, t('customFields.editor.labelDefault'))}
        {LABEL_LANGUAGES.map((language) =>
          labelInput(language, t('customFields.editor.labelIn', { language: languageName(language) })),
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`${id}-is-default`} className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox
            id={`${id}-is-default`}
            checked={option.isDefault}
            disabled={disabled || savingDefault}
            onChange={(event): void => {
              const isDefault = event.target.checked;
              if (optionId === undefined) return;
              // A single-choice field starts with one default option at most.
              const conflict = isDefault ? singleDefaultConflict(valueType, options, option.value) : null;
              if (conflict !== null) {
                setError(t('customFields.validation.singleDefault', { label: conflict.labelDefault }));
                return;
              }
              setSavingDefault(true);
              void act(() => customFieldsClient.updateOption(definitionId, optionId, { isDefault })).finally(() =>
                setSavingDefault(false),
              );
            }}
          />
          {t('customFields.editor.option.default')}
        </label>
        {confirming ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              ref={keepRef}
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={(): void => {
                focusNext.current = 'remove';
                setConfirming(false);
              }}
            >
              {t('customFields.editor.option.keep')}
            </Button>
            <span className="min-w-0 break-words text-sm">
              {t('customFields.editor.option.removeConfirm', { label: option.labelDefault })}
            </span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="min-h-11"
              disabled={disabled || busy}
              onClick={(): void => {
                setConfirming(false);
                remove();
              }}
            >
              {t('customFields.editor.option.remove')}
            </Button>
          </div>
        ) : (
          <Button
            ref={removeRef}
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            disabled={disabled || busy}
            onClick={(): void => {
              // A removal that breaks a carry asks once, with the carries named;
              // any other asks as it always has, in the row.
              const broken =
                carryGuard?.brokenBy({ kind: 'remove-option', definitionId, optionValue: option.value }) ?? [];
              if (carryGuard && broken.length > 0) {
                void carryGuard
                  .confirm(broken, {
                    action: 'remove-option',
                    lead: t('customFields.editor.option.removeConfirm', { label: option.labelDefault }),
                  })
                  .then((proceed) => {
                    if (proceed) remove();
                  });
                return;
              }
              focusNext.current = 'keep';
              setConfirming(true);
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t('customFields.editor.option.remove')}
          </Button>
        )}
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {saved}
      </p>
      {error ? (
        <p id={errorId} role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface AddOptionRowProps {
  definitionId: string;
  /** The stored values already in use — a new option may not repeat one. */
  existingValues: readonly string[];
  nextSortOrder: number;
  onChanged: () => Promise<void>;
  disabled: boolean;
  carryGuard: CarryDriftGuard | undefined;
  t: Translate;
}

function AddOptionRow({
  definitionId,
  existingValues,
  nextSortOrder,
  onChanged,
  disabled,
  carryGuard,
  t,
}: AddOptionRowProps): ReactNode {
  const id = useId();
  const languageName = useLanguageName();
  const [value, setValue] = useState('');
  const [labelDefault, setLabelDefault] = useState('');
  const [texts, setTexts] = useState<Record<string, string>>(() => labelTexts({}));
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<{ value: boolean; labelDefault: boolean }>({ value: false, labelDefault: false });
  const [busy, setBusy] = useState(false);
  const errorId = `${id}-error`;

  const add = async (): Promise<void> => {
    const trimmedValue = value.trim();
    const trimmedDefault = labelDefault.trim();
    const valueIssue = optionValueIssue(value, existingValues);
    if (valueIssue !== undefined || trimmedDefault === '') {
      setInvalid({ value: valueIssue !== undefined, labelDefault: trimmedDefault === '' });
      setError(
        valueIssue === 'customFields.validation.optionValueDuplicate'
          ? t(valueIssue, { value: trimmedValue })
          : t('customFields.editor.option.addRequired'),
      );
      return;
    }
    setInvalid({ value: false, labelDefault: false });
    setError(null);
    const broken = carryGuard?.brokenBy({ kind: 'add-option', definitionId, optionValue: trimmedValue }) ?? [];
    if (carryGuard && broken.length > 0 && !(await carryGuard.confirm(broken, { action: 'add-option' }))) return;
    setBusy(true);
    try {
      await customFieldsClient.createOption(definitionId, {
        value: trimmedValue,
        labelDefault: trimmedDefault,
        label: withLanguages({}, texts),
        isDefault: false,
        sortOrder: nextSortOrder,
      });
      setValue('');
      setLabelDefault('');
      setTexts(labelTexts({}));
      await onChanged();
    } catch (err) {
      setError(sentenceOf(err, t));
    } finally {
      setBusy(false);
    }
  };

  const describedBy = error ? errorId : undefined;
  return (
    <div
      role="group"
      aria-label={t('customFields.editor.option.add')}
      aria-busy={busy}
      className="space-y-2 rounded-md border border-dashed p-3"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-value`}>{t('customFields.editor.option.value')}</Label>
          <Input
            id={`${id}-value`}
            className="min-w-0"
            value={value}
            disabled={disabled}
            aria-invalid={invalid.value || undefined}
            aria-describedby={describedBy}
            onChange={(event): void => setValue(event.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-default`}>{t('customFields.editor.labelDefault')}</Label>
          <Input
            id={`${id}-default`}
            className="min-w-0"
            value={labelDefault}
            disabled={disabled}
            aria-invalid={invalid.labelDefault || undefined}
            aria-describedby={describedBy}
            onChange={(event): void => setLabelDefault(event.target.value)}
          />
        </div>
        {LABEL_LANGUAGES.map((language) => (
          <div key={language} className="min-w-0 space-y-1">
            <Label htmlFor={`${id}-${language}`}>
              {t('customFields.editor.labelIn', { language: languageName(language) })}
            </Label>
            <Input
              id={`${id}-${language}`}
              className="min-w-0"
              value={texts[language] ?? ''}
              disabled={disabled}
              onChange={(event): void => {
                const next = event.target.value;
                setTexts((current) => ({ ...current, [language]: next }));
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={disabled || busy}
          onClick={(): void => void add()}
        >
          {t('customFields.editor.option.add')}
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

let draftSequence = 0;
const nextDraftKey = (): string => `draft-${++draftSequence}`;

/**
 * The draft mode (issue #447): the option list of a field still being
 * created. Nothing is sent from here — every change is a new list handed to
 * `onChange`, and the create request carries the list as it stands. A stored
 * value is editable while it is a draft, since no record holds it yet.
 *
 * It keeps what the live mode does for the operator: a reorder is announced and
 * leaves focus on the moved row's button; a removal moves focus to the next
 * row (or the *Add option* button) instead of dropping it to the page.
 */
function DraftOptionsEditor({
  valueType,
  options,
  onChange,
  errors = {},
  disabled = false,
}: DraftOptionsEditorProps): ReactNode {
  const t = useTranslation('custom_fields');
  const [announcement, setAnnouncement] = useState('');
  /** A row key per option — stable across edits and moves, so React keeps each row's inputs. */
  const keys = useRef<string[]>([]);
  if (keys.current.length !== options.length) {
    keys.current = options.map((_option, index) => keys.current[index] ?? nextDraftKey());
  }
  /** A refused *Default* tick, said at its row until the row changes again. */
  const [defaultRefusal, setDefaultRefusal] = useState<{ key: string; message: string } | null>(null);
  const [pendingFocus, setPendingFocus] = useState<
    { kind: 'reorder'; key: string; direction: -1 | 1 } | { kind: 'value'; key: string } | { kind: 'add' } | null
  >(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pendingFocus === null) return;
    const root = rootRef.current;
    if (pendingFocus.kind === 'add') addRef.current?.focus();
    else if (pendingFocus.kind === 'value') {
      root?.querySelector<HTMLInputElement>(`[data-option-key="${pendingFocus.key}"] [data-field="value"]`)?.focus();
    } else {
      const wrapper = root?.querySelector(`[data-reorder-for="${pendingFocus.key}"]`);
      const buttons = wrapper ? Array.from(wrapper.querySelectorAll('button')) : [];
      const preferred = buttons[pendingFocus.direction < 0 ? 0 : 1];
      const other = buttons[pendingFocus.direction < 0 ? 1 : 0];
      (preferred && !preferred.disabled ? preferred : other)?.focus();
    }
    setPendingFocus(null);
  }, [pendingFocus]);

  const shownLabel = (option: CustomFieldOptionDto, index: number): string =>
    option.labelDefault.trim() || option.value.trim() || t('customFields.editor.option.untitled', { position: index + 1 });

  const update = (index: number, patch: Partial<CustomFieldOptionDto>): void => {
    if (defaultRefusal?.key === keys.current[index]) setDefaultRefusal(null);
    onChange(options.map((option, position) => (position === index ? { ...option, ...patch } : option)));
  };

  const add = (): void => {
    const key = nextDraftKey();
    keys.current = [...keys.current, key];
    onChange([
      ...options,
      { value: '', label: {}, labelDefault: '', isDefault: false, sortOrder: options.length },
    ]);
    setPendingFocus({ kind: 'value', key });
  };

  const remove = (index: number): void => {
    const removed = options[index];
    if (removed === undefined) return;
    const nextKeys = keys.current.filter((_key, position) => position !== index);
    keys.current = nextKeys;
    onChange(options.filter((_option, position) => position !== index));
    setAnnouncement(t('customFields.editor.option.removed', { label: shownLabel(removed, index) }));
    const neighbour = nextKeys[index] ?? nextKeys[index - 1];
    setPendingFocus(neighbour === undefined ? { kind: 'add' } : { kind: 'value', key: neighbour });
  };

  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    const moved = options[index];
    const movedKey = keys.current[index];
    if (moved === undefined || movedKey === undefined || target < 0 || target >= options.length) return;
    const order = [...options];
    order.splice(index, 1);
    order.splice(target, 0, moved);
    const nextKeys = [...keys.current];
    nextKeys.splice(index, 1);
    nextKeys.splice(target, 0, movedKey);
    keys.current = nextKeys;
    onChange(order);
    setAnnouncement(
      t(direction < 0 ? 'customFields.editor.option.moveUp' : 'customFields.editor.option.moveDown', {
        label: shownLabel(moved, index),
        position: target + 1,
        count: order.length,
      }),
    );
    setPendingFocus({ kind: 'reorder', key: movedKey, direction });
  };

  const toggleDefault = (index: number, isDefault: boolean): void => {
    const option = options[index];
    const key = keys.current[index];
    if (option === undefined || key === undefined) return;
    // A single-choice field starts with one default option at most.
    const conflict =
      isDefault && maxDefaultOptions(valueType) === 1
        ? options.find((other, position) => position !== index && other.isDefault)
        : undefined;
    if (conflict !== undefined) {
      setDefaultRefusal({
        key,
        message: t('customFields.validation.singleDefault', { label: shownLabel(conflict, options.indexOf(conflict)) }),
      });
      return;
    }
    update(index, { isDefault });
  };

  return (
    <div ref={rootRef} className="space-y-3">
      <ReorderAnnouncer message={announcement} />
      {options.map((option, index) => {
        const key = keys.current[index]!;
        const rowErrors = errors[index] ?? {};
        const defaultError = defaultRefusal?.key === key ? defaultRefusal.message : rowErrors.isDefault;
        return (
          <DraftOptionRow
            key={key}
            rowKey={key}
            index={index}
            option={option}
            name={shownLabel(option, index)}
            errors={{
              ...(rowErrors.value !== undefined ? { value: rowErrors.value } : {}),
              ...(rowErrors.labelDefault !== undefined ? { labelDefault: rowErrors.labelDefault } : {}),
              ...(defaultError !== undefined ? { isDefault: defaultError } : {}),
            }}
            disabled={disabled}
            onUpdate={(patch): void => update(index, patch)}
            onToggleDefault={(isDefault): void => toggleDefault(index, isDefault)}
            onRemove={(): void => remove(index)}
            reorder={
              <div data-reorder-for={key}>
                <TouchReorderButtons
                  onMoveUp={(): void => move(index, -1)}
                  onMoveDown={(): void => move(index, 1)}
                  disableUp={index === 0}
                  disableDown={index === options.length - 1}
                  disabled={disabled}
                />
              </div>
            }
            t={t}
          />
        );
      })}
      <Button
        ref={addRef}
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 sm:min-h-9"
        disabled={disabled}
        onClick={add}
      >
        <Plus className="size-4" aria-hidden="true" />
        {t('customFields.editor.option.add')}
      </Button>
    </div>
  );
}

interface DraftOptionRowProps {
  rowKey: string;
  index: number;
  option: CustomFieldOptionDto;
  /** The row's accessible name: its default label, else its value, else its position. */
  name: string;
  errors: OptionIssues;
  disabled: boolean;
  onUpdate: (patch: Partial<CustomFieldOptionDto>) => void;
  onToggleDefault: (isDefault: boolean) => void;
  onRemove: () => void;
  reorder: ReactNode;
  t: Translate;
}

function DraftOptionRow({
  rowKey,
  index,
  option,
  name,
  errors,
  disabled,
  onUpdate,
  onToggleDefault,
  onRemove,
  reorder,
  t,
}: DraftOptionRowProps): ReactNode {
  const id = useId();
  const languageName = useLanguageName();
  const errorId = (field: keyof OptionIssues): string => `${id}-${field}-error`;
  const errorLine = (field: keyof OptionIssues): ReactNode =>
    errors[field] !== undefined ? (
      <p id={errorId(field)} className="break-words text-sm text-destructive">
        {errors[field]}
      </p>
    ) : null;
  return (
    <div
      role="group"
      aria-label={name}
      data-option-row=""
      data-option-key={rowKey}
      data-option-index={index}
      className="space-y-2 rounded-md border p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`${id}-value`}>{t('customFields.editor.option.value')}</Label>
          <Input
            id={`${id}-value`}
            data-field="value"
            className="min-w-0 font-mono text-xs"
            value={option.value}
            disabled={disabled}
            aria-invalid={errors.value !== undefined || undefined}
            aria-describedby={errors.value !== undefined ? errorId('value') : undefined}
            onChange={(event): void => onUpdate({ value: event.target.value })}
          />
          {errorLine('value')}
        </div>
        {reorder}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`${id}-default`}>{t('customFields.editor.labelDefault')}</Label>
          <Input
            id={`${id}-default`}
            data-field="labelDefault"
            className="min-w-0"
            value={option.labelDefault}
            disabled={disabled}
            aria-invalid={errors.labelDefault !== undefined || undefined}
            aria-describedby={errors.labelDefault !== undefined ? errorId('labelDefault') : undefined}
            onChange={(event): void => onUpdate({ labelDefault: event.target.value })}
          />
          {errorLine('labelDefault')}
        </div>
        {LABEL_LANGUAGES.map((language) => (
          <div key={language} className="min-w-0 space-y-1">
            <Label htmlFor={`${id}-${language}`}>
              {t('customFields.editor.labelIn', { language: languageName(language) })}
            </Label>
            <Input
              id={`${id}-${language}`}
              className="min-w-0"
              value={option.label[language] ?? ''}
              disabled={disabled}
              onChange={(event): void => onUpdate({ label: { ...option.label, [language]: event.target.value } })}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`${id}-is-default`} className="flex min-h-11 items-center gap-2 text-sm">
          <Checkbox
            id={`${id}-is-default`}
            data-field="isDefault"
            checked={option.isDefault}
            disabled={disabled}
            aria-invalid={errors.isDefault !== undefined || undefined}
            aria-describedby={errors.isDefault !== undefined ? errorId('isDefault') : undefined}
            onChange={(event): void => onToggleDefault(event.target.checked)}
          />
          {t('customFields.editor.option.default')}
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          {t('customFields.editor.option.remove')}
        </Button>
      </div>
      {errorLine('isDefault')}
    </div>
  );
}
