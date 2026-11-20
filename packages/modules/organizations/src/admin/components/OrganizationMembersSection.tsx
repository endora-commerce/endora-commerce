import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import type { AdminOrganizationMember, OrganizationRoleRef } from '@endora-commerce/contracts';
import { ApiError, apiClient, formatDateTime } from '@endora-commerce/admin-kit/lib';
import {
  CustomFieldValuesPanel,
  ImmediateBadge,
  ModalDialog,
  customFieldErrorsOf,
  useConfirmDialog,
} from '@endora-commerce/admin-kit/components';
import { Badge, Button, EditorSection, EmptyState, FormField, Input, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Issue #1516 (UX audit 2026-11-17, SALES-14) — the Organization screen's members, as one
 * section. It replaces three cards (*Invite member*, *Direct add member*, *Members*) and the
 * bordered edit box drawn inside the last of them:
 *
 * - the members are plain rows divided by a rule (the kit's *Sections* row pattern), each with
 *   its role as a badge — no select that commits on change (DS-18, WCAG 3.2.2);
 * - one **Add member** opens a dialog whose first choice is *Send an invitation* or *Create the
 *   account now*; only the second asks for the names, a temporary password and the `customer`
 *   custom fields (feature 175), so the common path shows two fields (Hick);
 * - **Edit** opens a dialog holding the profile and the role, written on its one Save;
 * - **Remove** is asked first (`useConfirmDialog`), and a refusal stays in that dialog.
 *
 * Every write is one of feature 170's member endpoints, unchanged, and stays immediate — the
 * section is badged so, as it was (feature 180). Errors are said inside the dialog that caused
 * them, next to the control, rather than at the top of the page (Proximity); the page is told
 * only of a success, through `onChanged`.
 */
export interface OrganizationMembersSectionProps {
  organizationId: string;
  organizationName: string;
  isPersonal: boolean;
  members: readonly AdminOrganizationMember[];
  /** The roles a member may be given: the Organization's, or — without the role list — the held ones. */
  roleOptions: readonly OrganizationRoleRef[];
  /** `customers:manage` — every member write. Without it the list is read-only. */
  canManage: boolean;
  /** `custom_fields:read` — the create way asks for the `customer` custom fields. */
  canReadCustomFields: boolean;
  /** After a write succeeded: says `message` on the page and re-reads the Organization. */
  onChanged: (message: string) => Promise<void>;
  /** Re-reads the Organization without a message — after a refused or partial write. */
  onStale: () => Promise<void>;
  /** Whether an open dialog holds typed input, for the page's leave prompt. */
  onDirtyChange: (dirty: boolean) => void;
}

/** The two ways of adding a member. */
export type AddMemberWay = 'invite' | 'create';

export interface AddMemberDraft {
  way: AddMemberWay;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

/** The field an add-member draft is refused at, mapped to its message key in this module's bundle. */
export type AddMemberErrors = Partial<Record<'email' | 'firstName' | 'lastName' | 'password', string>>;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The server's floor for a temporary password (`adminDirectMemberToRoleRequestSchema`). */
export const MIN_TEMPORARY_PASSWORD = 12;

/**
 * What the add form refuses before sending, as message keys. Checked on submit only, never on
 * the first keystroke (Postel); the e-mail is judged trimmed, as it is sent. The names and the
 * password are asked for only on the create way, so only it checks them.
 */
export function addMemberErrors(draft: AddMemberDraft): AddMemberErrors {
  const errors: AddMemberErrors = {};
  const email = draft.email.trim();
  if (email === '') errors.email = 'members.error.emailRequired';
  else if (!EMAIL_SHAPE.test(email)) errors.email = 'members.error.emailInvalid';
  if (draft.way === 'create') {
    if (draft.firstName.trim() === '') errors.firstName = 'members.error.firstNameRequired';
    if (draft.lastName.trim() === '') errors.lastName = 'members.error.lastNameRequired';
    if (draft.password.length < MIN_TEMPORARY_PASSWORD) errors.password = 'members.error.passwordShort';
  }
  return errors;
}

export interface MemberEditDraft {
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
}

export function memberEditDraftOf(member: AdminOrganizationMember): MemberEditDraft {
  return { email: member.email, firstName: member.firstName, lastName: member.lastName, roleId: member.organizationRole.id };
}

/**
 * The writes an edit needs: the profile `PATCH` (all three fields, as the screen has always
 * sent them) when any of them changed, and the role `PATCH` when the role did. `null` for
 * a write that is not needed.
 */
export function memberEditWrites(
  member: AdminOrganizationMember,
  draft: MemberEditDraft,
): { profile: { firstName: string; lastName: string; email: string } | null; roleId: string | null } {
  const profile = { firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), email: draft.email.trim() };
  const profileChanged =
    profile.firstName !== member.firstName || profile.lastName !== member.lastName || profile.email !== member.email;
  return {
    profile: profileChanged ? profile : null,
    roleId: draft.roleId !== member.organizationRole.id ? draft.roleId : null,
  };
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.envelope.error.message : fallback;
}

export function OrganizationMembersSection(props: OrganizationMembersSectionProps): ReactNode {
  const { organizationId, organizationName, isPersonal, members, canManage, onChanged } = props;
  const t = useTranslation('core');
  const own = useTranslation('organizations');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const lastAdminHintId = useId();

  // A personal Organization is single-member: the API refuses both ways of adding one.
  const canAdd = canManage && !isPersonal;
  // Last-administrator protection keys off the role's kind, never its name.
  const adminCount = members.filter((m) => m.organizationRole.kind === 'administrator').length;
  const isLastAdmin = (m: AdminOrganizationMember): boolean => m.organizationRole.kind === 'administrator' && adminCount <= 1;
  // The latest read of the member being edited; gone when it was removed meanwhile.
  const editing = editingId === null ? null : (members.find((m) => m.id === editingId) ?? null);

  // Where focus goes once a member is removed and its row — holding the Remove that asked —
  // is gone: the next row's Edit, else the previous row's, else the section's Add member,
  // which moves into the empty state once the list re-reads empty (WCAG 2.4.3).
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const addRef = useRef<HTMLButtonElement>(null);
  const focusAddOnceEmpty = useRef(false);
  useEffect(() => {
    if (members.length > 0 || !focusAddOnceEmpty.current) return;
    focusAddOnceEmpty.current = false;
    addRef.current?.focus();
  }, [members.length]);
  const neighbourOf = (m: AdminOrganizationMember): HTMLElement | null => {
    const index = members.findIndex((candidate) => candidate.id === m.id);
    const neighbour = members[index + 1] ?? members[index - 1];
    if (neighbour) return editButtons.current.get(neighbour.id) ?? null;
    focusAddOnceEmpty.current = true;
    return addRef.current;
  };

  const removeMember = async (m: AdminOrganizationMember): Promise<void> => {
    focusAddOnceEmpty.current = false;
    const removed = await confirm({
      title: own('members.remove.title'),
      message: own('members.remove.message', { email: m.email, organization: organizationName }),
      confirmLabel: own('members.remove.confirm'),
      destructive: true,
      action: () => apiClient.delete(`/api/v1/admin/organizations/${organizationId}/members/${m.id}`),
      describeError: (err) => messageOf(err, t('organizations.detail.error.remove')),
      returnFocusTo: () => neighbourOf(m),
    });
    if (removed) await onChanged(t('organizations.detail.info.memberRemoved'));
  };

  const addButton = canAdd ? (
    <Button
      ref={addRef}
      type="button"
      variant="outline"
      size="sm"
      className="min-h-11 sm:min-h-8"
      onClick={(): void => setAdding(true)}
    >
      <Plus aria-hidden="true" />
      {own('members.add')}
    </Button>
  ) : null;

  return (
    <EditorSection
      chrome="card"
      className="mb-4"
      title={
        <>
          {t('organizations.detail.membersCard')}
          <ImmediateBadge className="align-middle" />
        </>
      }
      description={isPersonal ? own('members.personal') : undefined}
      // The empty state carries the one Add of an empty list; the header carries it otherwise.
      action={members.length > 0 ? addButton : null}
    >
      {members.length === 0 ? (
        <EmptyState
          icon={<Users size={20} />}
          title={own('members.empty.title')}
          description={canAdd ? own('members.empty.description') : undefined}
          action={addButton ?? undefined}
        />
      ) : (
        <ul className="divide-y divide-border">
          {members.map((m) => {
            const lastAdmin = isLastAdmin(m);
            // On a personal Organization the section's description already says why: it has
            // one member, so there is no other one to make an administrator.
            const lastAdminHint = canManage && lastAdmin && !isPersonal ? `${lastAdminHintId}-${m.id}` : undefined;
            return (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {m.firstName} {m.lastName}
                    </span>
                    <Badge variant="outline">{m.organizationRole.name}</Badge>
                  </p>
                  <p className="break-all text-sm">{m.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.emailVerifiedAt
                      ? own('members.meta.verified', { date: formatDateTime(m.emailVerifiedAt) })
                      : own('members.meta.unverified')}
                    {' · '}
                    {m.lastLoginAt
                      ? own('members.meta.lastLogin', { date: formatDateTime(m.lastLoginAt) })
                      : own('members.meta.neverLoggedIn')}
                    {m.twoFactorEnabled ? <>{' · '}{own('members.meta.twoFactor')}</> : null}
                  </p>
                  {lastAdminHint ? (
                    <p id={lastAdminHint} className="text-xs text-muted-foreground">
                      {own('members.lastAdministrator')}
                    </p>
                  ) : null}
                </div>
                {canManage ? (
                  // Edit first, Remove last and apart from it: the frequent action is not the
                  // destructive one's neighbour by accident (Fitts), and Remove is asked anyway.
                  <div className="flex shrink-0 items-center gap-3">
                    <Button
                      ref={(node): void => {
                        if (node) editButtons.current.set(m.id, node);
                        else editButtons.current.delete(m.id);
                      }}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 sm:min-h-8"
                      aria-label={own('members.row.edit', { email: m.email })}
                      onClick={(): void => setEditingId(m.id)}
                    >
                      <Pencil aria-hidden="true" />
                      {t('organizations.detail.edit')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11 text-destructive hover:text-destructive sm:min-h-8"
                      aria-label={own('members.row.remove', { email: m.email })}
                      aria-describedby={lastAdminHint}
                      disabled={lastAdmin}
                      onClick={(): void => void removeMember(m)}
                    >
                      <Trash2 aria-hidden="true" />
                      {t('organizations.detail.remove')}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <AddMemberDialog
          {...props}
          onClose={(): void => setAdding(false)}
          onAdded={async (message): Promise<void> => {
            setAdding(false);
            await onChanged(message);
          }}
        />
      ) : null}
      {editing ? (
        <EditMemberDialog
          {...props}
          member={editing}
          lastAdmin={isLastAdmin(editing)}
          onClose={(): void => setEditingId(null)}
          onSaved={async (message): Promise<void> => {
            setEditingId(null);
            await onChanged(message);
          }}
        />
      ) : null}
      {confirmDialog}
    </EditorSection>
  );
}

/** Reports `dirty` to the page while the dialog is open, and `false` once it closes. */
function useReportDirty(dirty: boolean, onDirtyChange: (dirty: boolean) => void): void {
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
}

/** Feature 175 — a new member's custom fields start empty. */
const EMPTY_MEMBER_VALUES: Record<string, unknown> = {};

interface AddMemberDialogProps extends OrganizationMembersSectionProps {
  onClose: () => void;
  onAdded: (message: string) => Promise<void>;
}

function AddMemberDialog(props: AddMemberDialogProps): ReactNode {
  const { organizationId, roleOptions, canReadCustomFields, onClose, onAdded, onDirtyChange } = props;
  const t = useTranslation('core');
  const own = useTranslation('organizations');
  const formId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState<AddMemberDraft>({ way: 'invite', email: '', firstName: '', lastName: '', password: '' });
  // `null` = the form's default (Member) has not been changed.
  const [roleId, setRoleId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [valueErrors, setValueErrors] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<AddMemberErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The form defaults to Member. Without the role list its id may be unknown; the default is
  // then `''`, sent as no `roleId`, which the server resolves to the Organization's Member role.
  const formRoleOptions = useMemo((): { value: string; label: string }[] => {
    const options = roleOptions.map((r) => ({ value: r.id, label: r.name }));
    if (roleOptions.some((r) => r.kind === 'member')) return options;
    return [{ value: '', label: own('organizationRoles.member.name') }, ...options];
  }, [roleOptions, own]);
  const roleValue = roleId ?? roleOptions.find((r) => r.kind === 'member')?.id ?? '';

  const dirty = draft.email !== '' || draft.firstName !== '' || draft.lastName !== '' || draft.password !== '';
  useReportDirty(dirty, onDirtyChange);

  const change = (patch: Partial<AddMemberDraft>): void => setDraft((current) => ({ ...current, ...patch }));
  const creating = draft.way === 'create';

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const found = addMemberErrors(draft);
    setErrors(found);
    setError(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setValueErrors({});
    const role = roleValue ? { roleId: roleValue } : {};
    try {
      if (creating) {
        await apiClient.post(`/api/v1/admin/organizations/${organizationId}/members`, {
          email: draft.email.trim(),
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          password: draft.password,
          ...role,
          ...(Object.keys(values).length > 0 ? { customFieldValues: values } : {}),
        });
      } else {
        await apiClient.post(`/api/v1/admin/organizations/${organizationId}/members/invite`, {
          email: draft.email.trim(),
          ...role,
        });
      }
    } catch (err) {
      setBusy(false);
      setValueErrors(customFieldErrorsOf(err) ?? {});
      setError(messageOf(err, t(creating ? 'organizations.detail.error.create' : 'organizations.detail.error.invite')));
      return;
    }
    setBusy(false);
    await onAdded(t(creating ? 'organizations.detail.info.memberCreated' : 'organizations.detail.info.invited'));
  };

  const fieldError = (key: keyof AddMemberErrors): string | undefined => (errors[key] ? own(errors[key]) : undefined);

  return (
    <ModalDialog
      title={own('members.add')}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={!dirty}
      widthClassName={creating ? 'max-w-2xl' : 'max-w-lg'}
      {...(error ? { 'aria-describedby': errorId } : {})}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('organizations.detail.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy} aria-busy={busy}>
            {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : null}
            {t(creating ? 'organizations.detail.createMember' : 'organizations.detail.sendInvite')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e): void => void submit(e)} className="space-y-4 text-sm">
        <fieldset>
          <legend className="mb-2 font-medium">{own('members.add.way')}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {(['invite', 'create'] as const).map((way) => (
              <label
                key={way}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-transparent px-3 py-2 hover:bg-accent has-[:checked]:border-input has-[:checked]:bg-accent"
              >
                <input
                  type="radio"
                  name={`${formId}-way`}
                  value={way}
                  // Named by the option's title alone; its consequence is the description.
                  aria-labelledby={`${formId}-${way}-title`}
                  aria-describedby={`${formId}-${way}-hint`}
                  checked={draft.way === way}
                  disabled={busy}
                  onChange={(): void => {
                    change({ way });
                    setErrors({});
                  }}
                  className="mt-0.5 size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <span>
                  <span id={`${formId}-${way}-title`} className="block font-medium">
                    {own(way === 'invite' ? 'members.add.invite' : 'members.add.create')}
                  </span>
                  <span id={`${formId}-${way}-hint`} className="block text-xs text-muted-foreground">
                    {own(way === 'invite' ? 'members.add.inviteHint' : 'members.add.createHint')}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label={t('organizations.detail.email')} error={fieldError('email')} required>
            <Input
              type="email"
              value={draft.email}
              placeholder={t('organizations.detail.emailPlaceholder')}
              autoComplete="off"
              disabled={busy}
              onChange={(e): void => change({ email: e.target.value })}
            />
          </FormField>
          <FormField label={t('organizations.detail.role')}>
            <Select value={roleValue} disabled={busy} onChange={(e): void => setRoleId(e.target.value)}>
              {formRoleOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </FormField>
          {creating ? (
            <>
              <FormField label={t('organizations.detail.firstName')} error={fieldError('firstName')} required>
                <Input value={draft.firstName} disabled={busy} onChange={(e): void => change({ firstName: e.target.value })} />
              </FormField>
              <FormField label={t('organizations.detail.lastName')} error={fieldError('lastName')} required>
                <Input value={draft.lastName} disabled={busy} onChange={(e): void => change({ lastName: e.target.value })} />
              </FormField>
              <div className="md:col-span-2">
                <FormField label={t('organizations.detail.tempPassword')} error={fieldError('password')} required>
                  <Input
                    type="password"
                    value={draft.password}
                    autoComplete="new-password"
                    disabled={busy}
                    onChange={(e): void => change({ password: e.target.value })}
                  />
                </FormField>
              </div>
            </>
          ) : null}
        </div>

        {/* Feature 175 — the `customer` custom fields of the account being created. */}
        {creating && canReadCustomFields ? (
          <CustomFieldValuesPanel
            titleAs="h3"
            entityType="customer"
            values={EMPTY_MEMBER_VALUES}
            onChange={setValues}
            fieldErrors={valueErrors}
          />
        ) : null}

        {/* Mounted before it has text, so a refusal that arrives is announced. */}
        <p id={errorId} role="alert" className="text-destructive">
          {error}
        </p>
      </form>
    </ModalDialog>
  );
}

interface EditMemberDialogProps extends OrganizationMembersSectionProps {
  /** The latest read of the member. */
  member: AdminOrganizationMember;
  /** The Organization's only administrator keeps the role. */
  lastAdmin: boolean;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}

function EditMemberDialog(props: EditMemberDialogProps): ReactNode {
  const { organizationId, member, lastAdmin, roleOptions, onClose, onSaved, onStale, onDirtyChange } = props;
  const t = useTranslation('core');
  const own = useTranslation('organizations');
  const formId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState<MemberEditDraft>(() => memberEditDraftOf(member));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set by a version conflict: the next read of the member re-seeds the form.
  const [reseed, setReseed] = useState(false);

  useEffect(() => {
    if (!reseed) return;
    setDraft(memberEditDraftOf(member));
    setReseed(false);
  }, [reseed, member]);

  const writes = memberEditWrites(member, draft);
  const dirty = writes.profile !== null || writes.roleId !== null;
  useReportDirty(dirty, onDirtyChange);

  // The member's own role is always among the options, whatever list the page has.
  const options = roleOptions.some((r) => r.id === member.organizationRole.id) ? roleOptions : [member.organizationRole, ...roleOptions];
  const change = (patch: Partial<MemberEditDraft>): void => setDraft((current) => ({ ...current, ...patch }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!dirty) return;
    setBusy(true);
    setError(null);
    let version: string | undefined = member.updatedAt;
    let profileSaved = false;
    try {
      if (writes.profile !== null) {
        const res = await apiClient.patch<{ data: AdminOrganizationMember }>(
          `/api/v1/admin/organizations/${organizationId}/members/${member.id}`,
          { ...writes.profile, expectedUpdatedAt: member.updatedAt },
        );
        profileSaved = true;
        // The role write is gated by the version the profile write answered.
        version = res.data?.updatedAt ?? version;
      }
      if (writes.roleId !== null) {
        await apiClient.patch(`/api/v1/admin/organizations/${organizationId}/members/${member.id}/role`, {
          roleId: writes.roleId,
          ...(version ? { expectedUpdatedAt: version } : {}),
        });
      }
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
        setError(own('members.edit.conflict'));
        await onStale();
        setReseed(true);
        return;
      }
      const fallback = writes.profile !== null && !profileSaved ? 'organizations.detail.error.save' : 'organizations.detail.error.roleUpdate';
      setError(messageOf(err, t(fallback)));
      // A profile that was saved before the role write failed is shown as saved.
      if (profileSaved) await onStale();
      return;
    }
    setBusy(false);
    await onSaved(t(writes.roleId !== null ? 'organizations.detail.info.memberUpdated' : 'organizations.detail.info.profileSaved'));
  };

  return (
    <ModalDialog
      title={t('organizations.detail.editMember')}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={!dirty}
      {...(error ? { 'aria-describedby': errorId } : {})}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('organizations.detail.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy || !dirty} aria-busy={busy}>
            {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : null}
            {t('organizations.detail.save')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e): void => void submit(e)} className="space-y-4 text-sm">
        <FormField label={t('organizations.detail.email')} hint={t('organizations.detail.changeEmailHint')}>
          <Input
            type="email"
            value={draft.email}
            autoComplete="off"
            disabled={busy}
            onChange={(e): void => change({ email: e.target.value })}
          />
        </FormField>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label={t('organizations.detail.firstName')}>
            <Input value={draft.firstName} disabled={busy} onChange={(e): void => change({ firstName: e.target.value })} />
          </FormField>
          <FormField label={t('organizations.detail.lastName')}>
            <Input value={draft.lastName} disabled={busy} onChange={(e): void => change({ lastName: e.target.value })} />
          </FormField>
        </div>
        <FormField label={t('organizations.detail.role')} hint={lastAdmin ? own('members.lastAdministrator') : undefined}>
          <Select
            value={draft.roleId}
            // The last administrator's demotion is refused by the API; it is not offered.
            disabled={busy || lastAdmin}
            onChange={(e): void => change({ roleId: e.target.value })}
          >
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </FormField>
        {/* Mounted before it has text, so a refusal that arrives is announced. */}
        <p id={errorId} role="alert" className="text-destructive">
          {error}
        </p>
      </form>
    </ModalDialog>
  );
}
