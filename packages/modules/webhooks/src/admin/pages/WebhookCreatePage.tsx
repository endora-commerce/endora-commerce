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
  Input,
  Label,
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
                <p className="text-xs text-muted-foreground">{created.name}</p>
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
          <CardContent className="pt-6">
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

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim() || !url.trim() || events.size === 0) return;
    setSubmitting(true);
    try {
      await props.onSubmit({
        name: name.trim(),
        url: url.trim(),
        eventTypes: Array.from(events),
        organizationId,
      });
      setName('');
      setUrl('');
      setEvents(new Set());
      setOrganizationId(null);
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
        <div className="space-y-2">
          <Label htmlFor="webhook-name">{t('webhooks.create.nameLabel')}</Label>
          <Input
            id="webhook-name"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            placeholder={t('webhooks.create.namePlaceholder')}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="webhook-url">{t('webhooks.create.urlLabel')}</Label>
          <Input
            id="webhook-url"
            type="url"
            value={url}
            onChange={(e): void => setUrl(e.target.value)}
            placeholder={t('webhooks.create.urlPlaceholder')}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="webhook-organization">{t('webhooks.create.organizationLabel')}</Label>
        <OrganizationPicker
          id="webhook-organization"
          value={organizationId}
          onChange={setOrganizationId}
          ariaLabel={t('webhooks.create.organizationLabel')}
        />
        <p className="text-xs text-muted-foreground">{t('webhooks.create.organizationHelp')}</p>
      </div>
      <div className="space-y-2">
        <Label>{t('webhooks.create.eventsLabel')}</Label>
        <div className="flex flex-wrap gap-3">
          {offeredEventTypes.map((event) => (
            <label
              key={event}
              className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs"
            >
              <Checkbox checked={events.has(event)} onChange={(): void => toggle(event)} />
              <code className="font-mono">{event}</code>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline">
          <Link to={WEBHOOKS_PATH}>{t('common.action.cancel')}</Link>
        </Button>
        <Button
          type="submit"
          disabled={submitting || !name.trim() || !url.trim() || events.size === 0}
          aria-busy={submitting}
        >
          {submitting ? t('webhooks.create.submitting') : t('webhooks.create.submit')}
        </Button>
      </div>
    </form>
  );
}
