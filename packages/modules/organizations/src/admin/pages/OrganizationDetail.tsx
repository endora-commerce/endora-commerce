import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { FulfilmentStrategy, OrganizationRoleRef, OrganizationRoleView, Warehouse } from '@endora-commerce/contracts';
import {
  ApiError,
  SaveSessionProvider,
  apiClient,
  formatDateTime,
  useAuth,
  useSaveSession,
  useSurfaceVisibility,
  useUnsavedChangesPrompt,
  type SaveOutcome,
  type SavePart,
} from '@endora-commerce/admin-kit/lib';
import { FulfilmentStrategyPanel } from '../panels/FulfilmentStrategyPanel.js';
import { ImmediateBadge } from '../components/ImmediateBadge.js';
import { OrganizationSalesRepsTab } from '../components/OrganizationSalesRepsTab.js';
import { OrganizationRolesTab } from '../components/OrganizationRolesTab.js';
import { ConvertToCompanyForm, type ConvertToCompanyResult } from '../components/ConvertToCompanyForm.js';
import { ChangeTaxIdForm, taxIdChangeMessage, type ChangeTaxIdResult } from '../components/ChangeTaxIdForm.js';
import { organizationRolesClient } from '../api/roles.js';
import { ModerationActionsPanel } from '../panels/ModerationActionsPanel.js';
import { ApplicablePriceListsPanel } from '../panels/ApplicablePriceListsPanel.js';
import { HierarchyPanel } from '../panels/HierarchyPanel.js';
import { VatValidationPanel } from '../panels/VatValidationPanel.js';
import { newestRegistrationRow } from '../panels/vat-validation-view.js';
import { RestrictionsPanel, changedRestrictionLists, type RestrictionsSelection } from '../panels/RestrictionsPanel.js';
import { SalesChannelsPanel } from '../panels/SalesChannelsPanel.js';
import {
  CustomFieldValuesPanel,
  ModalDialog,
  SaveSessionActions,
  SaveSessionSummary,
  customFieldErrorsOf,
  type FulfilmentStrategyValue,
} from '@endora-commerce/admin-kit/components';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, PageHeader, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/** The VAT validation panel's heading — where the moderation notice's link lands. */
const VAT_VALIDATION_HEADING_ID = 'organization-vat-validation';

interface OrgMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** The member's role (`specs/170-organization-roles/` FR-073): translated name for a predefined role. */
  organizationRole: OrganizationRoleRef;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  lastLoginAt?: string | null;
  updatedAt?: string;
}

interface OrgDetail {
  id: string;
  name: string;
  legalName?: string | null;
  /** `null` for a personal Organization (`specs/177-tax-id-scope/`). */
  taxId: string | null;
  status: 'pending_verification' | 'active' | 'blocked' | 'rejected';
  vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge';
  /** A B2C customer's own Organization: no role management there (PR-3). */
  isPersonal?: boolean;
  registeredAddress: { street: string; city: string; postalCode: string; country: string };
  orderConfirmationEmails?: string[];
  fulfilmentStrategy?: FulfilmentStrategy | null;
  fulfilmentStrategyWarehouseOrder?: string[] | null;
  customFieldValues?: Record<string, unknown>;
  /** Feature 056 — hierarchy. `null` ⇒ this org is a root. */
  parentId?: string | null;
  members: OrgMember[];
  version?: number;
  blockedReason?: string | null;
  blockedAt?: string | null;
  rejectedReason?: string | null;
  rejectedAt?: string | null;
  approvedAt?: string | null;
  approvedByAdminUserId?: string | null;
  vatValidation?: {
    outcome: 'validated' | 'failed' | 'deferred' | 'unverified' | null;
    provider: 'vies' | 'mf_pl' | 'format_only' | 'gus_pl' | null;
    validatedAt: string | null;
  };
  updatedAt?: string;
}

const STATUSES = ['pending_verification', 'active', 'blocked', 'rejected'] as const;
const VAT_STATUSES = ['vat_payer', 'vat_exempt', 'reverse_charge'] as const;
/** Feature 175 — the direct-create panel's starting bag: a new member has none. */
const EMPTY_MEMBER_VALUES: Record<string, unknown> = {};

/** Either code reads an Organization's roles (`contracts/operator-api.md` §2). */
const READ_ROLES: [string, string] = ['organizations:read-roles', 'organizations:manage-roles'];

const KIND_ORDER: Record<OrganizationRoleRef['kind'], number> = { administrator: 0, member: 1, custom: 2 };

/** Administrator, Member, then custom roles by name — the order the role list answers in. */
function byKindThenName(a: OrganizationRoleRef, b: OrganizationRoleRef): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name);
}

/**
 * Feature 180, WP-7 — the screen's own sections, staged for its one Save. A field is `undefined`
 * until the operator edits it; the stored organization (and the restrictions the panel read) is
 * the baseline every count and every `PATCH` body is computed against.
 */
interface HostEdits {
  status?: OrgDetail['status'];
  vatStatus?: OrgDetail['vatStatus'];
  /** The e-mails textarea as typed; parsed on Save, as it used to be parsed on blur. */
  emailsText?: string;
  fulfilment?: FulfilmentStrategyValue;
  /** The custom-field panel's `edit`-level bag, as it reports it. */
  customFieldValues?: Record<string, unknown>;
  restrictions?: RestrictionsSelection;
}

function parseEmails(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function storedFulfilment(org: OrgDetail): FulfilmentStrategyValue {
  return { strategy: org.fulfilmentStrategy ?? null, warehouseOrder: org.fulfilmentStrategyWarehouseOrder ?? [] };
}

/** A warehouse order only matters for `defined_order`, which is what the `PATCH` sends. */
function sameFulfilment(a: FulfilmentStrategyValue, b: FulfilmentStrategyValue): boolean {
  if (a.strategy !== b.strategy) return false;
  return a.strategy !== 'defined_order' || a.warehouseOrder.join('|') === b.warehouseOrder.join('|');
}

/** The custom fields the bag changes, against the stored values. */
function changedCustomFields(bag: Record<string, unknown> | undefined, stored: Record<string, unknown>): number {
  if (bag === undefined) return 0;
  return Object.entries(bag).filter(([key, value]) => JSON.stringify(value ?? null) !== JSON.stringify(stored[key] ?? null)).length;
}

/**
 * The `PATCH …/organizations/:id` body for the staged edits — only the fields that differ from
 * the stored organization, in the shapes the screen has always sent them.
 */
function patchBodyOf(edits: HostEdits, org: OrgDetail): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (edits.status !== undefined && edits.status !== org.status) body['status'] = edits.status;
  if (edits.vatStatus !== undefined && edits.vatStatus !== org.vatStatus) body['vatStatus'] = edits.vatStatus;
  if (edits.emailsText !== undefined) {
    const emails = parseEmails(edits.emailsText);
    if (emails.join('|') !== (org.orderConfirmationEmails ?? []).join('|')) body['orderConfirmationEmails'] = emails;
  }
  if (edits.fulfilment !== undefined && !sameFulfilment(edits.fulfilment, storedFulfilment(org))) {
    body['fulfilmentStrategy'] = edits.fulfilment.strategy;
    body['fulfilmentStrategyWarehouseOrder'] =
      edits.fulfilment.strategy === 'defined_order' ? edits.fulfilment.warehouseOrder : null;
  }
  if (changedCustomFields(edits.customFieldValues, org.customFieldValues ?? {}) > 0) {
    body['customFieldValues'] = edits.customFieldValues;
  }
  return body;
}

/** The host part's unsaved changes: one per changed field, custom field and allow-list. */
function hostChangeCount(edits: HostEdits, org: OrgDetail, restrictions: RestrictionsSelection | null): number {
  const body = patchBodyOf(edits, org);
  let count = ['status', 'vatStatus', 'orderConfirmationEmails', 'fulfilmentStrategy'].filter((key) => key in body).length;
  count += changedCustomFields(edits.customFieldValues, org.customFieldValues ?? {});
  if (edits.restrictions !== undefined && restrictions !== null) count += changedRestrictionLists(edits.restrictions, restrictions);
  return count;
}

/**
 * Feature 180, WP-7 (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §2;
 * US9, OQ-9 = A, OQ-11 = A; FR-060, FR-061) — one Save for the screen. Its own sections (status,
 * VAT status, order-confirmation e-mails, fulfilment strategy, restrictions, custom fields) are
 * staged and written by it as the host part; `organization.detail.after`'s panels take part
 * through the session. Members, hierarchy, moderation, VAT validation, sales channels, roles and
 * sales representatives stay immediate, each labelled so. The session is one per organization.
 */
export function OrganizationDetail(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  return (
    <SaveSessionProvider resetKey={id} hostModule="organizations">
      <OrganizationDetailScreen id={id} />
    </SaveSessionProvider>
  );
}

function OrganizationDetailScreen({ id }: { id: string }): ReactNode {
  const t = useTranslation('core');
  const own = useTranslation('organizations');
  const isVisible = useSurfaceVisibility();
  const canReadRoles = isVisible({ module: 'organizations', requiredPermission: READ_ROLES });
  // `specs/177-tax-id-scope/` (`contracts/admin-surfaces.md` §4.2).
  const canConvert = isVisible({ module: 'organizations', requiredPermission: 'organizations:convert-to-company' });
  const [converting, setConverting] = useState(false);
  // Issue #1040 — the tax-ID correction; its VAT validation is a `customers:manage` write.
  const canChangeTaxId = isVisible({ module: 'organizations', requiredPermission: 'organizations:change-tax-id' });
  const canValidateTaxId = isVisible({ module: 'organizations', requiredPermission: 'customers:manage' });
  const [changingTaxId, setChangingTaxId] = useState(false);
  const [org, setOrg] = useState<OrgDetail | null>(null);
  // Feature 173 — the newest registration-time lookup's differing fields, as
  // the VAT validation panel loaded them, for the moderation notice.
  const [registryDivergenceCount, setRegistryDivergenceCount] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  // `null` = the form's default (Member) has not been changed.
  const [inviteRole, setInviteRole] = useState<string | null>(null);
  const [directEmail, setDirectEmail] = useState('');
  const [directFirst, setDirectFirst] = useState('');
  const [directLast, setDirectLast] = useState('');
  const [directPassword, setDirectPassword] = useState('');
  const [directRole, setDirectRole] = useState<string | null>(null);
  // Feature 175 (FR-018) — the new member's custom fields, sent with the create.
  const { hasPermission } = useAuth();
  const [directValues, setDirectValues] = useState<Record<string, unknown>>({});
  const [directValueErrors, setDirectValueErrors] = useState<Record<string, string>>({});
  /** Re-keys the embedded panel after a create, so the next member starts empty. */
  const [directFormKey, setDirectFormKey] = useState(0);
  const [roleList, setRoleList] = useState<OrganizationRoleView[] | null>(null);

  const [editMember, setEditMember] = useState<OrgMember | null>(null);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editEmail, setEditEmail] = useState('');

  // `quiet` re-reads without the full-screen loading state, which would unmount
  // the panels below — the Roles tab re-reads the members after a role change
  // and must keep its own confirmation on screen.
  const refresh = useCallback(async (options?: { quiet?: boolean }): Promise<void> => {
    if (!options?.quiet) setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: OrgDetail }>(`/api/v1/admin/organizations/${id}`);
      setOrg(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'NOT_FOUND') {
        setOrg(null);
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : t('organizations.detail.error.load'));
      }
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // FR-062: assigning a role needs `customers:manage` alone, so the role list
  // is read only when the operator may read it; otherwise the selects offer the
  // roles the members hold. A personal Organization's role routes answer 404.
  const orgLoaded = org !== null;
  const isPersonal = org?.isPersonal === true;
  const refreshRoles = useCallback(async (): Promise<void> => {
    if (!canReadRoles || !orgLoaded || isPersonal) {
      setRoleList(null);
      return;
    }
    try {
      const res = await organizationRolesClient.list(id);
      setRoleList(res.data);
    } catch {
      setRoleList(null);
    }
  }, [canReadRoles, orgLoaded, isPersonal, id]);

  useEffect(() => {
    void refreshRoles();
  }, [refreshRoles]);

  const roleOptions = useMemo((): OrganizationRoleRef[] => {
    if (roleList) return roleList.map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
    const held = new Map<string, OrganizationRoleRef>();
    for (const m of org?.members ?? []) held.set(m.organizationRole.id, m.organizationRole);
    return [...held.values()].sort(byKindThenName);
  }, [roleList, org]);

  // The invite and direct-create forms default to Member. Without the role list
  // its id may be unknown; the default is then `''`, sent as no `roleId`, which
  // the server resolves to the Organization's Member role.
  const formRoleOptions = useMemo((): { value: string; label: string }[] => {
    const options = roleOptions.map((r) => ({ value: r.id, label: r.name }));
    if (roleOptions.some((r) => r.kind === 'member')) return options;
    return [{ value: '', label: own('organizationRoles.member.name') }, ...options];
  }, [roleOptions, own]);
  const defaultFormRole = roleOptions.find((r) => r.kind === 'member')?.id ?? '';
  const inviteRoleValue = inviteRole ?? defaultFormRole;
  const directRoleValue = directRole ?? defaultFormRole;

  // Active warehouses feed the org-level fulfilment-strategy picker's
  // defined-order list. Best-effort; failure leaves the list empty.
  useEffect(() => {
    apiClient
      .get<{ items: Warehouse[] }>('/api/v1/admin/warehouses?activeOnly=true&pageSize=200')
      .then((res) => setWarehouses(res.items))
      .catch(() => setWarehouses([]));
  }, []);

  useEffect(() => {
    if (editMember) {
      setEditFirst(editMember.firstName);
      setEditLast(editMember.lastName);
      setEditEmail(editMember.email);
    }
  }, [editMember]);

  // --- The one Save (feature 180, WP-7) -------------------------------------------------
  const session = useSaveSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const canManage = hasPermission('customers:manage');
  const [edits, setEdits] = useState<HostEdits>({});
  // The stored allow-lists, as the restrictions panel last read them.
  const [restrictionsStored, setRestrictionsStored] = useState<RestrictionsSelection | null>(null);
  // A new value remounts what holds a read of its own (the zone's panels, the custom-field
  // panel) and re-reads the restrictions — after a version conflict discarded every change.
  const [reloadKey, setReloadKey] = useState(0);
  const [restrictionsReloadKey, setRestrictionsReloadKey] = useState(0);
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const busy = saving || session.saving;
  const hostCount = org !== null && canManage ? hostChangeCount(edits, org, restrictionsStored) : 0;

  const changeEdits = useCallback((patch: Partial<HostEdits>): void => {
    setEdits((current) => ({ ...current, ...patch }));
    // The last save's summary belongs to it: an edit clears it (FR-016).
    sessionRef.current.clearOutcome();
    setInfo(null);
  }, []);

  // The member-edit overlay, the invite and the direct-add forms hold unsaved
  // data-entry of their own (each applies immediately on its button); the page's
  // Save covers the rest. Warn before leaving if any of them holds an edit.
  const memberEditDirty =
    editMember !== null &&
    (editFirst !== editMember.firstName ||
      editLast !== editMember.lastName ||
      editEmail !== editMember.email);
  const inviteDirty = inviteEmail !== '';
  const directAddDirty =
    directEmail !== '' || directFirst !== '' || directLast !== '' || directPassword !== '';
  useUnsavedChangesPrompt(memberEditDirty || inviteDirty || directAddDirty || hostCount + session.dirtyCount > 0);

  // The latest stored organization, read by the host part when Save runs.
  const orgRef = useRef(org);
  orgRef.current = org;
  const conflictRef = useRef(false);

  /**
   * The host part's write, blocking: one `PATCH …/organizations/:id` with `expectedUpdatedAt`
   * for every changed field of the screen's own sections, then — when the allow-lists changed —
   * the restrictions `PUT`, gated by the version that `PATCH` answered (or the one read, when
   * nothing else changed). A `VERSION_CONFLICT` on either is flagged for the reload below; it
   * is rethrown, so the session writes no panel after it (FR-015).
   */
  const writeHost = useCallback(
    async (staged: HostEdits, stored: RestrictionsSelection | null): Promise<void> => {
      const current = orgRef.current;
      if (current === null) return;
      setCustomFieldErrors({});
      const body = patchBodyOf(staged, current);
      const restrictions =
        staged.restrictions !== undefined && stored !== null && changedRestrictionLists(staged.restrictions, stored) > 0
          ? staged.restrictions
          : null;
      let version = current.version ?? 0;
      let patched = false;
      try {
        if (Object.keys(body).length > 0) {
          const res = await apiClient.patch<{ data: OrgDetail }>(`/api/v1/admin/organizations/${id}`, {
            ...body,
            ...(current.updatedAt !== undefined ? { expectedUpdatedAt: current.updatedAt } : {}),
          });
          patched = true;
          version = res.data.version ?? version;
        }
        if (restrictions !== null) {
          await apiClient.put(`/api/v1/admin/organizations/${id}/restrictions`, {
            expectedVersion: version,
            paymentMethodIds: [...restrictions.paymentMethodIds],
            deliveryMethodIds: [...restrictions.deliveryMethodIds],
            warehouseIds: [...restrictions.warehouseIds],
          });
          setRestrictionsStored(restrictions);
        }
      } catch (err) {
        if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
          conflictRef.current = true;
        } else {
          setCustomFieldErrors(customFieldErrorsOf(err) ?? {});
          if (patched) {
            // The organization's fields are saved; what is left staged is the allow-lists.
            setEdits((latest) => (latest.restrictions === undefined ? {} : { restrictions: latest.restrictions }));
            await refresh({ quiet: true });
          }
        }
        throw err;
      }
      setEdits({});
      await refresh({ quiet: true });
    },
    [id, refresh],
  );

  /**
   * The one Save: the host part first (blocking), then every participant in zone order
   * (OQ-2 = A). A version conflict reloads the organization and discards every change on the
   * page — the host's and every panel's — and says so.
   */
  const savePage = async (): Promise<void> => {
    if (org === null) return;
    const staged = edits;
    const stored = restrictionsStored;
    const host: SavePart | null =
      hostCount > 0
        ? {
            id: 'host',
            label: own('detail.save.hostPartLabel'),
            blocking: true,
            count: hostCount,
            validate: async () => ({ fields: {} }),
            save: async () => writeHost(staged, stored),
          }
        : null;
    if (host === null && sessionRef.current.dirtyCount === 0) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    conflictRef.current = false;
    try {
      const outcome = await sessionRef.current.run(host);
      if (conflictRef.current) {
        conflictRef.current = false;
        sessionRef.current.discardAll();
        setEdits({});
        setCustomFieldErrors({});
        setReloadKey((n) => n + 1);
        setRestrictionsReloadKey((n) => n + 1);
        await refresh({ quiet: true });
        setError(own('detail.save.conflict'));
        return;
      }
      if (outcome.result === 'saved') setInfo(t('organizations.detail.info.saved'));
    } finally {
      setSaving(false);
    }
  };

  /** The summary's "Show": the part's first marked field, else its first control. */
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const showPart = (partId: string): void => {
    setTimeout(() => {
      const root: ParentNode | null = partId === 'host' ? document : zoneRef.current;
      const target =
        root?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        (partId === 'host'
          ? document.getElementById('ostatus')
          : zoneRef.current?.querySelector<HTMLElement>('select, input, textarea'));
      target?.focus();
    }, 0);
  };

  const inviteMember = useCallback(async (): Promise<void> => {
    if (!inviteEmail.trim()) return;
    setError(null);
    try {
      await apiClient.post(`/api/v1/admin/organizations/${id}/members/invite`, {
        email: inviteEmail.trim(),
        ...(inviteRoleValue ? { roleId: inviteRoleValue } : {}),
      });
      setInfo(t('organizations.detail.info.invited'));
      setInviteEmail('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('organizations.detail.error.invite'));
    }
  }, [id, inviteEmail, inviteRoleValue, refresh, t]);

  const directAdd = useCallback(async (): Promise<void> => {
    setError(null);
    setDirectValueErrors({});
    try {
      await apiClient.post(`/api/v1/admin/organizations/${id}/members`, {
        email: directEmail.trim(),
        firstName: directFirst.trim(),
        lastName: directLast.trim(),
        password: directPassword,
        ...(directRoleValue ? { roleId: directRoleValue } : {}),
        ...(Object.keys(directValues).length > 0 ? { customFieldValues: directValues } : {}),
      });
      setInfo(t('organizations.detail.info.memberCreated'));
      setDirectEmail('');
      setDirectFirst('');
      setDirectLast('');
      setDirectPassword('');
      setDirectValues({});
      setDirectFormKey((n) => n + 1);
      await refresh();
    } catch (err) {
      setDirectValueErrors(customFieldErrorsOf(err) ?? {});
      setError(err instanceof ApiError ? err.envelope.error.message : t('organizations.detail.error.create'));
    }
  }, [id, directEmail, directFirst, directLast, directPassword, directRoleValue, directValues, refresh, t]);

  const changeMemberRole = useCallback(
    async (memberId: string, roleId: string, expectedUpdatedAt?: string): Promise<void> => {
      setError(null);
      try {
        await apiClient.patch(`/api/v1/admin/organizations/${id}/members/${memberId}/role`, {
          roleId,
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        setInfo(t('organizations.detail.info.memberUpdated'));
        await refresh();
      } catch (err) {
        if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
          setError(t('organizations.detail.error.versionConflictMember'));
          await refresh();
          setError(null);
        } else {
          setError(err instanceof ApiError ? err.envelope.error.message : t('organizations.detail.error.roleUpdate'));
        }
      }
    },
    [id, refresh, t],
  );

  const saveMemberProfile = useCallback(async (): Promise<void> => {
    if (!editMember?.updatedAt) return;
    setError(null);
    try {
      await apiClient.patch(`/api/v1/admin/organizations/${id}/members/${editMember.id}`, {
        firstName: editFirst.trim(),
        lastName: editLast.trim(),
        email: editEmail.trim(),
        expectedUpdatedAt: editMember.updatedAt,
      });
      setInfo(t('organizations.detail.info.profileSaved'));
      setEditMember(null);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
        setError(t('organizations.detail.error.versionConflictMember'));
        await refresh();
        setError(null);
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : t('organizations.detail.error.save'));
      }
    }
  }, [editMember, editFirst, editLast, editEmail, id, refresh, t]);

  const removeMember = useCallback(
    async (memberId: string): Promise<void> => {
      setError(null);
      try {
        await apiClient.delete(`/api/v1/admin/organizations/${id}/members/${memberId}`);
        setInfo(t('organizations.detail.info.memberRemoved'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('organizations.detail.error.remove'));
      }
    },
    [id, refresh, t],
  );

  if (loading) return <p className="text-sm text-muted-foreground">{t('organizations.loading')}</p>;
  if (!org)
    return (
      <Alert variant="warning">
        <AlertDescription>{t('organizations.detail.notFound')}</AlertDescription>
      </Alert>
    );

  // Last-administrator protection keys off the role's kind, never its name.
  const adminCount = org.members.filter((m) => m.organizationRole.kind === 'administrator').length;

  return (
    <>
      <PageHeader
        title={org.name}
        description={
          <span>
            {/* A personal Organization has no tax ID (`specs/177-tax-id-scope/`). */}
            {org.isPersonal ? (
              <span>{t('organizations.personalAccount')}</span>
            ) : org.taxId ? (
              <>
                {t('organizations.detail.taxIdLabel')} <code className="font-mono text-xs">{org.taxId}</code>
              </>
            ) : null}
            {org.updatedAt ? (
              <>
                {' '}
                · {t('organizations.detail.updatedLabel')}{' '}
                <time dateTime={org.updatedAt}>{formatDateTime(org.updatedAt)}</time>
              </>
            ) : null}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link to="/organizations">
                <ArrowLeft />
                {t('organizations.detail.back')}
              </Link>
            </Button>
            {org.isPersonal && canConvert ? (
              <Button type="button" variant="secondary" onClick={(): void => setConverting(true)}>
                {own('convertToCompany.button')}
              </Button>
            ) : null}
            {!org.isPersonal && canChangeTaxId ? (
              <Button type="button" variant="secondary" onClick={(): void => setChangingTaxId(true)}>
                {own('changeTaxId.button')}
              </Button>
            ) : null}
            <SaveSessionActions hostCount={hostCount} canSave={canManage} saving={busy} onSave={(): void => void savePage()} />
          </div>
        }
      />

      {showSummary(session.lastOutcome) || session.notices.length > 0 ? (
        <div className="mb-4">
          <SaveSessionSummary
            outcome={showSummary(session.lastOutcome) ? session.lastOutcome : null}
            notices={session.notices}
            onShow={showPart}
          />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-4">
        <ModerationActionsPanel
          organizationId={org.id}
          status={org.status}
          version={org.version ?? 0}
          blockedReason={org.blockedReason ?? null}
          rejectedReason={org.rejectedReason ?? null}
          approvedAt={org.approvedAt ?? null}
          registryDivergenceCount={registryDivergenceCount}
          vatValidationAnchorId={VAT_VALIDATION_HEADING_ID}
          onChanged={refresh}
        />
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('organizations.detail.statusCard')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ostatus">{t('organizations.detail.accountStatus')}</Label>
            <Select
              id="ostatus"
              value={edits.status ?? org.status}
              disabled={busy}
              onChange={(e): void => changeEdits({ status: e.target.value as OrgDetail['status'] })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vstatus">{t('organizations.detail.vatStatus')}</Label>
            <Select
              id="vstatus"
              value={edits.vatStatus ?? org.vatStatus}
              disabled={busy}
              onChange={(e): void => changeEdits({ vatStatus: e.target.value as OrgDetail['vatStatus'] })}
            >
              {VAT_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="orderConfEmails">{t('organizations.detail.orderConfirmationEmails')}</Label>
            <textarea
              id="orderConfEmails"
              aria-label="order-confirmation-emails"
              className="min-h-20 w-full rounded-md border p-2 text-sm"
              value={edits.emailsText ?? (org.orderConfirmationEmails ?? []).join('\n')}
              placeholder={'ops@example.com\nsales@example.com'}
              disabled={busy}
              onChange={(e): void => changeEdits({ emailsText: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {t('organizations.detail.orderConfirmationEmailsHint')}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('organizations.detail.registeredAddress')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            {org.registeredAddress.street}
            <br />
            {org.registeredAddress.postalCode} {org.registeredAddress.city}
            <br />
            {org.registeredAddress.country}
          </p>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            {t('organizations.detail.inviteCard')}
            <ImmediateBadge />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="invite-email">{t('organizations.detail.email')}</Label>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder={t('organizations.detail.emailPlaceholder')}
              className="w-64"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">{t('organizations.detail.role')}</Label>
            <Select
              id="invite-role"
              value={inviteRoleValue}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              {formRoleOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" onClick={() => void inviteMember()}>
            {t('organizations.detail.sendInvite')}
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            {t('organizations.detail.directAddCard')}
            <ImmediateBadge />
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="d-email">{t('organizations.detail.email')}</Label>
            <Input
              id="d-email"
              type="email"
              value={directEmail}
              onChange={(e) => setDirectEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-pw">{t('organizations.detail.tempPassword')}</Label>
            <Input
              id="d-pw"
              type="password"
              value={directPassword}
              onChange={(e) => setDirectPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-fn">{t('organizations.detail.firstName')}</Label>
            <Input id="d-fn" value={directFirst} onChange={(e) => setDirectFirst(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-ln">{t('organizations.detail.lastName')}</Label>
            <Input id="d-ln" value={directLast} onChange={(e) => setDirectLast(e.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="d-role">{t('organizations.detail.role')}</Label>
            <Select
              id="d-role"
              value={directRoleValue}
              onChange={(e) => setDirectRole(e.target.value)}
            >
              {formRoleOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          {/* Feature 175 — the `customer` custom fields of the account being created. */}
          {hasPermission('custom_fields:read') ? (
            <div className="md:col-span-2">
              <CustomFieldValuesPanel
                key={directFormKey}
                entityType="customer"
                values={EMPTY_MEMBER_VALUES}
                onChange={setDirectValues}
                fieldErrors={directValueErrors}
              />
            </div>
          ) : null}
          <div className="md:col-span-2">
            <Button type="button" onClick={() => void directAdd()}>
              {t('organizations.detail.createMember')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            {t('organizations.detail.membersCard')}
            <ImmediateBadge />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {editMember ? (
            <div className="mb-6 rounded-lg border border-border p-4">
              <h3 className="mb-3 text-sm font-medium">{t('organizations.detail.editMember')}</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-email">{t('organizations.detail.email')}</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-fn">{t('organizations.detail.firstName')}</Label>
                  <Input
                    id="edit-fn"
                    value={editFirst}
                    onChange={(e) => setEditFirst(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-ln">{t('organizations.detail.lastName')}</Label>
                  <Input
                    id="edit-ln"
                    value={editLast}
                    onChange={(e) => setEditLast(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" onClick={() => void saveMemberProfile()}>
                  {t('organizations.detail.save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditMember(null)}>
                  {t('organizations.detail.cancel')}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('organizations.detail.changeEmailHint')}
              </p>
            </div>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('organizations.detail.email')}</TableHead>
                <TableHead>{t('organizations.detail.nameCol')}</TableHead>
                <TableHead>{t('organizations.detail.role')}</TableHead>
                <TableHead>{t('organizations.detail.verified')}</TableHead>
                <TableHead>{t('organizations.detail.lastLogin')}</TableHead>
                <TableHead>{t('organizations.detail.twoFactor')}</TableHead>
                <TableHead className="text-right">{t('organizations.detail.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.email}</TableCell>
                  <TableCell>
                    {m.firstName} {m.lastName}
                  </TableCell>
                  <TableCell>
                    <Select
                      aria-label={t('organizations.detail.roleForLabel', { email: m.email })}
                      value={m.organizationRole.id}
                      onChange={(e): void =>
                        void changeMemberRole(
                          m.id,
                          e.target.value,
                          m.updatedAt ?? undefined,
                        )
                      }
                      className="max-w-[14rem]"
                    >
                      {roleOptions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell>
                    {m.emailVerifiedAt ? formatDateTime(m.emailVerifiedAt) : '—'}
                  </TableCell>
                  <TableCell>
                    {m.lastLoginAt ? formatDateTime(m.lastLoginAt) : '—'}
                  </TableCell>
                  <TableCell>{m.twoFactorEnabled ? t('organizations.detail.twoFactorOn') : '—'}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditMember(m)}
                    >
                      {t('organizations.detail.edit')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        m.organizationRole.kind === 'administrator' && adminCount <= 1
                      }
                      onClick={() => void removeMember(m.id)}
                    >
                      {t('organizations.detail.remove')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {converting ? (
        <ModalDialog
          title={own('convertToCompany.dialogTitle')}
          onClose={(): void => setConverting(false)}
          widthClassName="max-w-2xl"
        >
          <ConvertToCompanyForm
            organizationId={org.id}
            defaultCountry={org.registeredAddress?.country ?? null}
            onCancel={(): void => setConverting(false)}
            onConverted={(result: ConvertToCompanyResult): void => {
              setConverting(false);
              setInfo(conversionMessage(own, result));
              void refresh({ quiet: true });
            }}
          />
        </ModalDialog>
      ) : null}

      {changingTaxId ? (
        <ModalDialog title={own('changeTaxId.dialogTitle')} onClose={(): void => setChangingTaxId(false)} widthClassName="max-w-lg">
          <ChangeTaxIdForm
            organizationId={org.id}
            currentTaxId={org.taxId ?? null}
            canValidate={canValidateTaxId}
            onCancel={(): void => setChangingTaxId(false)}
            onChanged={(result: ChangeTaxIdResult): void => {
              setChangingTaxId(false);
              setInfo(taxIdChangeMessage(own, result));
              void refresh({ quiet: true });
            }}
          />
        </ModalDialog>
      ) : null}

      {/* Feature 170 — the Organization's roles (US 7). Mounted for a company
          Organization and an operator holding a role code; it hides itself
          otherwise and requests nothing. */}
      <OrganizationRolesTab
        organizationId={org.id}
        isPersonal={org.isPersonal === true}
        onRolesChanged={(): void => {
          void refreshRoles();
          void refresh({ quiet: true });
        }}
      />

      {/* Feature 091 / P7b — the place at the end of this screen, where a module
          that has something to say about an organization says it. **One mount,
          and that is a rule rather than a layout choice**: this member carries
          no prop that could tell two mounts apart, so a second one would render
          every contribution twice.

          Contributions arrive here ordered by their declared weight:
          `price_lists`' display-mode override (200), `quick_order`'s ordering
          defaults (300) and `carts`' approval policy (400). `sales_channels`'
          channel membership (100) is gone since feature 154 — the panel just
          above is this module's own editor of the same assignment, and two
          editors of it on one page would disagree about who may change it.

          No chrome around it, unlike `catalog`'s category editor: every
          contribution here renders its own card, so a wrapper would nest one
          card inside another and an empty zone renders nothing at all. */}
      {/* Feature 154 — the stores this Organization's members may use, first
          among the panels below the members because it decides whether they can
          sign in at all. */}
      <SalesChannelsPanel organizationId={org.id} />

      {/* Feature 180, WP-7 — the panels here take part in this screen's one Save. Re-keyed when
          a version conflict discarded every change, so each panel reads its stored value again. */}
      <div ref={zoneRef}>
        <AdminZone key={reloadKey} name="organization.detail.after" props={{ organizationId: org.id, saveSession: session.handle }} />
      </div>

      {/* Feature 056 US1 — organization hierarchy (parent picker + subtree view). */}
      <HierarchyPanel
        organizationId={org.id}
        parentId={org.parentId ?? null}
        onChanged={refresh}
      />

      {/* Feature 026 US4 — per-Organization payment / delivery / warehouse allow-lists. */}
      <div className="mt-4">
        <RestrictionsPanel
          organizationId={org.id}
          value={edits.restrictions ?? restrictionsStored}
          onChange={(next): void => changeEdits({ restrictions: next })}
          onLoaded={setRestrictionsStored}
          reloadKey={restrictionsReloadKey}
          disabled={busy || !canManage}
        />
      </div>

      {/* Feature 026 US7 — VAT-ID / NIP validation history + retrigger. A personal
          Organization has no tax ID to validate (`specs/177-tax-id-scope/` O14). */}
      {org.isPersonal ? null : (
        <div className="mt-4">
          <VatValidationPanel
            organizationId={org.id}
            summary={{
              outcome: org.vatValidation?.outcome ?? null,
              provider: org.vatValidation?.provider ?? null,
              validatedAt: org.vatValidation?.validatedAt ?? null,
            }}
            headingId={VAT_VALIDATION_HEADING_ID}
            onHistoryLoaded={(items) =>
              setRegistryDivergenceCount(newestRegistrationRow(items)?.divergence?.length ?? 0)
            }
            onChanged={refresh}
          />
        </div>
      )}

      {/* Org-level warehouse-picking (fulfilment) strategy override. */}
      <div className="mt-4">
        <FulfilmentStrategyPanel
          value={edits.fulfilment ?? storedFulfilment(org)}
          onChange={(next): void => changeEdits({ fulfilment: next })}
          warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
          disabled={busy}
        />
      </div>

      {/* Feature 026 US5 — read-only "what price lists apply to this org". */}
      <div className="mt-4">
        <ApplicablePriceListsPanel organizationId={org.id} />
      </div>

      {/* Feature 055 — operator-defined custom fields for this organization. Embedded rather
          than saving on its own (feature 180, WP-7): its bag travels in the host part's one
          `PATCH`, under the organization's `expectedUpdatedAt`, so the record's version check
          guards it with the rest (research R15). */}
      <div className="mt-4">
        <CustomFieldValuesPanel
          key={reloadKey}
          entityType="organization"
          values={edits.customFieldValues === undefined ? (org.customFieldValues ?? {}) : { ...(org.customFieldValues ?? {}), ...edits.customFieldValues }}
          onChange={(bag): void => changeEdits({ customFieldValues: bag })}
          fieldErrors={customFieldErrors}
        />
      </div>

      {id ? <OrganizationSalesRepsTab organizationId={id} /> : null}
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default OrganizationDetail;

/**
 * A summary worth showing: anything but a full save. A version conflict is not one — it
 * discards the outcome with every change and the screen says so in its own words.
 */
function showSummary(outcome: SaveOutcome | null): boolean {
  return outcome !== null && outcome.result !== 'saved';
}

/** The page's success line after a conversion: the VAT validation's outcome when one ran. */
function conversionMessage(own: (key: string) => string, result: ConvertToCompanyResult): string {
  const outcome = result.vatValidation?.outcome;
  if (!outcome) return own('convertToCompany.success.plain');
  const known = ['validated', 'invalid', 'deferred', 'failed'];
  return own(`convertToCompany.success.${known.includes(outcome) ? outcome : 'failed'}`);
}
