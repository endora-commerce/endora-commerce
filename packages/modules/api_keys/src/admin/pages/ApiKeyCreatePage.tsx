import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  apiKeyScopeSchema,
  type ApiKeyBinding,
  type CreateApiKeyResponse,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import {
  CustomerPicker,
  OrganizationPicker,
  SalesChannelPicker,
} from '@endora-commerce/admin-kit/components';
import { API_KEYS_PATH } from '../paths.js';

// Feature 062 — the scope catalog is the typed contract enum (research §R3);
// `integrations:manage` is an admin permission, not an api-key scope.
const KNOWN_SCOPES: readonly string[] = apiKeyScopeSchema.options;
const ORDERS_SCOPES: ReadonlySet<string> = new Set(['orders:read', 'orders:write']);

interface CreateApiKeyEnvelope {
  data: CreateApiKeyResponse;
}

interface CreateKeyInput {
  name: string;
  scopes: string[];
  binding?: ApiKeyBinding;
  expiresAt?: string;
}

/**
 * `/api-keys/new` — issuing a key (issue #1501, UX audit SHELL-14). The form
 * was a card drawn open above the key list; it is a route of its own, reached
 * from the list's *New API key*.
 *
 * The page ends on the bearer token, shown once, **in place of the form** —
 * the moment the whole flow exists for (Peak-End): the token, *Copy*, and one
 * way out, back to the list. The token is held in this page's state only and
 * is not carried to the list in router state, which would keep it in the
 * browser's session history.
 */
export default function ApiKeyCreatePage(): ReactNode {
  const t = useTranslation('core');
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const copyToken = useCallback(async (token: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the input is selectable as a fallback */
    }
  }, []);

  const handleCreate = useCallback(
    async (input: CreateKeyInput): Promise<void> => {
      setError(null);
      try {
        const res = await apiClient.post<CreateApiKeyEnvelope>('/api/v1/admin/api-keys', input);
        setRevealed({ name: input.name, token: res.data.bearerToken });
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('apiKeys.error.create'));
        throw err;
      }
    },
    [t],
  );

  return (
    <>
      <PageHeader
        title={t('apiKeys.create.title')}
        back={{ label: t('apiKeys.page.title'), to: API_KEYS_PATH }}
      />
      {revealed ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('apiKeys.revealed.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{revealed.name}</p>
            <div className="mt-2 flex items-center gap-2">
              <Input
                readOnly
                value={revealed.token}
                className="flex-1 bg-muted font-mono text-sm text-foreground"
                onFocus={(e): void => e.currentTarget.select()}
                aria-label={t('apiKeys.revealed.title')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={(): void => void copyToken(revealed.token)}
              >
                {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                {copied ? t('apiKeys.revealed.copied') : t('apiKeys.revealed.copy')}
              </Button>
            </div>
            <Button asChild className="mt-4">
              <Link to={API_KEYS_PATH}>{t('apiKeys.revealed.confirm')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            {error ? (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <CreateKeyForm onSubmit={handleCreate} />
          </CardContent>
        </Card>
      )}
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

      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline">
          <Link to={API_KEYS_PATH}>{t('common.action.cancel')}</Link>
        </Button>
        <Button type="submit" disabled={!canSubmit} aria-busy={submitting}>
          {submitting ? t('apiKeys.create.submitting') : t('apiKeys.create.submit')}
        </Button>
      </div>
    </form>
  );
}
