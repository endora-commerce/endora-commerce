import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy, Trash2 } from 'lucide-react';
import {
  apiKeyScopeSchema,
  type ApiKey,
  type ApiKeyBinding,
  type CreateApiKeyResponse,
} from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OrganizationPicker } from '@/components/organization-picker';
import { SalesChannelPicker } from '@/components/sales-channel-picker/SalesChannelPicker';
import { CustomerPicker } from '@/components/customer-picker/CustomerPicker';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';

// Feature 062 — the scope catalog is the typed contract enum (research §R3);
// `integrations:manage` is an admin permission, not an api-key scope.
const KNOWN_SCOPES: readonly string[] = apiKeyScopeSchema.options;
const ORDERS_SCOPES: ReadonlySet<string> = new Set(['orders:read', 'orders:write']);

interface ApiKeyListResponse {
  data: ApiKey[];
}

interface CreateApiKeyEnvelope {
  data: CreateApiKeyResponse;
}

interface CreateKeyInput {
  name: string;
  scopes: string[];
  binding?: ApiKeyBinding;
  expiresAt?: string;
}

export function ApiKeysPage(): ReactNode {
  const t = useTranslation('core');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Feature 062 — best-effort id → name lookup for the binding column.
  const [orgNames, setOrgNames] = useState<Map<string, string>>(new Map());

  const copyToken = useCallback(async (token: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the input is selectable as a fallback */
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ApiKeyListResponse>('/api/v1/admin/api-keys');
      setKeys(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('apiKeys.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Resolve organization names for bound keys (same pattern as WebhooksPage).
  useEffect(() => {
    const missing = Array.from(
      new Set(
        keys
          .map((k) => k.organizationId)
          .filter((id): id is string => typeof id === 'string' && !orgNames.has(id)),
      ),
    );
    if (missing.length === 0) return;
    void (async () => {
      const entries = await Promise.all(
        missing.map(async (id) => {
          try {
            const res = await apiClient.get<{ data: { name: string } }>(
              `/api/v1/admin/organizations/${id}`,
            );
            return [id, res.data.name] as const;
          } catch {
            return [id, id] as const;
          }
        }),
      );
      setOrgNames((prev) => {
        const next = new Map(prev);
        for (const [id, name] of entries) next.set(id, name);
        return next;
      });
    })();
  }, [keys, orgNames]);

  const handleCreate = useCallback(
    async (input: CreateKeyInput): Promise<void> => {
      try {
        const res = await apiClient.post<CreateApiKeyEnvelope>('/api/v1/admin/api-keys', input);
        setRevealedToken({ name: input.name, token: res.data.bearerToken });
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('apiKeys.error.create'));
        throw err;
      }
    },
    [refresh, t],
  );

  const handleRevoke = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm(t('apiKeys.action.revokeConfirm'))) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/api-keys/${id}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('apiKeys.error.revoke'));
      }
    },
    [refresh, t],
  );

  return (
    <>
      <PageHeader
        title={t('apiKeys.page.title')}
        description={t('apiKeys.page.description')}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {revealedToken ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('apiKeys.revealed.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{revealedToken.name}</p>
            <div className="mt-2 flex items-center gap-2">
              <Input
                readOnly
                value={revealedToken.token}
                className="flex-1 bg-muted font-mono text-sm text-foreground"
                onFocus={(e): void => e.currentTarget.select()}
                aria-label={t('apiKeys.revealed.title')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={(): void => void copyToken(revealedToken.token)}
              >
                {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                {copied ? t('apiKeys.revealed.copied') : t('apiKeys.revealed.copy')}
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={(): void => {
                setRevealedToken(null);
                setCopied(false);
              }}
            >
              {t('apiKeys.revealed.confirm')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('apiKeys.create.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateKeyForm onSubmit={handleCreate} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('apiKeys.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('apiKeys.column.name')}</TableHead>
                  <TableHead>{t('apiKeys.column.status')}</TableHead>
                  <TableHead>{t('apiKeys.column.scopes')}</TableHead>
                  <TableHead>{t('apiKeys.column.binding')}</TableHead>
                  <TableHead>{t('apiKeys.column.expires')}</TableHead>
                  <TableHead>{t('apiKeys.column.last4')}</TableHead>
                  <TableHead>{t('apiKeys.column.lastUsed')}</TableHead>
                  <TableHead>{t('apiKeys.column.created')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell>
                      <Badge variant={k.status === 'active' ? 'success' : 'destructive'}>
                        {t(`apiKeys.status.${k.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Badge key={s} variant="outline" className="font-mono text-xs">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {k.organizationId ? (
                        <Badge variant="outline">
                          {orgNames.get(k.organizationId) ?? k.organizationId}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t('apiKeys.binding.unbound')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{k.expiresAt ? formatDateTime(k.expiresAt) : '—'}</TableCell>
                    <TableCell className="font-mono text-xs">…{k.lastFour}</TableCell>
                    <TableCell>{formatDateTime(k.lastUsedAt)}</TableCell>
                    <TableCell>{formatDateTime(k.createdAt)}</TableCell>
                    <TableCell>
                      {k.status === 'active' ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={(): void => {
                            void handleRevoke(k.id);
                          }}
                        >
                          <Trash2 />
                          {t('apiKeys.action.revoke')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function CreateKeyForm(props: {
  onSubmit: (input: CreateKeyInput) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [salesChannelId, setSalesChannelId] = useState<string | null>(null);
  const [customerAccountId, setCustomerAccountId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggle = (scope: string): void => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const handleOrganizationChange = (id: string | null): void => {
    setOrganizationId(id);
    // B3 by construction — the service account must belong to the chosen
    // org, so a changed org invalidates the previous selection.
    setCustomerAccountId(null);
  };

  const hasOrdersScope = useMemo(
    () => Array.from(scopes).some((s) => ORDERS_SCOPES.has(s)),
    [scopes],
  );
  const bindingStarted =
    organizationId !== null || salesChannelId !== null || customerAccountId !== null;
  const bindingComplete =
    organizationId !== null && salesChannelId !== null && customerAccountId !== null;

  // Inline mirrors of the server-side creation rules B1–B5
  // (specs/062-distributor-api/contracts/api-key-binding.md §2).
  const validationIssues = useMemo(() => {
    const issues: string[] = [];
    if (hasOrdersScope && !bindingComplete) {
      issues.push(t('apiKeys.validation.bindingRequiredForOrders'));
    }
    if (bindingStarted && scopes.has('catalog:write')) {
      issues.push(t('apiKeys.validation.catalogWriteBound'));
    }
    if (bindingStarted && !bindingComplete && !hasOrdersScope) {
      issues.push(t('apiKeys.validation.bindingIncomplete'));
    }
    if (expiresAt !== '' && new Date(expiresAt).getTime() <= Date.now()) {
      issues.push(t('apiKeys.validation.expiryFuture'));
    }
    return issues;
  }, [hasOrdersScope, bindingStarted, bindingComplete, scopes, expiresAt, t]);

  const canSubmit =
    name.trim().length > 0 && scopes.size > 0 && validationIssues.length === 0 && !submitting;

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await props.onSubmit({
        name: name.trim(),
        scopes: Array.from(scopes),
        ...(bindingComplete
          ? { binding: { organizationId, salesChannelId, customerAccountId } }
          : {}),
        ...(expiresAt !== '' ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      });
      setName('');
      setScopes(new Set());
      setOrganizationId(null);
      setSalesChannelId(null);
      setCustomerAccountId(null);
      setExpiresAt('');
    } catch {
      /* surfaced by the page-level error alert; keep the form state */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e): void => {
        void onSubmit(e);
      }}
    >
      <p className="text-xs text-muted-foreground">{t('apiKeys.create.modesHelp')}</p>
      <div className="space-y-2">
        <Label htmlFor="api-key-name">{t('apiKeys.create.nameLabel')}</Label>
        <Input
          id="api-key-name"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          placeholder={t('apiKeys.create.namePlaceholder')}
          required
        />
      </div>
      <div className="space-y-2">
        <Label>{t('apiKeys.create.scopesLabel')}</Label>
        <div className="flex flex-wrap gap-3">
          {KNOWN_SCOPES.map((scope) => (
            <label
              key={scope}
              className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs"
            >
              <Checkbox checked={scopes.has(scope)} onChange={(): void => toggle(scope)} />
              <code className="font-mono">{scope}</code>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('apiKeys.create.scopesHelp')}</p>
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <div>
          <p className="text-sm font-medium">{t('apiKeys.create.bindingTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('apiKeys.create.bindingHelp')}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="api-key-organization">
              {t('apiKeys.create.organizationLabel')}
            </Label>
            <OrganizationPicker
              id="api-key-organization"
              value={organizationId}
              onChange={handleOrganizationChange}
              ariaLabel={t('apiKeys.create.organizationLabel')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-key-sales-channel">
              {t('apiKeys.create.salesChannelLabel')}
            </Label>
            <SalesChannelPicker
              id="api-key-sales-channel"
              value={salesChannelId}
              onChange={setSalesChannelId}
              ariaLabel={t('apiKeys.create.salesChannelLabel')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-key-service-account">
              {t('apiKeys.create.serviceAccountLabel')}
            </Label>
            <CustomerPicker
              id="api-key-service-account"
              value={customerAccountId}
              onChange={setCustomerAccountId}
              status="active"
              {...(organizationId !== null ? { organizationId } : {})}
              disabled={organizationId === null}
              ariaLabel={t('apiKeys.create.serviceAccountLabel')}
            />
            <p className="text-xs text-muted-foreground">
              {t('apiKeys.create.serviceAccountHelp')}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="api-key-expires-at">{t('apiKeys.create.expiresLabel')}</Label>
        <Input
          id="api-key-expires-at"
          type="datetime-local"
          className="md:max-w-xs"
          value={expiresAt}
          onChange={(e): void => setExpiresAt(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('apiKeys.create.expiresHelp')}</p>
      </div>

      {validationIssues.length > 0 ? (
        <div className="space-y-1">
          {validationIssues.map((issue) => (
            <p key={issue} className="text-xs text-destructive">
              {issue}
            </p>
          ))}
        </div>
      ) : null}

      <Button type="submit" disabled={!canSubmit}>
        {submitting ? t('apiKeys.create.submitting') : t('apiKeys.create.submit')}
      </Button>
    </form>
  );
}
