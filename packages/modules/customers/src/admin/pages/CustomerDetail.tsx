import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  ApiError,
  SaveSessionProvider,
  apiClient,
  formatDateTime,
  useAuth,
  useSaveSession,
  useUnsavedChangesPrompt,
  type SavePart,
} from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { OrdersPanel, QuoteRequestsPanel, CartsPanel } from '../panels/HistoryPanels.js';
import {
  OrganizationAssignmentPanel,
  CustomerGroupPanel,
  AddressesPanel,
} from '../panels/ManagementPanels.js';
import {
  CustomFieldValuesPanel,
  SaveSessionActions,
  SaveSessionSummary,
  customFieldErrorsOf,
} from '@endora-commerce/admin-kit/components';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { ImmediateBadge } from '../components/ImmediateBadge.js';

interface AdminCustomerDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string | null;
  organizationName: string | null;
  customerGroupId: string | null;
  customerGroupName: string | null;
  blocked: boolean;
  deleted: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** Issue #652 (D-292) — the customer's e-mail language; `null` while unknown. */
  preferredLanguage?: string | null;
  block: { blockedAt: string; blockReason: string | null } | null;
  deletion: { deletedAt: string; anonymizedAt: string | null } | null;
  customFieldValues?: Record<string, unknown>;
}

/** The host part's unsaved changes: one per edited custom field (feature 180, WP-8). */
function customFieldChangeCount(
  edited: Record<string, unknown> | undefined,
  stored: Record<string, unknown>,
): number {
  if (edited === undefined) return 0;
  return Object.entries(edited).filter(
    ([key, value]) => JSON.stringify(value ?? null) !== JSON.stringify(stored[key] ?? null),
  ).length;
}

/**
 * Feature 180, WP-8 (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §3;
 * OQ-9 = A, FR-060, FR-061) — the customer detail runs one save session per customer. Its one
 * Save, in the page head, writes the customer's custom fields first (the host part, blocking) and
 * then every panel `customer.detail.after` contributed, in zone order. The account actions, the
 * organization and the customer-group assignments stay immediate and say so.
 */
export function CustomerDetail(): ReactNode {
  const { id = '' } = useParams();
  return (
    <SaveSessionProvider resetKey={id} hostModule="customers">
      <CustomerDetailScreen key={id} id={id} />
    </SaveSessionProvider>
  );
}

function CustomerDetailScreen({ id }: { id: string }): ReactNode {
  const t = useTranslation('customers');
  const { hasPermission } = useAuth();
  const [c, setC] = useState<AdminCustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminCustomerDetail }>(`/api/v1/admin/customers/${id}`);
      setC(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('detail.error'));
    }
  }, [id, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // --- The one Save (feature 180, WP-8) ---------------------------------------------------
  const session = useSaveSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // The edited custom-field bag — `undefined` until the operator edits a field, so a Save that
  // touched none sends no custom-fields request (feature 175's embedded mode).
  const [customFieldDraft, setCustomFieldDraft] = useState<Record<string, unknown> | undefined>(undefined);
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const storedValues = c?.customFieldValues ?? {};
  const hostCount = customFieldChangeCount(customFieldDraft, storedValues);
  // Leaving the page — an in-app link, a reload, closing the tab — asks once for every part.
  useUnsavedChangesPrompt(hostCount + session.dirtyCount > 0);

  const save = async (): Promise<void> => {
    const bag = customFieldDraft;
    const host: SavePart | null =
      bag !== undefined && hostCount > 0
        ? {
            id: 'host',
            label: t('detail.save.hostPartLabel'),
            blocking: true,
            count: hostCount,
            validate: async () => ({ fields: {} }),
            save: async () => {
              setCustomFieldErrors({});
              try {
                await apiClient.patch(`/api/v1/admin/customers/${id}/custom-fields`, bag);
              } catch (err) {
                setCustomFieldErrors(customFieldErrorsOf(err) ?? {});
                throw err;
              }
              setCustomFieldDraft(undefined);
              await refresh();
            },
          }
        : null;
    if (host === null && sessionRef.current.dirtyCount === 0) return;
    setSaving(true);
    setError(null);
    try {
      await sessionRef.current.run(host);
    } finally {
      setSaving(false);
    }
  };

  /** The summary's "Show": the custom fields' first marked field, else the page head. */
  const showPart = (partId: string): void => {
    setTimeout(() => {
      if (partId === 'host') {
        document.querySelector<HTMLElement>('[id^="cf-"][aria-invalid="true"], [id^="cf-"]')?.focus();
      }
    }, 0);
  };

  const act = useCallback(
    async (run: () => Promise<unknown>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await run();
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('detail.actionError'));
      } finally {
        setBusy(false);
      }
    },
    [refresh, t],
  );

  if (!c) {
    return (
      <>
        <PageHeader title={t('detail.title')} />
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">{t('detail.loading')}</p>
        )}
      </>
    );
  }

  const info: Array<[string, ReactNode]> = [
    [t('detail.field.email'), c.email],
    [t('detail.field.created'), formatDateTime(c.createdAt)],
    [t('detail.field.group'), c.customerGroupName ?? t('list.none')],
    [t('detail.field.organization'), c.organizationName ?? t('list.none')],
    [
      t('detail.field.status'),
      c.deleted ? (
        <Badge variant="outline">{t('status.deleted')}</Badge>
      ) : c.blocked ? (
        <Badge variant="destructive">{t('status.blocked')}</Badge>
      ) : (
        <Badge>{t('status.active')}</Badge>
      ),
    ],
    [t('detail.field.lastLogin'), c.lastLoginAt ? formatDateTime(c.lastLoginAt) : t('list.none')],
    // Issue #652 (D-292) — read-only: only the buyer changes it, on the storefront.
    [t('detail.field.emailLanguage'), c.preferredLanguage ?? t('detail.field.emailLanguageUnset')],
  ];

  return (
    <>
      <PageHeader
        title={`${c.firstName} ${c.lastName}`}
        description={c.email}
        actions={
          <SaveSessionActions
            hostCount={hostCount}
            canSave={hasPermission('customers:manage')}
            saving={saving}
            onSave={(): void => void save()}
          />
        }
      />

      <div className="mb-4 empty:hidden">
        <SaveSessionSummary outcome={session.lastOutcome} notices={session.notices} onShow={showPart} />
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('detail.info.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            {info.map(([label, value]) => (
              <div key={label} className="space-y-1">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('detail.actions.title')}
            <ImmediateBadge />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {c.blocked ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={(): void => void act(() => apiClient.post(`/api/v1/admin/customers/${id}/unblock`, {}))}
            >
              {t('detail.action.unblock')}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={busy || c.deleted}
              onClick={(): void => void act(() => apiClient.post(`/api/v1/admin/customers/${id}/block`, {}))}
            >
              {t('detail.action.block')}
            </Button>
          )}

          <Button
            variant="outline"
            disabled={busy || c.deleted}
            onClick={(): void => void act(() => apiClient.post(`/api/v1/admin/customers/${id}/password-reset`, {}))}
          >
            {t('detail.action.passwordReset')}
          </Button>

          {/* Feature 042 — Platform-Admin 2FA reset (gated by mfa:reset). */}
          <Button
            variant="outline"
            disabled={busy || c.deleted}
            onClick={(): void => void act(() => apiClient.post(`/api/v1/admin/customers/${id}/mfa/reset`, {}))}
          >
            {t('detail.action.resetMfa')}
          </Button>

          <Button
            variant="outline"
            disabled={busy || c.deleted}
            onClick={(): void =>
              void act(async () => {
                const res = await apiClient.post<{ data: { impersonationSessionId: string } }>(
                  `/api/v1/admin/customers/${id}/impersonate`,
                  {},
                );
                return res;
              })
            }
          >
            {t('detail.action.impersonate')}
          </Button>

          {c.deleted ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={(): void => void act(() => apiClient.post(`/api/v1/admin/customers/${id}/restore`, {}))}
            >
              {t('detail.action.restore')}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={(): void => void act(() => apiClient.delete(`/api/v1/admin/customers/${id}`))}
            >
              {t('detail.action.delete')}
            </Button>
          )}
        </CardContent>
      </Card>

      <OrganizationAssignmentPanel customerId={id} organizationId={c.organizationId} onChanged={(): void => void refresh()} />
      <CustomerGroupPanel customerId={id} customerGroupId={c.customerGroupId} onChanged={(): void => void refresh()} />
      <AddressesPanel customerId={id} onChanged={(): void => void refresh()} />
      {/* Feature 091 / P7b — the place at the end of this screen, and the twin
          of `organization.detail.after`. **One mount**: the member carries no
          prop that could tell two mounts apart, so a second one would render
          every contribution twice.

          One contribution today — `quick_order`'s ordering defaults, which this
          file imported by path — and the member is its own rather than shared
          with the organization screen, because `unrendered-zone` is computed per
          member and a shared one would let that host's mount cover this host's
          absence (Z13). */}
      {/* Feature 180 — the page's save session: every panel here saves with the page Save. */}
      <AdminZone name="customer.detail.after" props={{ customerId: id, saveSession: session.handle }} />

      {/* Feature 055 — operator-defined custom fields for this customer. Embedded (feature 180,
          WP-8): the bag is the host part of the page Save, one `PATCH …/custom-fields`, blocking,
          so a refused custom field writes no panel. */}
      <CustomFieldValuesPanel
        entityType="customer"
        values={customFieldDraft === undefined ? storedValues : { ...storedValues, ...customFieldDraft }}
        onChange={(bag): void => {
          setCustomFieldDraft(bag);
          setCustomFieldErrors({});
          // The last save's summary belongs to it: an edit clears it (FR-016).
          sessionRef.current.clearOutcome();
        }}
        fieldErrors={customFieldErrors}
      />

      <OrdersPanel customerId={id} />
      <QuoteRequestsPanel customerId={id} />
      <CartsPanel customerId={id} />
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default CustomerDetail;
