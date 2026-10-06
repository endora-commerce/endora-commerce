import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { OpportunityDetail as OpportunityDetailData } from '@endora-commerce/contracts';
import { cn, statusBadgeStyle, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { ModalDialog } from '../components/ModalDialog.js';
import { errorMessage } from '../lib/labels.js';
import { OPPORTUNITY_TABS } from './opportunity-detail/tabs.js';

const LIST_PATH = '/crm/opportunities';

/**
 * One Opportunity (`specs/143-crm-sales-opportunities/`, User Story 1).
 *
 * The page owns the read and the header; everything else is a tab, declared as
 * data in `opportunity-detail/tabs.ts`. With a single tab there is nothing to
 * choose between, so the strip appears with the second one.
 *
 * **Deleting is the page's**, not a tab's: it removes the Opportunity with its
 * links and its history, is gated `crm:configure` like the endpoint, asks first,
 * and leaves for the list. It sits in the header, away from the status buttons
 * a Sales Rep presses all day.
 */
export function OpportunityDetail(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const [opportunity, setOpportunity] = useState<OpportunityDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(OPPORTUNITY_TABS[0]?.id ?? '');
  const sequence = useRef(0);
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('crm:configure');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await crmApi.deleteOpportunity(id);
      void navigate(LIST_PATH);
    } catch (failure) {
      setDeleteError(errorMessage(failure, t('opportunity.delete.error')));
      setDeleting(false);
    }
  };

  const reload = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setError(null);
    try {
      const loaded = await crmApi.getOpportunity(id);
      if (current === sequence.current) setOpportunity(loaded);
    } catch (failure) {
      if (current === sequence.current) {
        setError(errorMessage(failure, t('opportunity.detail.error')));
      }
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    setOpportunity(null);
    setLoading(true);
    void reload();
  }, [reload]);

  const back = { label: t('opportunity.detail.back'), to: LIST_PATH };

  if (opportunity === null) {
    return (
      <>
        <PageHeader title={t('opportunity.detail.title')} back={back} />
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('opportunity.detail.loading')}
          </p>
        ) : (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{error ?? t('opportunity.detail.error')}</span>
              <span className="flex gap-2">
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void reload()}>
                  {tCore('common.action.retry')}
                </Button>
                <Button className="min-h-11 sm:min-h-8" asChild variant="ghost" size="sm">
                  <Link to={LIST_PATH}>{t('opportunity.detail.back')}</Link>
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  const tab =
    OPPORTUNITY_TABS.find((candidate) => candidate.id === activeTab) ?? OPPORTUNITY_TABS[0];
  const TabComponent = tab?.component;

  return (
    <>
      <PageHeader
        title={
          <>
            <span>{opportunity.title}</span>
            <Badge className="font-medium" style={statusBadgeStyle(opportunity.status.color)}>
              {opportunity.status.name}
            </Badge>
          </>
        }
        description={t('opportunity.detail.subtitle', {
          number: opportunity.number,
          organization: opportunity.organization.name,
        })}
        back={back}
        actions={
          canDelete ? (
            <Button
              variant="outline"
              className="min-h-11 text-destructive hover:text-destructive sm:min-h-9"
              onClick={(): void => {
                setDeleteError(null);
                setConfirmingDelete(true);
              }}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {t('opportunity.delete.open')}
            </Button>
          ) : undefined
        }
      />

      {confirmingDelete ? (
        <ModalDialog
          title={t('opportunity.delete.title')}
          busy={deleting}
          onClose={(): void => setConfirmingDelete(false)}
          footer={
            <>
              <Button
                variant="outline"
                className="min-h-11 sm:min-h-9"
                disabled={deleting}
                onClick={(): void => setConfirmingDelete(false)}
              >
                {tCore('common.action.cancel')}
              </Button>
              <Button
                variant="destructive"
                className="min-h-11 sm:min-h-9"
                disabled={deleting}
                aria-busy={deleting}
                onClick={(): void => void remove()}
              >
                {t('opportunity.delete.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {t('opportunity.delete.body', { number: opportunity.number, title: opportunity.title })}
          </p>
          {deleteError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
        </ModalDialog>
      ) : null}

      {/* A later read that failed leaves the last good one on screen. */}
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        {OPPORTUNITY_TABS.length > 1 ? (
          <div className="b2b-tabs-scroll px-1 pt-1">
            <div className="b2b-tabs" role="tablist">
              {OPPORTUNITY_TABS.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  role="tab"
                  id={`crm-opportunity-tab-${candidate.id}`}
                  aria-selected={candidate.id === tab?.id}
                  aria-controls="crm-opportunity-tabpanel"
                  className={cn('b2b-tab', candidate.id === tab?.id && 'is-active')}
                  onClick={(): void => setActiveTab(candidate.id)}
                >
                  {t(candidate.labelKey)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <CardContent
          className="pt-6"
          {...(OPPORTUNITY_TABS.length > 1
            ? {
                id: 'crm-opportunity-tabpanel',
                role: 'tabpanel',
                'aria-labelledby': `crm-opportunity-tab-${tab?.id ?? ''}`,
              }
            : {})}
        >
          <Suspense
            fallback={
              <p role="status" className="text-sm text-muted-foreground">
                {tCore('common.state.loading')}
              </p>
            }
          >
            {TabComponent ? (
              <TabComponent
                // A tab holds state about one Opportunity; another one starts clean.
                key={opportunity.id}
                opportunity={opportunity}
                onChange={setOpportunity}
                reload={reload}
              />
            ) : null}
          </Suspense>
        </CardContent>
      </Card>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default OpportunityDetail;
