import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleSlash, Info, Link2, Lock, Pencil, TriangleAlert } from 'lucide-react';
import type { ScopeRef, ScopedFieldView, ScopedWriteOp } from '@endora-commerce/contracts';
import { useTranslation } from '../../i18n/useTranslation.js';
import { cn } from '../../lib/utils.js';

/**
 * One product field at the editor's scope (feature 170, `contracts/editor-ui.md` §4 and §11).
 *
 * It says, for one field at one scope, whether the value is the scope's own or inherited, and
 * lets the operator change that with one checkbox — "Use value from <parent scope>". It holds no
 * value of its own: the read's {@link ScopedFieldView} and the staged op are props, and every
 * change is reported through `onStage` (`undefined` = unstage). The control itself is the
 * caller's (`renderControl`), so a text input, a select or a date pair all get the same states.
 *
 * Layout (§11): the field spans **three shared subgrid rows** of its grid — head (label,
 * badges, the checkbox), the control, the notes — so fields in one row line up whatever their
 * notes say, and every helper text sits below the control. Mount fields inside
 * {@link ScopedFieldGrid}.
 *
 * An inherited control is `readOnly`, never `disabled` (§4): it stays focusable and readable.
 * Copy is the kit's, out of the `core` bundle (`scopedField.*`).
 */
export interface ScopedFieldControlProps<T> {
  value: T | null;
  readOnly: boolean;
  onChange(value: T | null): void;
  inputProps: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': true | undefined;
    /** Set on a required field: the visible asterisk is `aria-hidden`, so the control says it. */
    'aria-required'?: true | undefined;
  };
}

/**
 * A field view as the read carries it. Every non-Global field holds `inheritedValue` (spec round
 * 8, `contracts/scoped-values-api.md` §2): the parent's effective value and where it comes from,
 * which the field shows read-only right after "Use value from <parent>" is ticked on an own
 * value. A view without it (an older read) falls back to an empty read-only control.
 */
export type ScopedFieldViewWithParent<T> = ScopedFieldView<T>;

/**
 * Read-only and inherited controls: dashed border, sunken background, muted text (prototype
 * `.ctl[readonly]`). Applied by the wrapper so every control a caller renders gets it; a
 * non-native control opts in with `aria-readonly="true"`.
 */
const READ_ONLY_CONTROLS =
  '[&_[readonly]]:border-dashed [&_[readonly]]:bg-secondary [&_[readonly]]:text-muted-foreground [&_[readonly]]:cursor-default ' +
  '[&_[aria-readonly=true]]:border-dashed [&_[aria-readonly=true]]:bg-secondary [&_[aria-readonly=true]]:text-muted-foreground';

/** "Set, empty here" (prototype `.ctl.is-own-empty`): diagonal stripes in a visible token. */
const OWN_EMPTY_HATCHING =
  'rounded-md [background:repeating-linear-gradient(-45deg,transparent,transparent_6px,hsl(var(--muted-foreground)/0.14)_6px,hsl(var(--muted-foreground)/0.14)_12px)]';

export interface ScopedFieldProps<T> {
  id: string;
  label: string;
  fieldPath: string;
  view: ScopedFieldViewWithParent<T>;
  scope: ScopeRef;
  scopeLabel: string;
  /** "Global" at Channel, the channel's name at Channel × language. */
  parentScopeLabel: string;
  staged: ScopedWriteOp<T> | undefined;
  onStage(op: ScopedWriteOp<T> | undefined): void;
  /** No `catalog:write`: no checkbox, the source text only (FR-080). */
  readOnly: boolean;
  /** A global-only field shown outside Global (FR-081). */
  globalOnly?: boolean;
  onJumpToScope?(scope: ScopeRef): void;
  renderControl(props: ScopedFieldControlProps<T>): ReactNode;
  error?: string | undefined;
  /** A text field: inheriting at Channel × language reads "Not translated" (§11). */
  textField?: boolean;
  /** What an empty value means here ("no end date", "decorative image (alt="")" …). */
  emptyMeaning?: string | undefined;
  /** A note below the control, e.g. help text or the derived value an empty SEO field uses. */
  note?: ReactNode;
  /** The completeness marker of a missing required value (§9), from saved values. */
  missing?: string | undefined;
  /** The required marker beside the label. */
  required?: boolean;
  /** Spans both columns of a two-column grid. */
  wide?: boolean;
  /** Extra content at the end of the head row (a per-field menu). */
  headExtra?: ReactNode;
}

type Mode = 'global' | 'inherit' | 'pending' | 'own' | 'stagedInherit';

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

export function ScopedField<T>(props: ScopedFieldProps<T>): ReactNode {
  const {
    id,
    label,
    view,
    scope,
    parentScopeLabel,
    staged,
    onStage,
    readOnly,
    globalOnly = false,
    onJumpToScope,
    renderControl,
    error,
    textField = false,
    emptyMeaning,
    note,
    missing,
    required = false,
    wide = false,
    headExtra,
  } = props;
  const t = useTranslation('core');
  const [unticked, setUnticked] = useState(false);
  const focusAfterUntick = useRef(false);
  const atGlobal = scope.level === 'global';
  const ownSaved = view.source === 'set' || view.source === 'set_empty';

  // A new read (a save, a scope switch) starts every field over.
  useEffect(() => {
    setUnticked(false);
  }, [view]);

  useEffect(() => {
    if (!focusAfterUntick.current) return;
    focusAfterUntick.current = false;
    const control = document.getElementById(id);
    if (control instanceof HTMLElement) {
      control.focus();
      if (control instanceof HTMLInputElement && control.type === 'text') control.select();
    }
  });

  const srcId = `${id}-src`;
  const errId = `${id}-error`;
  const missingId = `${id}-missing`;
  const headClass = 'flex flex-wrap items-center gap-x-2 gap-y-1 self-end';

  // --- Global only outside Global, or not supported at this level --------------------------
  if ((globalOnly && !atGlobal) || !view.supportedHere) {
    const notHere = !globalOnly;
    const target: ScopeRef = notHere && scope.level === 'channel_language' && view.levels.includes('C')
      ? { level: 'channel', channelId: scope.channelId }
      : { level: 'global' };
    const targetLabel = target.level === 'global' ? t('scopedField.scope.global') : parentScopeLabel;
    const levelsText = view.levels.includes('C') ? t('scopedField.setPerChannel') : t('scopedField.globalOnly');
    return (
      <div className={cn('grid grid-rows-subgrid row-span-3 gap-1', wide && 'md:col-span-2')} data-field={props.fieldPath}>
        <div className={headClass}>
          <label htmlFor={id} id={`${id}-label`} className="text-sm font-medium">
            {label}
          </label>
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
            {notHere ? <Info className="size-3" aria-hidden="true" /> : <Lock className="size-3" aria-hidden="true" />}
            {notHere ? levelsText : t('scopedField.globalOnly')}
          </span>
        </div>
        <div className={READ_ONLY_CONTROLS}>
          {renderControl({
            value: view.value,
            readOnly: true,
            onChange: () => undefined,
            inputProps: { id, 'aria-describedby': srcId, 'aria-invalid': undefined },
          })}
        </div>
        <div className="text-xs text-muted-foreground">
          <p id={srcId} className="m-0">
            {notHere ? t('scopedField.notAtThisScope', { levels: levelsText }) : t('scopedField.sameEverywhere')}
          </p>
          {!readOnly && onJumpToScope ? (
            <button
              type="button"
              className="mt-1 text-xs font-medium text-primary underline underline-offset-2"
              onClick={(): void => onJumpToScope(target)}
            >
              {t('scopedField.editAt', { scope: targetLabel })}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // --- The scoped states -------------------------------------------------------------------
  let mode: Mode;
  if (atGlobal) mode = 'global';
  else if (staged?.op === 'inherit') mode = 'stagedInherit';
  else if (staged) mode = 'own';
  else if (unticked) mode = 'pending';
  else if (ownSaved) mode = 'own';
  else mode = 'inherit';

  const stagedValue = staged?.op === 'set' ? staged.value : staged?.op === 'empty' ? null : undefined;
  let value: T | null;
  if (stagedValue !== undefined) value = stagedValue;
  else if (mode === 'stagedInherit') value = view.inheritedValue ? view.inheritedValue.value : null;
  else if (mode === 'own') value = view.source === 'set_empty' ? null : ((view.ownValue ?? view.value) as T | null);
  else value = view.value;

  const editable = !readOnly && (mode === 'global' || mode === 'own' || mode === 'pending');

  const change = (next: T | null): void => {
    if (mode === 'global') {
      if (equal(next, view.value)) onStage(undefined);
      else onStage(next === null || isEmpty(next) ? { op: 'empty' } : { op: 'set', value: next });
      return;
    }
    if (mode === 'own' && ownSaved && !unticked) {
      const saved = view.source === 'set_empty' ? null : (view.ownValue ?? view.value);
      if (equal(isEmpty(next) ? null : next, isEmpty(saved) ? null : saved)) {
        onStage(undefined);
        return;
      }
    }
    // After an untick, retyping the inherited value pins it as an own value (§11).
    onStage(next === null || isEmpty(next) ? { op: 'empty' } : { op: 'set', value: next });
  };

  const onUseParent = (checked: boolean): void => {
    if (checked) {
      setUnticked(false);
      onStage(ownSaved ? { op: 'inherit' } : undefined);
      return;
    }
    if (staged?.op === 'inherit') {
      onStage(undefined);
      return;
    }
    setUnticked(true);
    focusAfterUntick.current = true;
  };

  // Source line (the control's description).
  const inheritedFrom = view.source === 'inherited_channel' ? parentScopeLabel : t('scopedField.scope.global');
  let source: { icon: ReactNode; text: string } | null = null;
  if (mode === 'global') {
    if (isEmpty(value)) source = { icon: <CircleSlash className="size-3" aria-hidden="true" />, text: t('scopedField.source.noValueAtGlobal') };
  } else if (mode === 'inherit' || mode === 'pending') {
    source =
      view.source === 'absent'
        ? { icon: <CircleSlash className="size-3" aria-hidden="true" />, text: t('scopedField.source.noValueAbove') }
        : { icon: <Link2 className="size-3" aria-hidden="true" />, text: t('scopedField.source.inheritedFrom', { scope: inheritedFrom }) };
  } else if (mode === 'stagedInherit') {
    const parent = view.inheritedValue;
    if (parent?.source === 'absent') {
      source = { icon: <CircleSlash className="size-3" aria-hidden="true" />, text: t('scopedField.source.noValueAbove') };
    } else {
      const from = parent?.source === 'inherited_global' ? t('scopedField.scope.global') : parentScopeLabel;
      source = { icon: <Link2 className="size-3" aria-hidden="true" />, text: t('scopedField.source.willInherit', { scope: from }) };
    }
  } else if (isEmpty(value)) {
    const base = t('scopedField.source.setEmpty');
    source = { icon: <CircleSlash className="size-3" aria-hidden="true" />, text: emptyMeaning ? `${base} — ${emptyMeaning}` : base };
  } else {
    source = { icon: <Pencil className="size-3" aria-hidden="true" />, text: t('scopedField.source.set') };
  }

  const badges: ReactNode[] = [];
  const badgeClass = 'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs';
  if (mode === 'inherit') {
    const text =
      view.source === 'absent'
        ? t('scopedField.badge.noValue')
        : textField && scope.level === 'channel_language'
          ? t('scopedField.badge.notTranslated')
          : t('scopedField.badge.inherited');
    badges.push(
      <span key="src" className={cn(badgeClass, 'text-muted-foreground')}>
        <Link2 className="size-3" aria-hidden="true" />
        {text}
      </span>,
    );
  } else if (mode === 'own') {
    badges.push(
      <span key="src" className={cn(badgeClass, 'border-primary/40 text-primary')}>
        {isEmpty(value) ? <CircleSlash className="size-3" aria-hidden="true" /> : <Pencil className="size-3" aria-hidden="true" />}
        {isEmpty(value) ? t('scopedField.badge.emptyHere') : t('scopedField.badge.overridden')}
      </span>,
    );
  }
  if (staged) {
    badges.push(
      <span key="staged" className={cn(badgeClass, 'border-amber-500/50 text-amber-800 dark:text-amber-200')}>
        <Pencil className="size-3" aria-hidden="true" />
        {t('scopedField.badge.unsaved')}
      </span>,
    );
  }
  if (missing) {
    badges.push(
      <span key="missing" className={cn(badgeClass, 'border-destructive/50 text-destructive')}>
        <TriangleAlert className="size-3" aria-hidden="true" />
        {t('scopedField.badge.missing')}
      </span>,
    );
  }

  const noteId = `${id}-note`;
  const describedBy =
    [note ? noteId : null, source ? srcId : null, missing ? missingId : null, error ? errId : null].filter(Boolean).join(' ') ||
    undefined;
  const ownEmpty = !atGlobal && mode === 'own' && isEmpty(value);

  return (
    <div className={cn('grid grid-rows-subgrid row-span-3 gap-1', wide && 'md:col-span-2')} data-field={props.fieldPath}>
      <div className={headClass}>
        <label htmlFor={id} id={`${id}-label`} className="text-sm font-medium">
          {label}
        </label>
        {required ? (
          <span aria-hidden="true" className="text-sm font-medium" title={t('scopedField.required')}>
            *
          </span>
        ) : null}
        {badges}
        {headExtra ? <span className="ml-auto">{headExtra}</span> : null}
        {!atGlobal && !readOnly ? (
          <label className="flex min-h-6 max-lg:min-h-11 w-full cursor-pointer items-center gap-2 py-0.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-4"
              aria-describedby={source ? srcId : undefined}
              checked={mode === 'inherit' || mode === 'stagedInherit'}
              onChange={(e): void => onUseParent(e.target.checked)}
            />
            <span>
              {t('scopedField.useParent', { scope: parentScopeLabel })}{' '}
              <span className="sr-only">{t('scopedField.useParentFor', { field: label })}</span>
            </span>
          </label>
        ) : null}
      </div>
      <div className={cn(READ_ONLY_CONTROLS, ownEmpty && OWN_EMPTY_HATCHING)}>
        {renderControl({
          value,
          readOnly: !editable,
          onChange: change,
          inputProps: {
            id,
            'aria-describedby': describedBy,
            'aria-invalid': error ? true : undefined,
            ...(required ? { 'aria-required': true as const } : {}),
          },
        })}
      </div>
      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {note ? <div id={noteId}>{note}</div> : null}
        {source ? (
          <p id={srcId} className="m-0 inline-flex items-center gap-1">
            {source.icon}
            <span>{source.text}</span>
          </p>
        ) : null}
        {missing ? (
          <p id={missingId} className="m-0 inline-flex items-center gap-1 text-destructive">
            <TriangleAlert className="size-3" aria-hidden="true" />
            <span>{missing}</span>
          </p>
        ) : null}
        {error ? (
          <p id={errId} className="m-0 inline-flex items-center gap-1 text-destructive">
            <TriangleAlert className="size-3" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The grid `ScopedField`s share their subgrid rows in: one column, two from `md`. */
export function ScopedFieldGrid({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return <div className={cn('grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2 [&>*]:pb-3', className)}>{children}</div>;
}
