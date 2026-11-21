import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Briefcase, Building2, Receipt, ShoppingCart, Users } from 'lucide-react';
import type {
  AdminOrganization,
  AdminOrganizationDetail,
  OrganizationRoleRef,
  OrganizationRoleView,
  Warehouse,
} from '@endora-commerce/contracts';
import {
  ApiError,
  SaveSessionProvider,
  apiClient,
  formatDateTime,
  useAuth,
  useDetailResource,
  useSaveSession,
  useSurfaceVisibility,
  useUnsavedChangesPrompt,
  type SaveOutcome,
  type SavePart,
} from '@endora-commerce/admin-kit/lib';
import { FulfilmentStrategyPanel } from '../panels/FulfilmentStrategyPanel.js';
import { OrganizationSalesRepsTab } from '../components/OrganizationSalesRepsTab.js';
import { OrganizationRolesTab } from '../components/OrganizationRolesTab.js';
import { OrganizationMembersSection } from '../components/OrganizationMembersSection.js';
import { ConvertToCompanyForm, type ConvertToCompanyResult } from '../components/ConvertToCompanyForm.js';
import { ChangeTaxIdForm, taxIdChangeMessage, type ChangeTaxIdResult } from '../components/ChangeTaxIdForm.js';
import { ChangeVatStatusForm } from '../components/ChangeVatStatusForm.js';
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
  DetailHeaderActions,
  ImmediateBadge,
  ModalDialog,
  SaveSessionActions,
  SaveSessionSummary,
  customFieldErrorsOf,
  type FulfilmentStrategyValue,
} from '@endora-commerce/admin-kit/components';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  DetailSkeleton,
  EditorSection,
  InlineStatus,
  Label,
  PageHeader,
  RecordTabs,
  Textarea,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/** The VAT validation panel's heading — where the moderation notice's link lands. */
const VAT_VALIDATION_HEADING_ID = 'organization-vat-validation';

/**
 * Issue #1515 (UX audit SALES-02) — the screen's tabs, kept in `?tab=` so a link can open one.
 * **Overview**: status, address, hierarchy, custom fields. **Members & roles**. **Commerce**:
 * channels, ordering rules, price lists and the `organization.detail.after` panels. **Tax**:
 * the tax identity, its corrections and the VAT validation. **Sales**: the sales
 * representatives, offered only to an operator who may assign them.
 */
export type OrganizationTab = 'overview' | 'members' | 'commerce' | 'tax' | 'sales';

const TABS: readonly OrganizationTab[] = ['overview', 'members', 'commerce', 'tax', 'sales'];

/** The tab `?tab=` names; Overview for anything else, and for Sales when it is not offered. */
export function organizationTabOf(value: string | null, salesShown: boolean): OrganizationTab {
  const tab = TABS.find((candidate) => candidate === value) ?? 'overview';
  return tab === 'sales' && !salesShown ? 'overview' : tab;
}

/** `GET /api/v1/admin/organizations/:id` (`adminOrganizationDetailSchema`, issue #599). */
type OrgDetail = AdminOrganizationDetail;

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
  let count = ['orderConfirmationEmails', 'fulfilmentStrategy'].filter((key) => key in body).length;
  count += changedCustomFields(edits.customFieldValues, org.customFieldValues ?? {});
  if (edits.restrictions !== undefined && restrictions !== null) count += changedRestrictionLists(edits.restrictions, restrictions);
  return count;
}

/**
 * Feature 180, WP-7 (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §2;
 * US9, OQ-9 = A, OQ-11 = A; FR-060, FR-061) — one Save for the screen. Its own sections
 * (order-confirmation e-mails, fulfilment strategy, restrictions, custom fields) are staged and
 * written by it as the host part; `organization.detail.after`'s panels take part through the
 * session. Members, hierarchy, moderation, VAT validation, sales channels, roles and sales
 * representatives stay immediate, each labelled so. The session is one per organization.
 *
 * Issue #1468 (SALES-01, DEC-07) — one editor per concept. The organization status is shown and
 * changed only by the moderation panel, its one writer; the VAT status is read-only in the header
 * and changed by the immediate "Change VAT status…" dialog (owner ruling OQ-1 = B). Neither is
 * staged, counted or sent by the Save.
 *
 * Issue #1515 (UX audit SALES-02) — one card of five tabs (`OrganizationTab`) instead of a stack
 * of cards: each panel is a section of its tab, the header holds Back and the one Save, and the
 * tax corrections sit on the Tax tab beside the values they change.
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
  // Issue #1468 — the VAT status correction is the `customers:manage` PATCH, offered like the
  // tax-ID change: only while `organizations` is present.
  const canChangeVatStatus = isVisible({ module: 'organizations', requiredPermission: 'customers:manage' });
  const [changingVatStatus, setChangingVatStatus] = useState(false);
  // The Sales tab's one section gates itself on this code (`OrganizationSalesRepsTab`); the
  // tab is offered on the same answer, so it is never an empty tab.
  const canSeeSalesReps = isVisible({ module: 'organizations', requiredPermission: 'organizations:assign-sales-rep' });
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = organizationTabOf(searchParams.get('tab'), canSeeSalesReps);
  const selectTab = useCallback(
    (next: OrganizationTab): void => {
      setSearchParams(
        (params) => {
          const updated = new URLSearchParams(params);
          if (next === 'overview') updated.delete('tab');
          else updated.set('tab', next);
          return updated;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  // Feature 173 — the newest registration-time lookup's differing fields, as
  // the VAT validation panel loaded them, for the moderation notice.
  const [registryDivergenceCount, setRegistryDivergenceCount] = useState(0);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * Issue #1499 (SALES-17, DEC-12 a) — a result is said beside the control that caused it, in
   * a region mounted empty from the first render: Save and the header's dialogs in the
   * header, a member write right above the Members section — not as a success banner above
   * the page.
   */
  const actionStatus = useInlineStatus();
  const membersStatus = useInlineStatus();
  // Issue #1515 — a tax correction's result, beside the Tax tab's buttons that opened it.
  const taxStatus = useInlineStatus();
  const clearActionStatus = actionStatus.clear;

  const { hasPermission } = useAuth();
  const [roleList, setRoleList] = useState<OrganizationRoleView[] | null>(null);

  // Issue #1516 (SALES-14) — whether a member dialog holds typed input.
  const [membersDirty, setMembersDirty] = useState(false);

  // Issue #1447 (DS-14, SALES-06) — a skeleton on the first load only. Every
  // re-read after an invite, a member change or a panel's save keeps the page,
  // its tab and the panels' own confirmations on screen, marked `aria-busy`;
  // this screen's old `quiet` option is now the only behaviour.
  const resource = useDetailResource<OrgDetail>(id, async () => {
    try {
      const res = await apiClient.get<{ data: OrgDetail }>(`/api/v1/admin/organizations/${id}`);
      return res.data;
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'NOT_FOUND') return null;
      throw err;
    }
  });
  const org = resource.data;
  const reread = resource.refresh;
  const loadError =
    resource.error === null
      ? null
      : resource.error instanceof ApiError
        ? resource.error.envelope.error.message
        : t('organizations.detail.error.load');
  // A re-read clears the previous action's error, as the old full reload did.
  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    await reread();
  }, [reread]);

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

  // Active warehouses feed the org-level fulfilment-strategy picker's
  // defined-order list. Best-effort; failure leaves the list empty.
  useEffect(() => {
    apiClient
      .get<{ items: Warehouse[] }>('/api/v1/admin/warehouses?activeOnly=true&pageSize=200')
      .then((res) => setWarehouses(res.items))
      .catch(() => setWarehouses([]));
  }, []);

  // --- The one Save (feature 180, WP-7) -------------------------------------------------
  const session = useSaveSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // The host part's writes need `customers:manage`; without it the screen's own sections are
  // read-only, so nothing is staged that the Save would never write (FR-035).
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
    clearActionStatus();
  }, [clearActionStatus]);

  // The member dialogs hold unsaved data-entry of their own (each applies immediately on its
  // button); the page's Save covers the rest. Warn before leaving if any of them holds an edit.
  useUnsavedChangesPrompt(membersDirty || hostCount + session.dirtyCount > 0);

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
          const res = await apiClient.patch<{ data: AdminOrganization }>(`/api/v1/admin/organizations/${id}`, {
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
            await refresh();
          }
        }
        throw err;
      }
      setEdits({});
      await refresh();
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
    actionStatus.clear();
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
        await refresh();
        setError(own('detail.save.conflict'));
        return;
      }
      if (outcome.result === 'saved') actionStatus.show(t('organizations.detail.info.saved'));
    } finally {
      setSaving(false);
    }
  };

  /**
   * The summary's "Show": the part's first marked field, else its first control — on whichever
   * tab holds it, which is opened first (a hidden control cannot take focus).
   */
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const showPart = (partId: string): void => {
    const root: ParentNode | null = partId === 'host' ? document : zoneRef.current;
    const target =
      root?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      (partId === 'host'
        ? document.getElementById('orderConfEmails')
        : zoneRef.current?.querySelector<HTMLElement>('select, input, textarea'));
    const owner = target?.closest<HTMLElement>('[data-org-tab]')?.dataset['orgTab'];
    if (owner !== undefined) selectTab(organizationTabOf(owner, canSeeSalesReps));
    setTimeout(() => target?.focus(), 0);
  };

  /** The moderation notice's link: open the Tax tab, then bring the VAT validation into view. */
  const showVatValidation = (): void => {
    selectTab('tax');
    setTimeout(() => {
      const section = document.getElementById(VAT_VALIDATION_HEADING_ID);
      section?.scrollIntoView?.({ block: 'start' });
      section?.focus();
    }, 0);
  };

  /** Issue #1516 — a member write succeeded: say so, then re-read the Organization. */
  const membersChanged = useCallback(
    async (message: string): Promise<void> => {
      membersStatus.show(message);
      await refresh();
    },
    [refresh, membersStatus],
  );

  if (resource.initialLoading) return <DetailSkeleton label={t('organizations.loading')} />;
  if (!org)
    return loadError !== null ? (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          {loadError}
          <Button variant="outline" size="sm" onClick={(): void => void refresh()}>
            {t('common.action.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    ) : (
      <Alert variant="warning">
        <AlertDescription>{t('organizations.detail.notFound')}</AlertDescription>
      </Alert>
    );

  const salesTabShown = canSeeSalesReps;
  // Zeigarnik: a tab says it holds what the page Save has not written yet. The custom fields are
  // Overview's; every other host change and every zone panel is Commerce's.
  const customFieldCount = canManage ? changedCustomFields(edits.customFieldValues, org.customFieldValues ?? {}) : 0;
  const overviewUnsaved = customFieldCount > 0;
  const commerceUnsaved = hostCount - customFieldCount + session.dirtyCount > 0;
  const unsavedLabel = own('detail.tabs.unsaved');
  const tabItems = [
    { value: 'overview' as const, label: own('detail.tabs.overview'), icon: <Building2 />, unsaved: overviewUnsaved ? unsavedLabel : undefined },
    { value: 'members' as const, label: own('detail.tabs.members'), icon: <Users /> },
    { value: 'commerce' as const, label: own('detail.tabs.commerce'), icon: <ShoppingCart />, unsaved: commerceUnsaved ? unsavedLabel : undefined },
    { value: 'tax' as const, label: own('detail.tabs.tax'), icon: <Receipt /> },
    ...(salesTabShown ? [{ value: 'sales' as const, label: own('detail.tabs.sales'), icon: <Briefcase /> }] : []),
  ];

  return (
    <>
      <PageHeader
        back={{ label: t('organizations.detail.back'), to: '/organizations' }}
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
            {/* Issue #1468 — read-only here, a labelled text badge rather than colour alone; it is
                changed by "Change VAT status…" on the Tax tab. A personal Organization has one too. */}
            {org.isPersonal || org.taxId ? ' · ' : null}
            <span>
              {t('organizations.detail.vatStatus')}:{' '}
              <Badge variant="outline">{own(`vatStatus.${org.vatStatus}`)}</Badge>
            </span>
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
          // Issue #1515 (SALES-02) — the page Save is the one primary (Von Restorff), last in
          // reading order; the tax corrections moved to the Tax tab, beside what they change.
          <DetailHeaderActions
            status={actionStatus.props}
            primary={
              <SaveSessionActions hostCount={hostCount} canSave={canManage} saving={busy} onSave={(): void => void savePage()} />
            }
          />
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

      {(error ?? loadError) ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error ?? loadError}</AlertDescription>
        </Alert>
      ) : null}

      {/* Issue #1515 (UX audit SALES-02) — one card of tabs instead of sixteen stacked cards
          and five more from the zone (Hick, Miller/Chunking, Common Region). Every tab stays
          mounted while another is open: the Save's participants keep their drafts, the VAT
          history feeds the moderation notice, and the tabs only change what is visible. */}
      <RecordTabs
        className="mb-4"
        items={tabItems}
        value={tab}
        onValueChange={selectTab}
        idBase="organization-detail"
        aria-label={own('detail.tabs.label')}
        panelProps={resource.busyProps}
      >
        <div hidden={tab !== 'overview'} data-org-tab="overview" className="space-y-(--section-gap)">
          {/* Issue #1541 (SALES-15) — the status and only the transitions it allows. */}
          <ModerationActionsPanel
            organizationId={org.id}
            status={org.status}
            version={org.version ?? 0}
            blockedReason={org.blockedReason ?? null}
            rejectedReason={org.rejectedReason ?? null}
            approvedAt={org.approvedAt ?? null}
            registryDivergenceCount={registryDivergenceCount}
            vatValidationAnchorId={VAT_VALIDATION_HEADING_ID}
            {...(org.isPersonal ? {} : { onShowVatValidation: showVatValidation })}
            canModerate={canManage}
            onChanged={refresh}
          />

          <EditorSection title={t('organizations.detail.registeredAddress')}>
            <p className="text-sm">
              {org.registeredAddress.street}
              <br />
              {org.registeredAddress.postalCode} {org.registeredAddress.city}
              <br />
              {org.registeredAddress.country}
            </p>
          </EditorSection>

          {/* Feature 056 US1 — organization hierarchy (parent picker + subtree view). */}
          <HierarchyPanel organizationId={org.id} parentId={org.parentId ?? null} onChanged={refresh} />

          {/* Feature 055 — operator-defined custom fields for this organization. Embedded rather
              than saving on its own (feature 180, WP-7): its bag travels in the host part's one
              `PATCH`, under the organization's `expectedUpdatedAt`, so the record's version check
              guards it with the rest (research R15). */}
          <CustomFieldValuesPanel
            key={reloadKey}
            entityType="organization"
            values={edits.customFieldValues === undefined ? (org.customFieldValues ?? {}) : { ...(org.customFieldValues ?? {}), ...edits.customFieldValues }}
            onChange={(bag): void => changeEdits({ customFieldValues: bag })}
            fieldErrors={customFieldErrors}
            readOnly={!canManage}
          />
        </div>

        <div hidden={tab !== 'members'} data-org-tab="members" className="space-y-(--section-gap)">
          {/* Issue #1516 (SALES-14) — one Members section: the list, one Add member, and the
              edit and remove dialogs. Its writes stay immediate. */}
          <InlineStatus {...membersStatus.props} className={membersStatus.props.children ? 'mb-2' : ''} />
          <OrganizationMembersSection
            organizationId={org.id}
            organizationName={org.name}
            isPersonal={org.isPersonal === true}
            members={org.members}
            roleOptions={roleOptions}
            canManage={canManage}
            canReadCustomFields={hasPermission('custom_fields:read')}
            onChanged={membersChanged}
            onStale={refresh}
            onDirtyChange={setMembersDirty}
          />

          {/* Feature 170 — the Organization's roles (US 7). Mounted for a company
              Organization and an operator holding a role code; it hides itself
              otherwise and requests nothing. */}
          <OrganizationRolesTab
            organizationId={org.id}
            isPersonal={org.isPersonal === true}
            onRolesChanged={(): void => {
              void refreshRoles();
              void refresh();
            }}
          />
        </div>

        <div hidden={tab !== 'commerce'} data-org-tab="commerce" className="space-y-(--section-gap)">
          {/* Feature 154 — the stores this Organization's members may use, first because it
              decides whether they can sign in at all. */}
          <SalesChannelsPanel organizationId={org.id} />

          <EditorSection title={t('organizations.detail.notificationsCard')}>
            <div className="space-y-2">
              <Label htmlFor="orderConfEmails">{own('detail.orderConfirmationEmails')}</Label>
              <Textarea
                id="orderConfEmails"
                className="min-h-20"
                value={edits.emailsText ?? (org.orderConfirmationEmails ?? []).join('\n')}
                placeholder={'ops@example.com\nsales@example.com'}
                disabled={busy || !canManage}
                aria-describedby="orderConfEmails-hint"
                onChange={(e): void => changeEdits({ emailsText: e.target.value })}
              />
              <p id="orderConfEmails-hint" className="text-xs text-muted-foreground">
                {own('detail.orderConfirmationEmailsHint')}
              </p>
            </div>
          </EditorSection>

          {/* Feature 026 US4 — per-Organization payment / delivery / warehouse allow-lists. */}
          <RestrictionsPanel
            organizationId={org.id}
            value={edits.restrictions ?? restrictionsStored}
            onChange={(next): void => changeEdits({ restrictions: next })}
            onLoaded={setRestrictionsStored}
            reloadKey={restrictionsReloadKey}
            disabled={busy || !canManage}
          />

          {/* Org-level warehouse-picking (fulfilment) strategy override. */}
          <FulfilmentStrategyPanel
            value={edits.fulfilment ?? storedFulfilment(org)}
            onChange={(next): void => changeEdits({ fulfilment: next })}
            warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
            disabled={busy || !canManage}
          />

          {/* Feature 026 US5 — read-only "what price lists apply to this org". */}
          <ApplicablePriceListsPanel organizationId={org.id} />

          {/* Feature 091 / P7b — the place where a module that has something to say about an
              organization says it. **One mount, and that is a rule rather than a layout
              choice**: this member carries no prop that could tell two mounts apart, so a
              second one would render every contribution twice. Contributions arrive ordered by
              their declared weight (`price_lists` 200, `quick_order` 300, `related_payers` and
              `quote_requests` 500, `crm` 600, `projects` 650).

              Issue #1515 — inside the Commerce tab's card, so its sections are sections, not
              cards (no `chrome="card"`). DS-20 (#1452) will let a contribution name its tab;
              until then they all sit here. The wrapper draws the one rule above the first of
              them and nothing at all when the zone renders nothing.

              Feature 180, WP-7 — the panels here take part in this screen's one Save. Re-keyed
              when a version conflict discarded every change, so each panel reads its stored
              value again. */}
          <div ref={zoneRef} className="space-y-(--section-gap) border-t pt-(--section-gap) empty:hidden">
            <AdminZone key={reloadKey} name="organization.detail.after" props={{ organizationId: org.id, saveSession: session.handle }} />
          </div>
        </div>

        <div hidden={tab !== 'tax'} data-org-tab="tax" className="space-y-(--section-gap)">
          <EditorSection
            title={own('detail.tax.title')}
            action={<ImmediateBadge />}
          >
            {/* A personal Organization has no tax ID, so no tax-ID label either
                (`specs/177-tax-id-scope/` O14); a company row without one shows none. */}
            {org.isPersonal ? <p className="text-sm text-muted-foreground">{own('detail.tax.noTaxId')}</p> : null}
            <dl className="grid gap-3 sm:grid-cols-2">
              {!org.isPersonal && org.taxId ? (
                <div className="space-y-1">
                  <dt className="text-xs text-muted-foreground">{t('organizations.detail.taxIdLabel')}</dt>
                  <dd className="text-sm">
                    <code className="font-mono">{org.taxId}</code>
                  </dd>
                </div>
              ) : null}
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">{t('organizations.detail.vatStatus')}</dt>
                <dd className="text-sm">
                  <Badge variant="outline">{own(`vatStatus.${org.vatStatus}`)}</Badge>
                </dd>
              </div>
            </dl>
            {/* The corrections sit beside the values they change (Proximity), as outline
                buttons under the page's one primary; each opens its own dialog and applies at
                once. Their result is said here, in a region mounted before it has text. */}
            <div className="flex flex-wrap items-center gap-2">
              {org.isPersonal && canConvert ? (
                <Button type="button" variant="outline" onClick={(): void => setConverting(true)}>
                  {own('convertToCompany.button')}
                </Button>
              ) : null}
              {!org.isPersonal && canChangeTaxId ? (
                <Button type="button" variant="outline" onClick={(): void => setChangingTaxId(true)}>
                  {own('changeTaxId.button')}
                </Button>
              ) : null}
              {canChangeVatStatus ? (
                <Button type="button" variant="outline" onClick={(): void => setChangingVatStatus(true)}>
                  {own('changeVatStatus.button')}
                </Button>
              ) : null}
              <InlineStatus {...taxStatus.props} className="max-w-sm" />
            </div>
          </EditorSection>

          {/* Feature 026 US7 — VAT-ID / NIP validation history + retrigger. A personal
              Organization has no tax ID to validate (`specs/177-tax-id-scope/` O14). */}
          {org.isPersonal ? null : (
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
          )}
        </div>

        {salesTabShown ? (
          <div hidden={tab !== 'sales'} data-org-tab="sales" className="space-y-(--section-gap)">
            <OrganizationSalesRepsTab organizationId={org.id} />
          </div>
        ) : null}
      </RecordTabs>

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
              taxStatus.show(conversionMessage(own, result));
              void refresh();
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
              taxStatus.show(taxIdChangeMessage(own, result));
              void refresh();
            }}
          />
        </ModalDialog>
      ) : null}

      {changingVatStatus ? (
        <ModalDialog
          title={own('changeVatStatus.dialogTitle')}
          onClose={(): void => setChangingVatStatus(false)}
          widthClassName="max-w-lg"
        >
          <ChangeVatStatusForm
            organizationId={org.id}
            currentVatStatus={org.vatStatus}
            expectedUpdatedAt={org.updatedAt}
            onCancel={(): void => setChangingVatStatus(false)}
            onStale={(): void => void refresh()}
            onChanged={(changed): void => {
              setChangingVatStatus(false);
              taxStatus.show(own(changed ? 'changeVatStatus.success.changed' : 'changeVatStatus.success.unchanged'), changed ? 'success' : 'info');
              if (changed) void refresh();
            }}
          />
        </ModalDialog>
      ) : null}
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
