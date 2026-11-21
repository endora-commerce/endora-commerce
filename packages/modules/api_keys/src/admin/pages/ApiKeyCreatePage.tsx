import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ApiKeyBinding, CreateApiKeyResponse } from '@endora-commerce/contracts';
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
  FormField,
  Input,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import {
  CustomerPicker,
  OrganizationPicker,
  SalesChannelPicker,
} from '@endora-commerce/admin-kit/components';
import { scopesForKeyKind, type ApiKeyKind } from '../key-kind.js';
import { API_KEYS_PATH } from '../paths.js';

/**
 * The key kinds, platform first — the default, and the kind a key without a
 * binding always was. The scope catalog behind each is the typed contract enum
 * (feature 062, research §R3); `integrations:manage` is an admin permission,
 * not an api-key scope.
 */
const API_KEY_KINDS = [
  {
    kind: 'platform',
    labelKey: 'apiKeys.create.kind.platform.label',
    hintKey: 'apiKeys.create.kind.platform.hint',
  },
  {
    kind: 'organization',
    labelKey: 'apiKeys.create.kind.organization.label',
    hintKey: 'apiKeys.create.kind.organization.hint',
  },
] as const satisfies ReadonlyArray<{ kind: ApiKeyKind; labelKey: string; hintKey: string }>;

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
 *
 * The form opens on a choice of key kind (issue #1551, UX audit SHELL-15):
 * *Platform key* or *Organization key*. The binding trio appears only for the
 * second, and each kind offers only the scopes it may hold, so the rules the
 * form used to explain in three paragraphs and three errors are what it offers.
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
          <CardContent>
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
  const [kind, setKind] = useState<ApiKeyKind>('platform');
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [salesChannelId, setSalesChannelId] = useState<string | null>(null);
  const [customerAccountId, setCustomerAccountId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const offeredScopes = scopesForKeyKind(kind);

  const toggle = (scope: string): void => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const chooseKind = (next: ApiKeyKind): void => {
    setKind(next);
    // A scope the new kind cannot hold is dropped rather than refused (B1, B2).
    const allowed = new Set<string>(scopesForKeyKind(next));
    setScopes((prev) => new Set(Array.from(prev).filter((scope) => allowed.has(scope))));
  };

  const handleOrganizationChange = (id: string | null): void => {
    setOrganizationId(id);
    // B3 by construction — the service account must belong to the chosen
    // org, so a changed org invalidates the previous selection.
    setCustomerAccountId(null);
  };

  const binding: ApiKeyBinding | null =
    kind === 'organization' && organizationId !== null && salesChannelId !== null && customerAccountId !== null
      ? { organizationId, salesChannelId, customerAccountId }
      : null;

  // B5's inline mirror — the one creation rule the form cannot absorb.
  const expiryError =
    expiresAt !== '' && new Date(expiresAt).getTime() <= Date.now() ? t('apiKeys.validation.expiryFuture') : undefined;

  const canSubmit =
    name.trim().length > 0 &&
    scopes.size > 0 &&
    (kind === 'platform' || binding !== null) &&
    expiryError === undefined &&
    !submitting;

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await props.onSubmit({
        name: name.trim(),
        scopes: offeredScopes.filter((scope) => scopes.has(scope)),
        ...(binding !== null ? { binding } : {}),
        ...(expiresAt !== '' ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      });
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
      <FormField label={t('apiKeys.create.nameLabel')} required>
        <Input
          id="api-key-name"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          placeholder={t('apiKeys.create.namePlaceholder')}
          required
        />
      </FormField>

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium">{t('apiKeys.create.kind.label')}</legend>
        <div className="grid gap-2 md:grid-cols-2">
          {API_KEY_KINDS.map((option) => (
            <label
              key={option.kind}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary"
            >
              <input
                type="radio"
                name="api-key-kind"
                value={option.kind}
                checked={kind === option.kind}
                onChange={(): void => chooseKind(option.kind)}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{t(option.labelKey)}</span>
                <span className="block text-xs text-muted-foreground">{t(option.hintKey)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {kind === 'organization' ? (
        <div className="grid gap-4 md:grid-cols-3">
          <FormField label={t('apiKeys.create.organizationLabel')} required>
            {(control): ReactNode => (
              <OrganizationPicker
                id={control.id}
                value={organizationId}
                onChange={handleOrganizationChange}
                ariaLabel={t('apiKeys.create.organizationLabel')}
              />
            )}
          </FormField>
          <FormField label={t('apiKeys.create.salesChannelLabel')} required>
            {(control): ReactNode => (
              <SalesChannelPicker
                id={control.id}
                value={salesChannelId}
                onChange={setSalesChannelId}
                ariaLabel={t('apiKeys.create.salesChannelLabel')}
              />
            )}
          </FormField>
          <FormField
            label={t('apiKeys.create.serviceAccountLabel')}
            hint={t('apiKeys.create.serviceAccount.hint')}
            required
          >
            {(control): ReactNode => (
              <CustomerPicker
                id={control.id}
                value={customerAccountId}
                onChange={setCustomerAccountId}
                status="active"
                {...(organizationId !== null ? { organizationId } : {})}
                disabled={organizationId === null}
                ariaLabel={t('apiKeys.create.serviceAccountLabel')}
              />
            )}
          </FormField>
        </div>
      ) : null}

      <FormField label={t('apiKeys.create.scopesLabel')} hint={t('apiKeys.create.scopes.hint')} group required>
        <div className="flex flex-wrap gap-2">
          {offeredScopes.map((scope) => (
            <label
              key={scope}
              className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs"
            >
              <Checkbox checked={scopes.has(scope)} onChange={(): void => toggle(scope)} />
              <code className="font-mono">{scope}</code>
            </label>
          ))}
        </div>
      </FormField>

      <FormField
        label={t('apiKeys.create.expiresLabel')}
        hint={t('apiKeys.create.expires.hint')}
        error={expiryError}
      >
        <Input
          id="api-key-expires-at"
          type="datetime-local"
          className="md:max-w-xs"
          value={expiresAt}
          onChange={(e): void => setExpiresAt(e.target.value)}
        />
      </FormField>

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
