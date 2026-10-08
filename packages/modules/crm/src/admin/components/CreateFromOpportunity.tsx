import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { OpportunityDetail, OpportunityDocumentKind } from '@endora-commerce/contracts';
import { useAuth, useModulePresence } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Creating an Order or a Quote Request from within an Opportunity (User Story
 * 10, FR-026).
 *
 * **CRM builds a link; the owner's screen does the creating.** The button opens
 * `orders`' or `quote_requests`' own create screen with a query string: the
 * `origin` those screens send on with their create request, what to preselect,
 * and the path to come back to. Neither screen knows what an Opportunity is —
 * the words `crm_opportunity` are this module's, and the backend's subscriber
 * is where the origin is checked and the link written.
 *
 * Each button needs **both** rights: `crm:write` (the Opportunity gains a
 * link) and the owner's own code for creating — the code its route asks for,
 * so nobody follows a button to a form whose save would refuse.
 */

/** The `origin.type` this module's subscriber answers to. */
const ORIGIN_TYPE = 'crm_opportunity';

/** Per kind: the owner's create screen and the code that opens it. */
const TARGETS = {
  order: {
    path: '/orders/new',
    /** `POST /api/v1/admin/orders` is gated `orders:write`. */
    permission: 'orders:write',
    documentPath: '/orders',
  },
  quote_request: {
    path: '/quote-requests/new',
    /** `POST /api/v1/admin/quote-requests` is gated `rfqs:handle`. */
    permission: 'rfqs:handle',
    documentPath: '/quote-requests',
  },
} as const satisfies Record<OpportunityDocumentKind, unknown>;

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The sentences of one kind. Every key is written out in full, so the copy
 * check that reads this module's sources finds each of them.
 */
function wording(kind: OpportunityDocumentKind, t: Translate) {
  return kind === 'order'
    ? {
        create: (): string => t('origin.order.create'),
        linking: (): string => t('origin.order.linking'),
        linked: (number: string): string => t('origin.order.linked', { number }),
        notLinked: (): string => t('origin.order.notLinked'),
        open: (): string => t('origin.order.open'),
      }
    : {
        create: (): string => t('origin.quote.create'),
        linking: (): string => t('origin.quote.linking'),
        linked: (number: string): string => t('origin.quote.linked', { number }),
        notLinked: (): string => t('origin.quote.notLinked'),
        open: (): string => t('origin.quote.open'),
      };
}

/** The module that owns Quote Requests; its presence is the server's to say. */
const QUOTE_REQUESTS_MODULE = 'quote_requests';

/** The marker this module puts in its own return address, so the right section answers. */
const CREATED_PARAM = 'created';

/** Where the create screen of `kind` is opened for `opportunity`. */
export function createDocumentHref(kind: OpportunityDocumentKind, opportunity: OpportunityDetail): string {
  const params = new URLSearchParams({
    originType: ORIGIN_TYPE,
    originId: opportunity.id,
    organizationId: opportunity.organization.id,
  });
  if (opportunity.customerAccount) params.set('customerAccountId', opportunity.customerAccount.id);
  if (opportunity.salesChannelId) params.set('salesChannelId', opportunity.salesChannelId);
  params.set('returnTo', `/crm/opportunities/${opportunity.id}?${CREATED_PARAM}=${kind}`);
  return `${TARGETS[kind].path}?${params.toString()}`;
}

export interface CreateDocumentButtonProps {
  kind: OpportunityDocumentKind;
  opportunity: OpportunityDetail;
}

/**
 * "Create order" / "Create quote request". Renders nothing for somebody who
 * may not do it, and nothing for a Quote Request while that module is off.
 */
export function CreateDocumentButton({ kind, opportunity }: CreateDocumentButtonProps): ReactNode {
  const t = useTranslation('crm');
  const { hasPermission } = useAuth();
  const { isPresent } = useModulePresence();
  const target = TARGETS[kind];

  if (!hasPermission('crm:write') || !hasPermission(target.permission)) return null;
  if (kind === 'quote_request' && !isPresent(QUOTE_REQUESTS_MODULE)) return null;

  return (
    <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-9">
      <Link to={createDocumentHref(kind, opportunity)}>
        <Plus aria-hidden="true" className="size-4" />
        {wording(kind, t).create()}
      </Link>
    </Button>
  );
}

/** The id the owner's create screen hands back in the navigation state. */
function createdDocumentId(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  const created = (state as { createdDocument?: unknown }).createdDocument;
  if (typeof created !== 'object' || created === null) return null;
  const id = (created as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * How long to keep looking for the link, in milliseconds between reads. The
 * link is written by a subscriber just after the document commits, so the
 * first read after coming back can be a moment too early.
 */
const LINK_WAIT_PAUSES = [300, 700, 1500, 3000] as const;

export interface CreatedDocumentNoticeProps {
  kind: OpportunityDocumentKind;
  opportunity: OpportunityDetail;
  /** Read the Opportunity again; resolves once the new read is on screen. */
  reload: () => Promise<void>;
}

/**
 * What the Opportunity says to somebody who has just come back from creating
 * a document: that it is being linked, then that it is — or, if the link never
 * comes (the customer chosen on the create screen was of another organization,
 * say), that the document exists and where it is.
 *
 * Says nothing on any other visit: it speaks only when the return address
 * carries this module's own marker **and** the create screen handed an id over.
 */
export function CreatedDocumentNotice(props: CreatedDocumentNoticeProps): ReactNode {
  const { kind, opportunity, reload } = props;
  const t = useTranslation('crm');
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [attempt, setAttempt] = useState(0);
  const target = TARGETS[kind];
  const words = wording(kind, t);

  const createdId = searchParams.get(CREATED_PARAM) === kind ? createdDocumentId(location.state) : null;
  const link = createdId
    ? opportunity.links.find((item) => item.documentKind === kind && item.documentId === createdId)
    : undefined;
  const waiting = createdId !== null && link === undefined && attempt < LINK_WAIT_PAUSES.length;

  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(() => {
      void reload().finally(() => setAttempt((previous) => previous + 1));
    }, LINK_WAIT_PAUSES[attempt]);
    return (): void => clearTimeout(timer);
  }, [waiting, attempt, reload]);

  if (createdId === null) return null;

  if (link) {
    return (
      <Alert role="status" variant="success">
        <AlertDescription>
          {words.linked(link.number ?? t('links.unavailable'))}
        </AlertDescription>
      </Alert>
    );
  }
  if (waiting) {
    return (
      <Alert role="status" aria-busy="true">
        <AlertDescription>{words.linking()}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert role="status" variant="warning">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{words.notLinked()}</span>
        <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-9">
          <Link to={`${target.documentPath}/${createdId}`}>{words.open()}</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
