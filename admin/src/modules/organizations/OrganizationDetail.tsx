import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { FulfilmentStrategy, Warehouse } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { useUnsavedChangesPrompt } from '@/lib/use-unsaved-changes-prompt';
import { FulfilmentStrategyPanel } from './panels/FulfilmentStrategyPanel';
import { formatDateTime } from '@/lib/format';
import { OrganizationSalesRepsTab } from './OrganizationSalesRepsTab';
import { ModerationActionsPanel } from './panels/ModerationActionsPanel';
import { ApplicablePriceListsPanel } from './panels/ApplicablePriceListsPanel';
import { HierarchyPanel } from './panels/HierarchyPanel';
import { VatValidationPanel } from './panels/VatValidationPanel';
import { RestrictionsPanel } from './panels/RestrictionsPanel';
import { CustomFieldValuesPanel } from '@endora-commerce/admin-kit/components';
import { DefaultPreferencesPanel } from '../quick_order/DefaultPreferencesPanel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';
import { EntityChannelMembership } from '../sales_channels/components/EntityChannelMembership';
import { DisplayModeOverrideRow } from '../price_lists/DisplayModeOverrideRow';

interface OrgMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  lastLoginAt?: string | null;
  updatedAt?: string;
}

interface OrgDetail {
  id: string;
  name: string;
  legalName?: string | null;
  taxId: string;
  status: 'pending_verification' | 'active' | 'blocked' | 'rejected';
  vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge';
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
    provider: 'vies' | 'mf_pl' | 'format_only' | null;
    validatedAt: string | null;
  };
  updatedAt?: string;
}

const STATUSES = ['pending_verification', 'active', 'blocked', 'rejected'] as const;
const VAT_STATUSES = ['vat_payer', 'vat_exempt', 'reverse_charge'] as const;
const ROLES = ['organization_admin', 'regular_user'] as const;

export function OrganizationDetail(): ReactNode {
  const t = useTranslation('core');
  const { id = '' } = useParams<{ id: string }>();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<(typeof ROLES)[number]>('regular_user');
  const [directEmail, setDirectEmail] = useState('');
  const [directFirst, setDirectFirst] = useState('');
  const [directLast, setDirectLast] = useState('');
  const [directPassword, setDirectPassword] = useState('');
  const [directRole, setDirectRole] = useState<(typeof ROLES)[number]>('regular_user');

  const [editMember, setEditMember] = useState<OrgMember | null>(null);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editEmail, setEditEmail] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
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

  // The member-edit overlay is the only deferred-save form on this page (the
  // rest of the org fields persist immediately on change). Warn before leaving
  // if it holds edits that haven't been saved yet.
  const memberEditDirty =
    editMember !== null &&
    (editFirst !== editMember.firstName ||
      editLast !== editMember.lastName ||
      editEmail !== editMember.email);
  // The invite and direct-add forms also hold unsaved data-entry.
  const inviteDirty = inviteEmail !== '';
  const directAddDirty =
    directEmail !== '' || directFirst !== '' || directLast !== '' || directPassword !== '';
  useUnsavedChangesPrompt(memberEditDirty || inviteDirty || directAddDirty);

  const handlePatch = useCallback(
    async (patch: {
      status?: string;
      vatStatus?: string;
      name?: string;
      orderConfirmationEmails?: string[];
      fulfilmentStrategy?: FulfilmentStrategy | null;
      fulfilmentStrategyWarehouseOrder?: string[] | null;
      customFieldValues?: Record<string, unknown>;
      expectedUpdatedAt?: string;
    }): Promise<void> => {
      if (!org?.updatedAt) return;
      try {
        await apiClient.patch<{ data: OrgDetail }>(`/api/v1/admin/organizations/${id}`, {
          ...patch,
          expectedUpdatedAt: patch.expectedUpdatedAt ?? org.updatedAt,
        });
        setInfo(t('organizations.detail.info.saved'));
        await refresh();
      } catch (err) {
        if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
          setError(t('organizations.detail.error.versionConflictOrg'));
          await refresh();
          setError(null);
        } else {
          setError(err instanceof ApiError ? err.envelope.error.message : t('organizations.detail.error.save'));
        }
      }
    },
    [id, org, refresh, t],
  );

  const inviteMember = useCallback(async (): Promise<void> => {
    if (!inviteEmail.trim()) return;
    setError(null);
    try {
      await apiClient.post(`/api/v1/admin/organizations/${id}/members/invite`, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInfo(t('organizations.detail.info.invited'));
      setInviteEmail('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('organizations.detail.error.invite'));
    }
  }, [id, inviteEmail, inviteRole, refresh, t]);

  const directAdd = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await apiClient.post(`/api/v1/admin/organizations/${id}/members`, {
        email: directEmail.trim(),
        firstName: directFirst.trim(),
        lastName: directLast.trim(),
        password: directPassword,
        role: directRole,
      });
      setInfo(t('organizations.detail.info.memberCreated'));
      setDirectEmail('');
      setDirectFirst('');
      setDirectLast('');
      setDirectPassword('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('organizations.detail.error.create'));
    }
  }, [id, directEmail, directFirst, directLast, directPassword, directRole, refresh, t]);

  const changeMemberRole = useCallback(
    async (memberId: string, role: string, expectedUpdatedAt?: string): Promise<void> => {
      setError(null);
      try {
        await apiClient.patch(`/api/v1/admin/organizations/${id}/members/${memberId}/role`, {
          role,
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

  const adminCount = org.members.filter((m) => m.role === 'organization_admin').length;

  return (
    <>
      <PageHeader
        title={org.name}
        description={
          <span>
            {t('organizations.detail.taxIdLabel')} <code className="font-mono text-xs">{org.taxId}</code>
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
          <Button asChild variant="outline">
            <Link to="/organizations">
              <ArrowLeft />
              {t('organizations.detail.back')}
            </Link>
          </Button>
        }
      />

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
              value={org.status}
              onChange={(e): void =>
                void handlePatch({
                  status: e.target.value,
                  ...(org.updatedAt !== undefined ? { expectedUpdatedAt: org.updatedAt } : {}),
                })
              }
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
              value={org.vatStatus}
              onChange={(e): void =>
                void handlePatch({
                  vatStatus: e.target.value,
                  ...(org.updatedAt !== undefined ? { expectedUpdatedAt: org.updatedAt } : {}),
                })
              }
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
              defaultValue={(org.orderConfirmationEmails ?? []).join('\n')}
              placeholder={'ops@example.com\nsales@example.com'}
              onBlur={(e): void => {
                const emails = e.target.value
                  .split(/[\n,]/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                const current = org.orderConfirmationEmails ?? [];
                if (emails.join('|') !== current.join('|')) {
                  void handlePatch({
                    orderConfirmationEmails: emails,
                    ...(org.updatedAt !== undefined ? { expectedUpdatedAt: org.updatedAt } : {}),
                  });
                }
              }}
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
          <CardTitle>{t('organizations.detail.inviteCard')}</CardTitle>
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
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as (typeof ROLES)[number])}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
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
          <CardTitle>{t('organizations.detail.directAddCard')}</CardTitle>
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
              value={directRole}
              onChange={(e) => setDirectRole(e.target.value as (typeof ROLES)[number])}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <Button type="button" onClick={() => void directAdd()}>
              {t('organizations.detail.createMember')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('organizations.detail.membersCard')}</CardTitle>
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
                      value={m.role}
                      onChange={(e): void =>
                        void changeMemberRole(
                          m.id,
                          e.target.value,
                          m.updatedAt ?? undefined,
                        )
                      }
                      className="max-w-[14rem]"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
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
                        m.role === 'organization_admin' && adminCount <= 1
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

      <EntityChannelMembership entityType="organization" entityId={id || null} />

      {id ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('organizations.detail.pricingCard')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DisplayModeOverrideRow
              scope="organization"
              targetId={id}
              label={t('organizations.detail.pricingLabel')}
              inheritHint={t('organizations.detail.pricingHint')}
            />
          </CardContent>
        </Card>
      ) : null}

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
          version={org.version ?? 0}
          onChanged={refresh}
        />
      </div>

      {/* Feature 039 — default ordering preferences (org scope). */}
      <DefaultPreferencesPanel scope="organization" scopeId={org.id} />

      {/* Feature 026 US7 — VAT-ID / NIP validation history + retrigger. */}
      <div className="mt-4">
        <VatValidationPanel
          organizationId={org.id}
          summary={{
            outcome: org.vatValidation?.outcome ?? null,
            provider: org.vatValidation?.provider ?? null,
            validatedAt: org.vatValidation?.validatedAt ?? null,
          }}
          onChanged={refresh}
        />
      </div>

      {/* Org-level warehouse-picking (fulfilment) strategy override. */}
      <div className="mt-4">
        <FulfilmentStrategyPanel
          key={org.updatedAt ?? org.id}
          initial={{
            strategy: org.fulfilmentStrategy ?? null,
            warehouseOrder: org.fulfilmentStrategyWarehouseOrder ?? [],
          }}
          warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
          onSave={(value): Promise<void> =>
            handlePatch({
              fulfilmentStrategy: value.strategy,
              fulfilmentStrategyWarehouseOrder:
                value.strategy === 'defined_order' ? value.warehouseOrder : null,
              ...(org.updatedAt !== undefined ? { expectedUpdatedAt: org.updatedAt } : {}),
            })
          }
        />
      </div>

      {/* Feature 026 US5 — read-only "what price lists apply to this org". */}
      <div className="mt-4">
        <ApplicablePriceListsPanel organizationId={org.id} />
      </div>

      {/* Feature 055 — operator-defined custom fields for this organization. */}
      <div className="mt-4">
        <CustomFieldValuesPanel
          entityType="organization"
          values={org.customFieldValues ?? {}}
          save={(values): Promise<void> => handlePatch({ customFieldValues: values })}
        />
      </div>

      {id ? <OrganizationSalesRepsTab organizationId={id} /> : null}
    </>
  );
}
