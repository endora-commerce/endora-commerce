import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { OpportunityDocumentKind, OpportunitySummary } from '@endora-commerce/contracts';
import { statusBadgeStyle, useAuth } from '@endora-commerce/admin-kit/lib';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { errorMessage, moneyLabel } from '../lib/labels.js';
import { AssigneeName } from './AssigneeName.js';

/**
 * The Opportunity a document belongs to, shown on that document's own screen
 * (User Story 17; `specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §5).
 *
 * Linked: the Opportunity's number, title, status, assignee and value, with a
 * link to it. Linked to none: the two ways to give it one — pick an open
 * Opportunity of the document's Organization, or start a new one that is
 * linked when it is created — for a holder of `crm:write`.
 *
 * The zone renderer has already decided that `crm` is present and that the
 * person holds `crm:read` before this chunk is fetched. The document's screen
 * belongs to another module, which hands over an id and nothing else, so the
 * Organization is read when — and only when — one of the two actions needs it.
 *
 * One component for both kinds of document. What differs is said by the
 * wrapper (which kind, and how its Organization is read) and by the three
 * sentences that name the document — each a key of its own, chosen here by
 * kind, so no key is composed at run time.
 */
export interface LinkedOpportunityPanelProps {
  documentKind: OpportunityDocumentKind;
  documentId: string;
  /** The Organization the document belongs to, read from the document's owner. */
  loadOrganizationId: (documentId: string) => Promise<string | null>;
}

type State =
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'ready'; opportunity: OpportunitySummary | null };

/** How many open Opportunities the picker offers — the newest of the Organization. */
const PICKER_LIMIT = 100;

export function LinkedOpportunityPanel(props: LinkedOpportunityPanelProps): ReactNode {
  const { documentKind, documentId, loadOrganizationId } = props;
  const t = useTranslation('crm');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('crm:write');
  const headingId = useId();
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const read = useCallback(async (): Promise<void> => {
    try {
      setState({ phase: 'ready', opportunity: await crmApi.opportunityOfDocument(documentKind, documentId) });
    } catch {
      setState({ phase: 'failed' });
    }
  }, [documentKind, documentId]);

  useEffect(() => {
    setState({ phase: 'loading' });
    void read();
  }, [read]);

  // Only an unlinked document, in front of somebody who may link it, needs to
  // know whose document it is.
  const unlinked = state.phase === 'ready' && state.opportunity === null;
  useEffect(() => {
    if (!unlinked || !canWrite) return undefined;
    let alive = true;
    loadOrganizationId(documentId)
      .then((id) => {
        if (alive) setOrganizationId(id);
      })
      .catch(() => {
        if (alive) setOrganizationId(null);
      });
    return (): void => {
      alive = false;
    };
  }, [unlinked, canWrite, documentId, loadOrganizationId]);

  const opportunity = state.phase === 'ready' ? state.opportunity : null;

  return (
    <section aria-labelledby={headingId} className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={headingId} className="text-base font-semibold">
              {t('orderPanel.title')}
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.phase === 'loading' ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('orderPanel.loading')}
            </p>
          ) : null}
          {state.phase === 'failed' ? (
            <p role="alert" className="text-sm text-destructive">
              {t('orderPanel.error')}
            </p>
          ) : null}
          {opportunity ? (
            <div className="space-y-3 text-sm">
              <p>
                <Link
                  to={`/crm/opportunities/${opportunity.id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {opportunity.number}
                </Link>{' '}
                <span>{opportunity.title}</span>
              </p>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">{t('orderPanel.field.status')}</dt>
                  <dd>
                    <Badge className="font-medium" style={statusBadgeStyle(opportunity.status.color)}>
                      {opportunity.status.name}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('orderPanel.field.assignee')}</dt>
                  <dd>
                    <AssigneeName assignee={opportunity.assignee} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('orderPanel.field.value')}</dt>
                  <dd className="tabular-nums">{moneyLabel(opportunity.value, opportunity.currency)}</dd>
                </div>
              </dl>
            </div>
          ) : null}
          {unlinked ? (
            <>
              <p className="text-sm text-muted-foreground">
                {documentKind === 'order' ? t('orderPanel.none') : t('orderPanel.noneQuoteRequest')}
              </p>
              {canWrite && organizationId ? (
                <LinkActions
                  documentKind={documentKind}
                  documentId={documentId}
                  organizationId={organizationId}
                  onLinked={read}
                />
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

type Picker =
  | { phase: 'closed' }
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'open'; options: OpportunitySummary[] };

/** "Link to an opportunity" and "Create opportunity", for an unlinked document. */
function LinkActions(props: {
  documentKind: OpportunityDocumentKind;
  documentId: string;
  organizationId: string;
  onLinked: () => Promise<void>;
}): ReactNode {
  const { documentKind, documentId, organizationId, onLinked } = props;
  const t = useTranslation('crm');
  const pickerId = useId();
  const [picker, setPicker] = useState<Picker>({ phase: 'closed' });
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createHref =
    `/crm/opportunities/new?organizationId=${organizationId}` +
    `&linkDocumentKind=${documentKind}&linkDocumentId=${documentId}`;

  const open = async (): Promise<void> => {
    setPicker({ phase: 'loading' });
    setError(null);
    try {
      const page = await crmApi.listOpportunities({ organizationId, state: 'open', limit: PICKER_LIMIT });
      setPicker({ phase: 'open', options: page.data });
    } catch {
      setPicker({ phase: 'failed' });
    }
  };

  const link = async (): Promise<void> => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await crmApi.addLink(chosen, { documentKind, documentId });
      await onLinked();
    } catch (failure) {
      setError(
        errorMessage(
          failure,
          documentKind === 'order' ? t('orderPanel.pick.failed') : t('orderPanel.pick.failedQuoteRequest'),
        ),
      );
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {picker.phase === 'closed' || picker.phase === 'failed' ? (
          <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={(): void => void open()}>
            {t('orderPanel.link')}
          </Button>
        ) : null}
        <Link
          to={createHref}
          className="inline-flex min-h-11 items-center rounded-md border border-input px-3 text-sm font-medium hover:bg-accent sm:min-h-9"
        >
          {t('orderPanel.create')}
        </Link>
      </div>
      {picker.phase === 'loading' ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('orderPanel.pick.loading')}
        </p>
      ) : null}
      {picker.phase === 'failed' ? (
        <p role="alert" className="text-sm text-destructive">
          {t('orderPanel.pick.error')}
        </p>
      ) : null}
      {picker.phase === 'open' && picker.options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('orderPanel.pick.empty')}</p>
      ) : null}
      {picker.phase === 'open' && picker.options.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1 sm:max-w-md">
            <Label htmlFor={pickerId}>{t('orderPanel.pick.label')}</Label>
            <Select
              id={pickerId}
              value={chosen}
              disabled={busy}
              onChange={(event): void => setChosen(event.target.value)}
            >
              <option value="">{t('orderPanel.pick.placeholder')}</option>
              {picker.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {`${option.number} — ${option.title}`}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            className="min-h-11 sm:min-h-9"
            disabled={busy || chosen === ''}
            aria-busy={busy}
            onClick={(): void => void link()}
          >
            {busy ? t('orderPanel.pick.linking') : t('orderPanel.pick.confirm')}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
