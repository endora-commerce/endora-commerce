import { useEffect, useState } from 'react';
import { deliverableWebhookEventTypes, type WebhookEventTypeListResponse } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

export interface DeliverableEventTypes {
  /**
   * What a subscription can receive — the built-in types, then the contributed
   * ones, each once. The backend bridges from, and validates against, the same
   * function over the same data (issue #173).
   */
  deliverable: readonly string[];
  /**
   * Whether the contributed types have been read. An unread list is not an
   * empty one: marking a contributed type as undelivered because the read
   * failed would be a second wrong answer on the screen this list exists to
   * make truthful.
   */
  known: boolean;
}

/**
 * The event types other modules contribute, read once per mount — shared by
 * the subscription list (which marks a stored type nothing delivers) and the
 * subscribe form (which offers only what is delivered) since the form moved to
 * its own route (issue #1501). Best effort: with the endpoint unreadable the
 * built-in types are offered and nothing is marked.
 */
export function useDeliverableEventTypes(): DeliverableEventTypes {
  const [contributed, setContributed] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient.get<WebhookEventTypeListResponse>('/api/v1/admin/webhooks/event-types');
        if (!cancelled) setContributed(res.data.map((descriptor) => descriptor.eventType));
      } catch {
        /* the form offers the built-in types regardless */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { deliverable: deliverableWebhookEventTypes(contributed ?? []), known: contributed !== null };
}
