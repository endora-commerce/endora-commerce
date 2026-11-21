import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CreateWebhookResponse } from '@endora-commerce/contracts';
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
import { OrganizationPicker } from '@endora-commerce/admin-kit/components';
import { WEBHOOKS_PATH } from '../paths.js';
import { useDeliverableEventTypes } from '../use-deliverable-event-types.js';

interface CreateWebhookInput {
  name: string;
  url: string;
  eventTypes: string[];
  organizationId: string | null;
}

/**
 * `/webhooks/new` — subscribing to events (issue #1501, UX audit SHELL-14).
 * The form was a card drawn open above the subscription list; it is a route
 * of its own, reached from the list's *New webhook*.
 *
 * The page ends on the signing secret, shown once, **in place of the form**
 * (Peak-End): the confirmation, the secret with *Copy*, and one way out, back
 * to the list. The secret is held in this page's state only and is not carried
 * to the list in router state, which would keep it in the browser's session
 * history.
 */
export default function WebhookCreatePage(): ReactNode {
  const t = useTranslation('core');
  const { deliverable } = useDeliverableEventTypes();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; secret: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const copySecret = useCallback(async (secret: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the input is selectable as a fallback */
    }
  }, []);

  const handleCreate = useCallback(
    async (input: CreateWebhookInput): Promise<void> => {
      setError(null);
      try {
        const res = await apiClient.post<CreateWebhookResponse>('/api/v1/admin/webhooks', {
          name: input.name,
          url: input.url,
          eventTypes: input.eventTypes,
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        });
        setCreated({ name: input.name, secret: res.data.secret ? res.data.secret : null });
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('webhooks.error.create'));
        throw err;
      }
    },
    [t],
  );

  return (
    <>
      <PageHeader title={t('webhooks.create.title')} back={{ label: t('webhooks.page.title'), to: WEBHOOKS_PATH }} />
      {created ? (
        <Card>
          <CardHeader>
            <CardTitle>{created.secret ? t('webhooks.revealed.title') : t('webhooks.create.success')}</CardTitle>
          </CardHeader>
          <CardContent>
            {created.secret ? (
              <>
                <p className="text-sm text-muted-foreground">{t('webhooks.revealed.body')}</p>
                <p className="mt-2 text-xs text-muted-foreground">{created.name}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    readOnly
                    value={created.secret}
                    className="flex-1 bg-muted font-mono text-sm text-foreground"
                    onFocus={(e): void => e.currentTarget.select()}
                    aria-label={t('webhooks.revealed.title')}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={(): void => void copySecret(created.secret ?? '')}
                  >
                    {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                    {copied ? t('webhooks.revealed.copied') : t('webhooks.revealed.copy')}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{created.name}</p>
            )}
            <Button asChild className="mt-4">
              <Link to={WEBHOOKS_PATH}>
                {created.secret ? t('webhooks.revealed.confirm') : t('webhooks.create.backToList')}
              </Link>
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
            <CreateWebhookForm onSubmit={handleCreate} offeredEventTypes={deliverable} />
          </CardContent>
        </Card>
      )}
    </>
  );
}

/**
 * Which organizations a subscription hears about (issue #1551, UX audit
 * SHELL-15) — a choice rather than an optional picker under a paragraph about
 * what leaving it empty means. All organizations is the default, and the
 * subscription the contract stores with `organizationId: null`.
 */
type WebhookScope = 'all' | 'organization';

const WEBHOOK_SCOPES = [
  { scope: 'all', labelKey: 'webhooks.create.scope.all.label', hintKey: 'webhooks.create.scope.all.hint' },
  {
    scope: 'organization',
    labelKey: 'webhooks.create.scope.organization.label',
    hintKey: 'webhooks.create.scope.organization.hint',
  },
] as const satisfies ReadonlyArray<{ scope: WebhookScope; labelKey: string; hintKey: string }>;

function CreateWebhookForm(props: {
  onSubmit: (input: CreateWebhookInput) => Promise<void>;
  /**
   * Every event type a subscription can receive — the built-in ones, then the
   * contributed ones, each once. The form keeps no list of its own.
   */
  offeredEventTypes: readonly string[];
}): ReactNode {
  const t = useTranslation('core');
  const { offeredEventTypes } = props;
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<WebhookScope>('all');
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggle = (event: string): void => {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  };

  const boundOrganizationId = scope === 'organization' ? organizationId : null;
  const canSubmit =
    !submitting &&
    name.trim() !== '' &&
    url.trim() !== '' &&
    events.size > 0 &&
    (scope === 'all' || boundOrganizationId !== null);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await props.onSubmit({
        name: name.trim(),
        url: url.trim(),
        eventTypes: Array.from(events),
        organizationId: boundOrganizationId,
      });
    } catch {
      /* surfaced by the page's error alert; the form keeps what was typed */
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
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label={t('webhooks.create.nameLabel')} required>
          <Input
            id="webhook-name"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            placeholder={t('webhooks.create.namePlaceholder')}
            required
          />
        </FormField>
        <FormField label={t('webhooks.create.urlLabel')} required>
          <Input
            id="webhook-url"
            type="url"
            value={url}
            onChange={(e): void => setUrl(e.target.value)}
            placeholder={t('webhooks.create.urlPlaceholder')}
            required
          />
        </FormField>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium">{t('webhooks.create.scope.label')}</legend>
        <div className="grid gap-2 md:grid-cols-2">
          {WEBHOOK_SCOPES.map((option) => (
            <label
              key={option.scope}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary"
            >
              <input
                type="radio"
                name="webhook-scope"
                value={option.scope}
                checked={scope === option.scope}
                onChange={(): void => setScope(option.scope)}
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

      {scope === 'organization' ? (
        <FormField label={t('webhooks.create.organizationLabel')} className="md:max-w-md" required>
          {(control): ReactNode => (
            <OrganizationPicker
              id={control.id}
              value={organizationId}
              onChange={setOrganizationId}
              ariaLabel={t('webhooks.create.organizationLabel')}
            />
          )}
        </FormField>
      ) : null}

      <FormField label={t('webhooks.create.eventsLabel')} group required>
        <div className="flex flex-wrap gap-2">
          {offeredEventTypes.map((event) => (
            <label
              key={event}
              className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs"
            >
              <Checkbox checked={events.has(event)} onChange={(): void => toggle(event)} />
              <code className="font-mono">{event}</code>
            </label>
          ))}
        </div>
      </FormField>

      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline">
          <Link to={WEBHOOKS_PATH}>{t('common.action.cancel')}</Link>
        </Button>
        <Button type="submit" disabled={!canSubmit} aria-busy={submitting}>
          {submitting ? t('webhooks.create.submitting') : t('webhooks.create.submit')}
        </Button>
      </div>
    </form>
  );
}
