import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  SaveSessionProvider,
  apiClient,
  formatDateTime,
  storefrontBaseUrl,
  useAuth,
  useDetailResource,
  useSaveSession,
  useUnsavedChangesPrompt,
  type SavePart,
} from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Badge,
  DetailSkeleton,
  EditorSection,
  Label,
  PageHeader,
  RecordTabs,
  Textarea,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { OrdersPanel, QuoteRequestsPanel, CartsPanel } from '../panels/HistoryPanels.js';
import {
  OrganizationAssignmentField,
  CustomerGroupField,
  AddressesPanel,
} from '../panels/ManagementPanels.js';
import {
  ConfirmDialog,
  CustomFieldValuesPanel,
  DetailHeaderActions,
  RowActionMenuItem,
  RowActionMenuSeparator,
  SaveSessionActions,
  SaveSessionSummary,
  customFieldErrorsOf,
  ImmediateBadge,
} from '@endora-commerce/admin-kit/components';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { History, UserRound } from 'lucide-react';

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

/**
 * Issue #1517 (UX audit SALES-22) — the screen's two tabs. **Profile** is the account and
 * everything the page Save or an immediate field changes; **Activity** is what the customer
 * did — orders, quote requests, carts — read-only. Kept in `?tab=` so a link can open either.
 */
type CustomerTab = 'profile' | 'activity';

/** The tab `?tab=` names; Profile for anything else. */
export function customerTabOf(value: string | null): CustomerTab {
  return value === 'activity' ? 'activity' : 'profile';
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
 *
 * Issue #1517 (UX audit SALES-22) — one card of two tabs instead of eleven stacked cards: the
 * account actions are the header's "More" menu, the organization and the group are fields of
 * the account section, and the history is the Activity tab.
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
  const tCore = useTranslation('core');
  const adminLanguage = useTranslationContext().language;
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = customerTabOf(searchParams.get('tab'));
  const selectTab = (next: CustomerTab): void => {
    setSearchParams(
      (params) => {
        const updated = new URLSearchParams(params);
        if (next === 'profile') updated.delete('tab');
        else updated.set('tab', next);
        return updated;
      },
      { replace: true },
    );
  };
  // The last account action's result, said beside the header's actions (DEC-12 a).
  const actionStatus = useInlineStatus();
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
  // Where focus goes once the dialog or the session closes: the control that held it is
  // disabled or gone by then (WCAG 2.4.3).
  const storefrontLinkRef = useRef<HTMLAnchorElement>(null);
  // Impersonate is an entry of the header's "More" menu; once the session ends, focus goes
  // back to that menu's trigger, where the next start is.
  const headerActionsRef = useRef<HTMLDivElement>(null);
  // After a delete the menu holds nothing for a deleted account; Restore, which replaces it,
  // takes focus.
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (impersonation.phase === 'active') storefrontLinkRef.current?.focus();
    if (impersonation.phase === 'ended') {
      headerActionsRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
    }
  }, [impersonation]);

  // Issue #1447 (DS-14) — a skeleton on the first load only; every re-read after
  // an account action or a panel change keeps the customer on screen, marked
  // `aria-busy`.
  const resource = useDetailResource<AdminCustomerDetail>(id, async () => {
    const res = await apiClient.get<{ data: AdminCustomerDetail }>(`/api/v1/admin/customers/${id}`);
    return res.data;
  });
  const c = resource.data;
  const reread = resource.refresh;
  const loadError =
    resource.error === null
      ? null
      : resource.error instanceof ApiError
        ? resource.error.envelope.error.message
        : t('detail.error');
  // A re-read clears the previous action's error, as it always has.
  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    await reread();
  }, [reread]);

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

  const { show: showActionStatus, clear: clearActionStatus } = actionStatus;
  const act = useCallback(
    async (run: () => Promise<unknown>, done: string): Promise<void> => {
      setBusy(true);
      setError(null);
      clearActionStatus();
      try {
        await run();
        await refresh();
        showActionStatus(done);
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('detail.actionError'));
      } finally {
        setBusy(false);
      }
    },
    [refresh, showActionStatus, clearActionStatus, t],
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
    actionStatus.clear();
    try {
      if (action === 'block') await apiClient.post(`/api/v1/admin/customers/${id}/block`, {});
      else if (action === 'resetMfa') await apiClient.post(`/api/v1/admin/customers/${id}/mfa/reset`, {});
      else await apiClient.delete(`/api/v1/admin/customers/${id}`);
      setConfirming(null);
      await refresh();
      actionStatus.show(t(`detail.done.${action}`));
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

  if (resource.initialLoading) return <DetailSkeleton label={t('detail.loading')} />;
  if (!c) {
    return (
      <>
        <PageHeader title={t('detail.title')} />
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            {loadError ?? t('detail.error')}
            <Button variant="outline" size="sm" onClick={(): void => void refresh()}>
              {tCore('common.action.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </>
    );
  }

  // The organization and the group are fields below the list, not read-only rows of it: the
  // pickers show the current value (#1517).
  const info: Array<[string, ReactNode]> = [
    [t('detail.field.email'), c.email],
    [t('detail.field.created'), formatDateTime(c.createdAt)],
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

  const fullName = `${c.firstName} ${c.lastName}`;
  const unsaved = hostCount + session.dirtyCount > 0;

  return (
    <>
      <PageHeader
        title={fullName}
        description={c.email}
        actions={
          // Issue #1517 (SALES-22, SALES-05) — the page Save is the one primary (Von Restorff);
          // the account's standing remedy (Unblock, Restore) is the one visible secondary; every
          // other account action is an entry of "More", Delete last and set apart (Hick, Fitts).
          <div ref={headerActionsRef} className="contents">
            <DetailHeaderActions
              status={actionStatus.props}
              moreBusy={busy}
              secondary={
                c.blocked || c.deleted ? (
                  <>
                    {c.blocked ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        aria-busy={busy}
                        onClick={(): void =>
                          void act(
                            () => apiClient.post(`/api/v1/admin/customers/${id}/unblock`, {}),
                            t('detail.done.unblock'),
                          )
                        }
                      >
                        {t('detail.action.unblock')}
                      </Button>
                    ) : null}
                    {c.deleted ? (
                      <Button
                        ref={restoreButtonRef}
                        variant="outline"
                        disabled={busy}
                        aria-busy={busy}
                        onClick={(): void =>
                          void act(
                            () => apiClient.post(`/api/v1/admin/customers/${id}/restore`, {}),
                            t('detail.done.restore'),
                          )
                        }
                      >
                        {t('detail.action.restore')}
                      </Button>
                    ) : null}
                  </>
                ) : null
              }
              primary={
                <SaveSessionActions
                  hostCount={hostCount}
                  canSave={hasPermission('customers:manage')}
                  saving={saving}
                  onSave={(): void => void save()}
                />
              }
            >
              {/* A deleted account takes none of these: Restore comes first. Block is
                  reversible (Unblock), so it is not styled destructive; its weight is in the
                  confirmation (issue #1471). */}
              {!c.deleted && !c.blocked ? (
                <RowActionMenuItem onSelect={(): void => askToConfirm('block')}>
                  {t('detail.action.block')}
                </RowActionMenuItem>
              ) : null}
              {!c.deleted ? (
                <RowActionMenuItem
                  onSelect={(): void =>
                    void act(
                      () => apiClient.post(`/api/v1/admin/customers/${id}/password-reset`, {}),
                      t('detail.done.passwordReset'),
                    )
                  }
                >
                  {t('detail.action.passwordReset')}
                </RowActionMenuItem>
              ) : null}
              {/* Feature 042 — Platform-Admin 2FA reset (gated by mfa:reset). */}
              {!c.deleted ? (
                <RowActionMenuItem onSelect={(): void => askToConfirm('resetMfa')}>
                  {t('detail.action.resetMfa')}
                </RowActionMenuItem>
              ) : null}
              {/* Issue #1328 — asks for a reason first; no second start while this one is open. */}
              {!c.deleted ? (
                <RowActionMenuItem
                  disabled={impersonation.phase === 'active'}
                  onSelect={(): void => {
                    setImpersonateError(null);
                    setImpersonateOpen(true);
                  }}
                >
                  {t('detail.action.impersonate')}
                </RowActionMenuItem>
              ) : null}
              {!c.deleted ? <RowActionMenuSeparator /> : null}
              {!c.deleted ? (
                <RowActionMenuItem destructive onSelect={(): void => askToConfirm('delete')}>
                  {t('detail.action.delete')}
                </RowActionMenuItem>
              ) : null}
            </DetailHeaderActions>
          </div>
        }
      />

      <div className="mb-4 empty:hidden">
        <SaveSessionSummary outcome={session.lastOutcome} notices={session.notices} onShow={showPart} />
      </div>

      {(error ?? loadError) ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error ?? loadError}</AlertDescription>
        </Alert>
      ) : null}

      {/* A support session is a standing state with its own remedy, so it is the one banner
          above the tabs. Mounted before it has text, so the outcome that arrives is announced. */}
      <div role="status" data-testid="impersonation-status" className="mb-4 empty:hidden">
        {impersonation.phase === 'idle' ? null : impersonation.phase === 'active' ? (
          <Alert>
            <AlertDescription className="space-y-3">
              <p>
                <strong>{t('detail.impersonate.started', { name: fullName })}</strong>{' '}
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

      <RecordTabs
        className="mb-4"
        items={[
          {
            value: 'profile' as const,
            label: t('detail.tabs.profile'),
            icon: <UserRound />,
            // Zeigarnik: the tab says it holds what the page Save has not written yet.
            unsaved: unsaved ? t('detail.tabs.unsaved') : undefined,
          },
          { value: 'activity' as const, label: t('detail.tabs.activity'), icon: <History /> },
        ]}
        value={tab}
        onValueChange={selectTab}
        idBase="customer-detail"
        aria-label={t('detail.tabs.label')}
        panelProps={resource.busyProps}
      >
        {/* Profile stays mounted while Activity is open: the zone's panels are participants of
            the page Save, and unmounting them would drop their drafts. */}
        <div hidden={tab !== 'profile'} className="space-y-(--section-gap)">
          <EditorSection title={t('detail.info.title')} action={<ImmediateBadge />}>
            <dl className="grid gap-3 sm:grid-cols-2">
              {info.map(([label, value]) => (
                <div key={label} className="space-y-1">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-sm">{value}</dd>
                </div>
              ))}
            </dl>
            {/* Issue #1517 — fields of this section, applied at once (the badge above), rather
                than two cards of one picker and one button each (Common Region). */}
            <div className="grid gap-4 pt-2 sm:grid-cols-2">
              <OrganizationAssignmentField
                key={c.organizationId ?? 'none'}
                customerId={id}
                organizationId={c.organizationId}
                organizationName={c.organizationName}
                onChanged={(): void => void refresh()}
              />
              <CustomerGroupField
                key={c.customerGroupId ?? 'none'}
                customerId={id}
                customerGroupId={c.customerGroupId}
                onChanged={(): void => void refresh()}
              />
            </div>
          </EditorSection>
          <AddressesPanel customerId={id} onChanged={(): void => void refresh()} />
          {/* Feature 091 / P7b — the twin of `organization.detail.after`. **One mount**: the
              member carries no prop that could tell two mounts apart, so a second one would
              render every contribution twice; its own member rather than shared with the
              organization screen, because `unrendered-zone` is computed per member (Z13).
              Feature 180 — the page's save session: every panel here saves with the page Save.
              Issue #1517 — inside the Profile card, so its sections are sections, not cards. */}
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
        </div>

        {tab === 'activity' ? (
          <div className="space-y-(--section-gap)">
            <OrdersPanel customerId={id} />
            <QuoteRequestsPanel customerId={id} />
            <CartsPanel customerId={id} />
          </div>
        ) : null}
      </RecordTabs>

      {impersonateOpen ? (
        <ConfirmDialog
          title={t('detail.impersonate.title', { name: fullName })}
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

      {confirming ? (
        <ConfirmDialog
          title={t(`detail.confirm.${confirming}.title`, { name: fullName })}
          message={t(`detail.confirm.${confirming}.message`, { name: fullName, email: c.email })}
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
