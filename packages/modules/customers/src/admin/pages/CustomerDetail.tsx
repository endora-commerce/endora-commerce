import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  ApiError,
  SaveSessionProvider,
  apiClient,
  formatDateTime,
  storefrontBaseUrl,
  useAuth,
  useSaveSession,
  useUnsavedChangesPrompt,
  type SavePart,
} from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  PageHeader,
  Section,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { OrdersPanel, QuoteRequestsPanel, CartsPanel } from '../panels/HistoryPanels.js';
import {
  OrganizationAssignmentPanel,
  CustomerGroupPanel,
  AddressesPanel,
} from '../panels/ManagementPanels.js';
import {
  ConfirmDialog,
  CustomFieldValuesPanel,
  SaveSessionActions,
  SaveSessionSummary,
  customFieldErrorsOf,
  ImmediateBadge,
} from '@endora-commerce/admin-kit/components';
import { AdminZone } from '@endora-commerce/admin-kit/zones';

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

/**
 * Issue #1328 — a language tag by name, in the admin's language: `en-US` reads
 * "English (US)" to an English-speaking operator and "Angielski (USA)" to a
 * Polish-speaking one. `null` when no name is known for the tag's language, so
 * the row shows the tag alone rather than the tag echoed back as a "name".
 */
function languageName(tag: string, adminLanguage: string): string | null {
  try {
    const names = new Intl.DisplayNames([adminLanguage], {
      type: 'language',
      languageDisplay: 'standard',
      style: 'short',
    });
    const base = tag.split('-')[0] ?? tag;
    if ((names.of(base) ?? base).toLowerCase() === base.toLowerCase()) return null;
    const name = names.of(tag);
    if (!name) return null;
    return name.charAt(0).toLocaleUpperCase(adminLanguage) + name.slice(1);
  } catch {
    return null;
  }
}

/** The e-mail language row's value: the language's name, the tag as secondary text. */
function EmailLanguage({ tag, adminLanguage }: { tag: string; adminLanguage: string }): ReactNode {
  const name = languageName(tag, adminLanguage);
  if (name === null) return <span data-language-tag="">{tag}</span>;
  return (
    <>
      <span data-language-name="">{name}</span>{' '}
      <span data-language-tag="" className="text-xs text-muted-foreground">
        {tag}
      </span>
    </>
  );
}

/**
 * Issue #1328 — what the operator's last impersonation step left: nothing yet, a
 * session this screen started (so it offers no second start), or one it ended.
 */
type ImpersonationState = { phase: 'idle' } | { phase: 'active' } | { phase: 'ended' };

/**
 * Issue #1471 — the account actions that take something away from the
 * customer, each asked about before it runs: its request, and the bundle prefix
 * of its question (`detail.confirm.<kind>.{title,message,action}`).
 */
type ConfirmedAction = 'block' | 'resetMfa' | 'delete';

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
  const adminLanguage = useTranslationContext().language;
  const { hasPermission } = useAuth();
  const [c, setC] = useState<AdminCustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Issue #1328 — the reason dialog, its in-flight start and refusal, and the outcome.
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonateReason, setImpersonateReason] = useState('');
  const [impersonateBusy, setImpersonateBusy] = useState(false);
  const [impersonateError, setImpersonateError] = useState<string | null>(null);
  const [impersonation, setImpersonation] = useState<ImpersonationState>({ phase: 'idle' });
  const [endingImpersonation, setEndingImpersonation] = useState(false);
  // Issue #1471 — the account action being asked about, its in-flight request and refusal.
  const [confirming, setConfirming] = useState<ConfirmedAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Where focus goes once the dialog or the session closes: the button that held it is
  // disabled or gone by then (WCAG 2.4.3).
  const storefrontLinkRef = useRef<HTMLAnchorElement>(null);
  const impersonateButtonRef = useRef<HTMLButtonElement>(null);
  // After a delete the Delete button is gone; Restore, which replaces it, takes focus.
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (impersonation.phase === 'active') storefrontLinkRef.current?.focus();
    if (impersonation.phase === 'ended') impersonateButtonRef.current?.focus();
  }, [impersonation]);

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

  const askToConfirm = (action: ConfirmedAction): void => {
    setConfirmError(null);
    setConfirming(action);
  };

  /**
   * Runs the confirmed action with its dialog still open: busy, so it cannot
   * be sent twice; a refusal stays in the dialog, next to the button that
   * retries it; success closes it and re-reads the customer.
   */
  const runConfirmed = async (action: ConfirmedAction): Promise<void> => {
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      if (action === 'block') await apiClient.post(`/api/v1/admin/customers/${id}/block`, {});
      else if (action === 'resetMfa') await apiClient.post(`/api/v1/admin/customers/${id}/mfa/reset`, {});
      else await apiClient.delete(`/api/v1/admin/customers/${id}`);
      setConfirming(null);
      await refresh();
      if (action === 'delete') setTimeout(() => restoreButtonRef.current?.focus(), 0);
    } catch (err) {
      setConfirmError(err instanceof ApiError ? err.envelope.error.message : t('detail.actionError'));
    } finally {
      setConfirmBusy(false);
    }
  };

  const startImpersonation = async (): Promise<void> => {
    setImpersonateBusy(true);
    setImpersonateError(null);
    const reason = impersonateReason.trim();
    try {
      // The customer route takes the reason and stores it outside the audit log (#1317),
      // and serves org-less customers too — the organization route needs an organization.
      await apiClient.post(`/api/v1/admin/customers/${id}/impersonate`, reason === '' ? {} : { reason });
      setImpersonation({ phase: 'active' });
      setImpersonateOpen(false);
      setImpersonateReason('');
    } catch (err) {
      setImpersonateError(err instanceof ApiError ? err.envelope.error.message : t('detail.actionError'));
    } finally {
      setImpersonateBusy(false);
    }
  };

  const endImpersonation = async (): Promise<void> => {
    setEndingImpersonation(true);
    setError(null);
    try {
      await apiClient.post('/api/v1/admin/impersonation/end', {});
      setImpersonation({ phase: 'ended' });
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('detail.actionError'));
    } finally {
      setEndingImpersonation(false);
    }
  };

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
    // Issue #1328 — by name, in the admin's language; the tag stays as secondary text.
    [
      t('detail.field.emailLanguage'),
      c.preferredLanguage ? (
        <EmailLanguage tag={c.preferredLanguage} adminLanguage={adminLanguage} />
      ) : (
        t('detail.field.emailLanguageUnset')
      ),
    ],
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
            // Reversible (Unblock), so not styled as the page's destructive action;
            // its weight is in the confirmation (issue #1471).
            <Button variant="outline" disabled={busy || c.deleted} onClick={(): void => askToConfirm('block')}>
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
            onClick={(): void => askToConfirm('resetMfa')}
          >
            {t('detail.action.resetMfa')}
          </Button>

          {/* Issue #1328 — asks for a reason first; no second start while this one is open. */}
          <Button
            ref={impersonateButtonRef}
            variant="outline"
            disabled={busy || c.deleted || impersonation.phase === 'active'}
            onClick={(): void => {
              setImpersonateError(null);
              setImpersonateOpen(true);
            }}
          >
            {t('detail.action.impersonate')}
          </Button>

          {/* Restoring gives the account back, so it stays with the everyday actions;
              Delete is in its own section at the end of the page (issue #1471). */}
          {c.deleted ? (
            <Button
              ref={restoreButtonRef}
              variant="outline"
              disabled={busy}
              onClick={(): void => void act(() => apiClient.post(`/api/v1/admin/customers/${id}/restore`, {}))}
            >
              {t('detail.action.restore')}
            </Button>
          ) : null}

          {/* Mounted before it has text, so the outcome that arrives is announced. */}
          <div role="status" data-testid="impersonation-status" className="w-full empty:hidden">
            {impersonation.phase === 'idle' ? null : impersonation.phase === 'active' ? (
              <Alert>
                <AlertDescription className="space-y-3">
                  <p>
                    <strong>{t('detail.impersonate.started', { name: `${c.firstName} ${c.lastName}` })}</strong>{' '}
                    {t('detail.impersonate.startedHelp')}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button asChild>
                      <a ref={storefrontLinkRef} href={`${storefrontBaseUrl.replace(/\/+$/, '')}/account`} target="_blank" rel="noopener noreferrer">
                        {t('detail.impersonate.openStorefront')}
                        <span className="sr-only"> {t('detail.impersonate.newTab')}</span>
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      disabled={endingImpersonation}
                      aria-busy={endingImpersonation}
                      onClick={(): void => void endImpersonation()}
                    >
                      {t('detail.impersonate.end')}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertDescription>{t('detail.impersonate.ended')}</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      {impersonateOpen ? (
        <ConfirmDialog
          title={t('detail.impersonate.title', { name: `${c.firstName} ${c.lastName}` })}
          message={
            <div className="space-y-3">
              <p>{t('detail.impersonate.message')}</p>
              <div className="space-y-1">
                <Label htmlFor="impersonation-reason">{t('detail.impersonate.reasonLabel')}</Label>
                <Textarea
                  id="impersonation-reason"
                  value={impersonateReason}
                  maxLength={1000}
                  rows={3}
                  aria-describedby="impersonation-reason-hint"
                  onChange={(e): void => setImpersonateReason(e.target.value)}
                />
                <p id="impersonation-reason-hint" className="text-xs text-muted-foreground">
                  {t('detail.impersonate.reasonHint')}
                </p>
              </div>
            </div>
          }
          confirmLabel={t('detail.impersonate.confirm')}
          busy={impersonateBusy}
          error={impersonateError}
          onConfirm={(): void => void startImpersonation()}
          onCancel={(): void => setImpersonateOpen(false)}
        />
      ) : null}

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

      {/* Issue #1471 — Delete at the end of the page, away from the everyday actions (Fitts). */}
      {!c.deleted ? (
        <Card className="mt-4 border-destructive/40">
          <CardContent className="pt-6">
            <Section
              title={t('detail.dangerZone.title')}
              action={
                <Button
                  variant="outline"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  disabled={busy}
                  onClick={(): void => askToConfirm('delete')}
                >
                  {t('detail.action.delete')}
                </Button>
              }
            >
              <p className="text-sm text-muted-foreground">{t('detail.dangerZone.hint')}</p>
            </Section>
          </CardContent>
        </Card>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title={t(`detail.confirm.${confirming}.title`, { name: `${c.firstName} ${c.lastName}` })}
          message={t(`detail.confirm.${confirming}.message`, { name: `${c.firstName} ${c.lastName}`, email: c.email })}
          confirmLabel={t(`detail.confirm.${confirming}.action`)}
          destructive
          busy={confirmBusy}
          error={confirmError}
          onConfirm={(): void => void runConfirmed(confirming)}
          onCancel={(): void => setConfirming(null)}
        />
      ) : null}
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default CustomerDetail;
