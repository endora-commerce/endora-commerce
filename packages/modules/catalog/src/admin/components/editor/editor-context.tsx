import { createContext, useContext, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { ScopeRef, ScopedFieldView, ScopedWriteOp } from '@endora-commerce/contracts';
import { ScopedField, type ScopedFieldControlProps } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@endora-commerce/admin-kit/ui';
import { CopyToChannelsDialog, type CopyTarget } from '../CopyToChannelsDialog.js';
import { fieldViewAt, type ScopedEditorAction, type ScopedEditorState } from '../../lib/scoped-editor-store.js';

/**
 * Feature 174 — what every tab of the product editor reads: the store at the current scope,
 * the scope's words, whether the operator may write, and the jump to another scope (which goes
 * through the page's switch guard).
 */
export interface ProductEditorContextValue {
  productId: string;
  state: ScopedEditorState;
  dispatch: Dispatch<ScopedEditorAction>;
  readOnly: boolean;
  scopeLabel: string;
  parentScopeLabel: string;
  /** Opens the editor at `scope` (through the switch guard), focusing `field` after the load. */
  jumpTo(scope: ScopeRef, field?: string): void;
  /** Re-reads one family after an immediate action; keeps the staged changes and the version. */
  refreshFamily(family: 'gallery' | 'attachments' | 'packagingUnits'): Promise<void>;
  /** The completeness marker of a field at Channel × language, from saved values (§9, §11). */
  missingText(fieldPath: string): string | undefined;
  /** A copy to other channels succeeded (§8): keep its version for the next Save and announce it. */
  afterCopy(version: string, fieldLabel: string, count: number): void;
  /** Discards the staged changes and reads the product again (the answer to a version conflict). */
  reloadDiscarding(): void;
}

const Context = createContext<ProductEditorContextValue | null>(null);

export function ProductEditorContextProvider({ value, children }: { value: ProductEditorContextValue; children: ReactNode }): ReactNode {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProductEditor(): ProductEditorContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('useProductEditor outside ProductEditorContextProvider');
  return value;
}

/** A DOM id for a field path (`gallery:<uuid>:altText` → `pf-gallery-<uuid>-altText`). */
export function fieldDomId(fieldPath: string): string {
  return `pf-${fieldPath.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export interface EditorFieldProps<T> {
  fieldPath: string;
  label: string;
  render(props: ScopedFieldControlProps<T>): ReactNode;
  /** The view when the path is not one of the read's fields (a global-only product field). */
  view?: ScopedFieldView<T>;
  globalOnly?: boolean;
  textField?: boolean;
  emptyMeaning?: string;
  note?: ReactNode;
  required?: boolean;
  wide?: boolean;
  headExtra?: ReactNode;
}

/** One field of the read at the editor scope, wired to the store. */
export function EditorField<T>(props: EditorFieldProps<T>): ReactNode {
  const ctx = useProductEditor();
  const t = useTranslation('catalog');
  const { state, dispatch } = ctx;
  const [copyOpen, setCopyOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const view = (props.view ?? (state.data ? fieldViewAt(state.data, props.fieldPath) : null)) as ScopedFieldView<T> | null;
  if (!view) return null;
  const copy = copyOffer(ctx, props, view);
  const staged = state.staged.has(props.fieldPath);
  let note = props.note;
  let headExtra = props.headExtra;
  if (copy && staged) {
    note = (
      <>
        {props.note}
        <span className="block">{t('productEditor.copy.saveFirst')}</span>
      </>
    );
  } else if (copy) {
    headExtra = (
      <>
        {props.headExtra}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              ref={menuRef}
              type="button"
              className="b2b-btn b2b-btn--ghost inline-flex size-7 items-center justify-center p-0 max-lg:size-11"
              aria-label={t('productEditor.copy.menu', { field: props.label })}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="max-lg:min-h-11" onSelect={(): void => setCopyOpen(true)}>
              {t('productEditor.copy.action', { language: copy.languageName })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {copyOpen && state.version !== null ? (
          <CopyToChannelsDialog
            productId={ctx.productId}
            fieldPath={props.fieldPath}
            fieldLabel={props.label}
            from={copy.from}
            sourceScopeLabel={ctx.scopeLabel}
            languageName={copy.languageName}
            value={copy.value}
            targets={copy.targets}
            version={state.version}
            finalFocusRef={menuRef}
            onClose={(): void => setCopyOpen(false)}
            onReload={(): void => {
              setCopyOpen(false);
              ctx.reloadDiscarding();
            }}
            onCopied={(version, count): void => {
              setCopyOpen(false);
              ctx.afterCopy(version, props.label, count);
            }}
          />
        ) : null}
      </>
    );
  }
  return (
    <ScopedField<T>
      id={fieldDomId(props.fieldPath)}
      label={props.label}
      fieldPath={props.fieldPath}
      view={view}
      scope={state.scope}
      scopeLabel={ctx.scopeLabel}
      parentScopeLabel={ctx.parentScopeLabel}
      staged={state.staged.get(props.fieldPath) as ScopedWriteOp<T> | undefined}
      onStage={(op): void => dispatch({ type: 'stage', path: props.fieldPath, op: op as ScopedWriteOp<unknown> | undefined })}
      readOnly={ctx.readOnly}
      globalOnly={props.globalOnly ?? false}
      onJumpToScope={(scope): void => ctx.jumpTo(scope, props.fieldPath)}
      renderControl={props.render}
      error={state.errors[props.fieldPath]}
      textField={props.textField ?? false}
      emptyMeaning={props.emptyMeaning}
      note={note}
      missing={ctx.missingText(props.fieldPath)}
      required={props.required ?? view.required}
      wide={props.wide ?? false}
      headExtra={headExtra}
    />
  );
}

/**
 * "Copy to other channels in <language>" (§8, §11): a text field set at C×L in its own right
 * (an own empty value only when the field is optional, FR-086), a field the read sets per
 * language, an operator who may write, and at least one other member channel offering the
 * language. `null` when the action is absent.
 */
function copyOffer<T>(
  ctx: ProductEditorContextValue,
  props: EditorFieldProps<T>,
  view: ScopedFieldView<T>,
): { from: { channelId: string; languageCode: string }; languageName: string; value: string | null; targets: CopyTarget[] } | null {
  const scope = ctx.state.scope;
  const data = ctx.state.data;
  if (scope.level !== 'channel_language' || !data || ctx.readOnly || !props.textField || props.globalOnly) return null;
  if (!view.levels.includes('CL') || !view.supportedHere) return null;
  if (view.source !== 'set' && view.source !== 'set_empty') return null;
  if (view.source === 'set_empty' && (props.required ?? view.required)) return null;
  const sameLanguage = (code: string): boolean => code.toLowerCase() === scope.languageCode.toLowerCase();
  const targets = data.validScopes.channels
    .filter((channel) => channel.channelId !== scope.channelId && channel.languages.some((language) => sameLanguage(language.code)))
    .map((channel) => ({ channelId: channel.channelId, name: channel.name }));
  if (targets.length === 0) return null;
  const source = data.validScopes.channels.find((channel) => channel.channelId === scope.channelId);
  const languageName = source?.languages.find((language) => sameLanguage(language.code))?.name ?? scope.languageCode;
  const own = view.source === 'set_empty' ? null : (view.ownValue ?? view.value);
  return {
    from: { channelId: scope.channelId, languageCode: scope.languageCode },
    languageName,
    value: typeof own === 'string' ? own : null,
    targets,
  };
}

/** A global-only value presented as a field view (always the Global value, FR-081). */
export function globalOnlyView<T>(value: T | null, required = false): ScopedFieldView<T> {
  return { value, source: value === null ? 'absent' : 'set', ownValue: value, levels: ['G'], supportedHere: true, required };
}
