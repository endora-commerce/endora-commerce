import type { ReactNode } from 'react';
import type { PermissionCatalogueGroup } from '../../lib/api/organization';
import { tForLocale } from '../../lib/i18n/messages';
import { format } from '../../lib/i18n/format';

/**
 * The permission list of the storefront role editor (`specs/170-organization-roles/`,
 * FR-025, research R-12): every grantable permission of a present module,
 * grouped by the module that declares it, each with the label and description
 * the API translated. It renders the catalogue it is given and names no code of
 * its own, so a permission a module declares later appears here unchanged — the
 * one exception is OR-6's note, which says that one-click works only with
 * ordering without approval.
 *
 * A server component: the boxes are plain form fields, read by the page's
 * server action from `formData.getAll('permissions')`. `granted` ticks the
 * role's stored grants; a new role passes none (owner ruling Q1). `readOnly`
 * lists the permissions without boxes, for the *Administrator*, who holds them
 * all and cannot be edited.
 */

/** OR-6 (FR-050): one-click purchase also needs ordering without approval. */
const ONE_CLICK = 'quick_order.one_click';
const ORDER_WITHOUT_APPROVAL = 'carts.order_without_approval';

export function RolePermissionsFields({
  groups,
  granted,
  locale,
  readOnly = false,
}: {
  groups: readonly PermissionCatalogueGroup[];
  granted: readonly string[];
  locale: string;
  readOnly?: boolean;
}): ReactNode {
  const t = tForLocale(locale);
  if (groups.length === 0) {
    return <p className="m-0 text-[13px] text-muted">{t('account.roles.editor.noPermissions')}</p>;
  }
  const held = new Set(granted);
  const labelOf = (code: string): string | null => {
    for (const group of groups) {
      const found = group.permissions.find((p) => p.code === code);
      if (found) return found.label;
    }
    return null;
  };
  const companion = labelOf(ORDER_WITHOUT_APPROVAL);
  const noteFor = (code: string): string | null =>
    code === ONE_CLICK && companion ? format(t('account.roles.editor.oneClickNote'), { permission: companion }) : null;

  if (readOnly) {
    return (
      <div className="grid gap-4">
        {groups.map((group) => (
          <section key={group.moduleId} aria-label={group.moduleLabel} className="rounded-md border border-line p-[14px]">
            <h4 className="m-0 mb-2 text-[13px] font-medium">{group.moduleLabel}</h4>
            <ul className="m-0 grid list-none gap-2 p-0">
              {group.permissions.map((p) => (
                <li key={p.code} className="text-[13px]">
                  <span className="block font-medium">{p.label}</span>
                  <span className="block text-[12px] text-muted">{p.description}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <fieldset className="m-0 grid gap-4 border-0 p-0" aria-describedby="role-permissions-hint">
      <legend className="mb-1 p-0 text-[14px] font-semibold">{t('account.roles.editor.permissions')}</legend>
      <p id="role-permissions-hint" className="m-0 text-[12px] text-muted">
        {t('account.roles.editor.permissionsHint')}
      </p>
      {groups.map((group) => (
        <fieldset key={group.moduleId} className="m-0 rounded-md border border-line p-[14px]">
          <legend className="px-1 text-[13px] font-medium">{group.moduleLabel}</legend>
          <ul className="m-0 grid list-none gap-1 p-0">
            {group.permissions.map((p) => {
              const id = `permission-${p.code}`;
              const note = noteFor(p.code);
              return (
                <li key={p.code}>
                  <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                    <input
                      id={id}
                      type="checkbox"
                      name="permissions"
                      value={p.code}
                      defaultChecked={held.has(p.code)}
                      aria-describedby={`${id}-description`}
                      className="mt-[2px] size-4 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2"
                    />
                    <span className="grid gap-[2px]">
                      <span className="text-[13px] font-medium">{p.label}</span>
                      <span id={`${id}-description`} className="text-[12px] text-muted">
                        {p.description}
                        {note ? <span className="block">{note}</span> : null}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </fieldset>
  );
}
