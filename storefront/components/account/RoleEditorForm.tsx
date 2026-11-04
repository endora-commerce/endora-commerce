'use client';

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import type { PermissionCatalogueGroup } from '../../lib/api/organization';
import type { OrganizationRoleKind } from '@endora-commerce/contracts';
import { tForLocale } from '../../lib/i18n/messages';
import { format } from '../../lib/i18n/format';
import { LocalizedLink, useLocalizedPath } from '../../lib/i18n/localized-link';
import {
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
  isNameError,
  roleErrorKey,
  type RoleFormState,
} from '../../lib/account/organization-roles';
import { RolePermissionsFields } from './RolePermissionsFields';
import { CartSubmitButton } from '../CartSubmitButton';

/**
 * The role create / edit form (`specs/170-organization-roles/`, FR-004,
 * FR-025). Owner ruling on PR #715: **a refused save keeps what the
 * administrator typed and ticked**, and no form state travels in a URL, so a
 * crafted link cannot pre-fill a role.
 *
 * The server action answers a refusal's code as `useActionState` state
 * ({@link RoleFormState}); a success redirects. The submit is dispatched from
 * `onSubmit` inside a transition rather than through the `action` prop alone,
 * because React resets a form's uncontrolled fields after an `action`-prop
 * submission — which is exactly the input this form must keep. `action` stays
 * set, so the form still posts without JavaScript (then the page reloads with
 * its stored values).
 *
 * Accessibility: the announcement region (`role="alert"`) is mounted empty
 * before any refusal, so its text is announced when it arrives (WCAG 4.1.3);
 * after a refusal focus moves to the name field when the name is at fault —
 * its `aria-describedby` reads the reason — and to the region otherwise.
 *
 * The page around it stays a Server Component and passes the catalogue, the
 * role and the bound server action.
 */

export interface RoleEditorRole {
  readonly id: string;
  readonly kind: Exclude<OrganizationRoleKind, 'administrator'>;
  readonly name: string;
  readonly description: string | null;
  readonly version: number;
}

const IDLE: RoleFormState = { error: null };

export function RoleEditorForm({
  action,
  locale,
  groups,
  granted,
  role,
  cancelHref,
  initialState = IDLE,
}: {
  action: (state: RoleFormState, formData: FormData) => Promise<RoleFormState>;
  locale: string;
  groups: readonly PermissionCatalogueGroup[];
  /** The role's stored grants; a new role passes none (owner ruling Q1). */
  granted: readonly string[];
  /** `null` creates a custom role. */
  role: RoleEditorRole | null;
  cancelHref: string;
  /** `useActionState`'s starting state — no refusal. */
  initialState?: RoleFormState;
}): ReactNode {
  const t = tForLocale(locale);
  const localize = useLocalizedPath();
  const [state, formAction] = useActionState(action, initialState);
  const nameRef = useRef<HTMLInputElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const answered = useRef(false);

  const hasName = role === null || role.kind === 'custom';
  const code = state.error ?? undefined;
  const errorKey = roleErrorKey(code);
  const nameInvalid = hasName && isNameError(code);

  useEffect(() => {
    // The initial state is not an answer; every state after it is one.
    if (!answered.current) {
      answered.current = true;
      return;
    }
    if (!state.error) return;
    (nameInvalid ? nameRef.current : regionRef.current)?.focus();
  }, [state, nameInvalid]);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  let announcement: ReactNode = null;
  if (errorKey && !nameInvalid) {
    announcement =
      state.error === 'ORGANIZATION_ROLE_STALE' && role ? (
        <>
          {t('account.roles.form.stale')}{' '}
          {/* A full load on purpose: a soft navigation would keep this form, and its stale version, mounted. */}
          <a href={localize(`/organization/roles/${encodeURIComponent(role.id)}`)}>{t('account.roles.form.reload')}</a>
        </>
      ) : (
        t(errorKey)
      );
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="b2b-auth__form mt-4 max-w-[720px]">
      <div
        id="role-form-error"
        ref={regionRef}
        tabIndex={-1}
        role="alert"
        className={announcement ? 'b2b-auth__error m-0 focus-visible:outline-2' : undefined}
      >
        {announcement}
      </div>
      {role ? (
        <>
          <input type="hidden" name="id" value={role.id} />
          <input type="hidden" name="expectedVersion" value={String(role.version)} />
        </>
      ) : null}
      {hasName ? (
        <>
          <div className="b2b-auth__field">
            <label htmlFor="role-name">{t('account.roles.editor.name')}</label>
            <input
              id="role-name"
              ref={nameRef}
              name="name"
              defaultValue={role?.name}
              required
              maxLength={ROLE_NAME_MAX_LENGTH}
              placeholder=" "
              autoComplete="off"
              aria-invalid={nameInvalid || undefined}
              aria-describedby={nameInvalid ? 'role-name-error' : 'role-name-hint'}
            />
          </div>
          {nameInvalid && errorKey ? (
            <p id="role-name-error" className="b2b-auth__error m-0">
              {t(errorKey)}
            </p>
          ) : (
            <p id="role-name-hint" className="m-0 text-[12px] text-muted">
              {t('account.roles.editor.nameHint')}
            </p>
          )}
          <div className="b2b-auth__field">
            <label htmlFor="role-description">{t('account.roles.editor.description')}</label>
            <textarea
              id="role-description"
              name="description"
              rows={2}
              defaultValue={role?.description ?? ''}
              maxLength={ROLE_DESCRIPTION_MAX_LENGTH}
              placeholder=" "
            />
          </div>
        </>
      ) : (
        <p className="m-0 text-[13px] text-muted">
          {format(t('account.roles.editor.memberHint'), { role: role?.name ?? '' })}
        </p>
      )}
      <RolePermissionsFields groups={groups} granted={granted} locale={locale} />
      <div className="b2b-auth__actions flex flex-wrap items-center gap-3">
        <CartSubmitButton
          className="btn btn--dark min-h-11"
          label={role ? t('account.roles.editor.save') : t('account.roles.editor.create')}
          pendingLabel={role ? t('account.roles.editor.saving') : t('account.roles.editor.creating')}
        />
        <LocalizedLink href={cancelHref} className="btn btn--ghost min-h-11">
          {t('account.common.cancel')}
        </LocalizedLink>
      </div>
    </form>
  );
}
