import { createContext, useContext, type Dispatch, type ReactNode } from 'react';
import type { ScopeRef, ScopedFieldView, ScopedWriteOp } from '@endora-commerce/contracts';
import { ScopedField, type ScopedFieldControlProps } from '@endora-commerce/admin-kit/components';
import { fieldViewAt, type ScopedEditorAction, type ScopedEditorState } from '../../lib/scoped-editor-store.js';

/**
 * Feature 170 — what every tab of the product editor reads: the store at the current scope,
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
  const { state, dispatch } = ctx;
  const view = (props.view ?? (state.data ? fieldViewAt(state.data, props.fieldPath) : null)) as ScopedFieldView<T> | null;
  if (!view) return null;
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
      note={props.note}
      missing={ctx.missingText(props.fieldPath)}
      required={props.required ?? view.required}
      wide={props.wide ?? false}
      headExtra={props.headExtra}
    />
  );
}

/** A global-only value presented as a field view (always the Global value, FR-081). */
export function globalOnlyView<T>(value: T | null, required = false): ScopedFieldView<T> {
  return { value, source: value === null ? 'absent' : 'set', ownValue: value, levels: ['G'], supportedHere: true, required };
}
