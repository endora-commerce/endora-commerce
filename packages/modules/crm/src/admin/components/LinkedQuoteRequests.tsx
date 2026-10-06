import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Link2, Unlink } from 'lucide-react';
import type {
  OpportunityDetail,
  OpportunityLink,
  OpportunityQuoteRequestOption,
} from '@endora-commerce/contracts';
import { ApiError, useModulePresence } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Combobox,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type ComboboxOption,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { CreateDocumentButton, CreatedDocumentNotice } from './CreateFromOpportunity.js';
import { errorMessage, moneyLabel } from '../lib/labels.js';

const SEARCH_DEBOUNCE_MS = 250;

/** The module that owns Quote Requests; its presence is the server's to say. */
const QUOTE_REQUESTS_MODULE = 'quote_requests';

/**
 * A Quote Request status as a bundle key: `Created from admin` →
 * `links.quote.status.created_from_admin`.
 */
export function quoteRequestStatusKey(status: string): string {
  return `links.quote.status.${status.toLowerCase().replace(/\s+/g, '_')}`;
}

/** Whether a failed call says a module is switched off, and which. */
export function disabledModuleOf(failure: unknown): string | null {
  if (!(failure instanceof ApiError) || failure.status !== 503) return null;
  if (failure.envelope.error.code !== 'MODULE_DISABLED') return null;
  const details = failure.envelope.error.details as { module?: unknown } | undefined;
  return typeof details?.module === 'string' ? details.module : null;
}

export interface LinkedQuoteRequestsProps {
  opportunity: OpportunityDetail;
  /** `crm:write` — without it the links are listed and cannot be changed. */
  canWrite: boolean;
  /** A link was added or removed: read the Opportunity again. */
  reload: () => Promise<void>;
}

/**
 * The Quote Requests linked to an Opportunity (User Story 8, FR-021): each with
 * its number, status and net total, and the way to link another or unlink one.
 *
 * **The Quote Requests module is optional, and this section degrades with it.**
 * Whether it is present comes from the server's enabled-set
 * (`useModulePresence`), never from a list here. While it is off: nothing can
 * be linked (the picker is not offered, and the reason is said), links made
 * earlier stay listed as unavailable and can still be removed, and a section
 * with nothing to show is not rendered at all. A 503 `MODULE_DISABLED` that
 * arrives anyway — the module was switched off after this page was opened —
 * is treated the same way rather than shown as a failure.
 *
 * The search goes through CRM's own lookup, limited to this Organization
 * (research N-H2): a Sales Rep needs no code of the quote desk to link.
 */
export function LinkedQuoteRequests(props: LinkedQuoteRequestsProps): ReactNode {
  const { opportunity, canWrite, reload } = props;
  const t = useTranslation('crm');
  const { isPresent } = useModulePresence();
  const headingId = useId();
  const pickerId = useId();
  const [switchedOff, setSwitchedOff] = useState(false);
  const [found, setFound] = useState<OpportunityQuoteRequestOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);

  const present = isPresent(QUOTE_REQUESTS_MODULE) && !switchedOff;
  const organizationId = opportunity.organization.id;
  const quoteLinks = useMemo(
    () => opportunity.links.filter((item) => item.documentKind === 'quote_request'),
    [opportunity.links],
  );

  const search = useCallback(
    async (query: string): Promise<void> => {
      const current = ++sequence.current;
      setSearching(true);
      setSearchFailed(false);
      try {
        const options = await crmApi.lookupQuoteRequests(organizationId, query);
        if (current === sequence.current) setFound(options);
      } catch (failure) {
        if (current !== sequence.current) return;
        setFound([]);
        if (disabledModuleOf(failure) === QUOTE_REQUESTS_MODULE) setSwitchedOff(true);
        else setSearchFailed(true);
      } finally {
        if (current === sequence.current) setSearching(false);
      }
    },
    [organizationId],
  );

  useEffect(() => {
    if (canWrite && present) void search('');
    return (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [canWrite, present, search]);

  const onSearchChange = (query: string): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void search(query), SEARCH_DEBOUNCE_MS);
  };

  const options = useMemo<ComboboxOption<string>[]>(() => {
    const linked = new Set(quoteLinks.map((item) => item.documentId));
    return found
      .filter((option) => !linked.has(option.id))
      .map((option) => ({
        value: option.id,
        label: option.number,
        description: t(quoteRequestStatusKey(option.status)),
      }));
  }, [found, quoteLinks, t]);

  const run = async (key: string, action: () => Promise<string>): Promise<void> => {
    setBusy(key);
    setError(null);
    setNotice('');
    try {
      const done = await action();
      await reload();
      setNotice(done);
    } catch (failure) {
      if (disabledModuleOf(failure) === QUOTE_REQUESTS_MODULE) setSwitchedOff(true);
      else setError(errorMessage(failure, t('links.error.generic')));
    } finally {
      setBusy(null);
    }
  };

  const link = (): Promise<void> | undefined => {
    if (!selected) return undefined;
    const documentId = selected;
    return run('add', async () => {
      await crmApi.addLink(opportunity.id, { documentKind: 'quote_request', documentId });
      setSelected(null);
      setSelectedLabel('');
      return t('links.quote.linked');
    });
  };

  const unlink = (target: OpportunityLink): Promise<void> =>
    run(target.id, async () => {
      await crmApi.removeLink(opportunity.id, target.id);
      return t('links.quote.unlinked');
    });

  // Off, and nothing was ever linked: there is nothing true to show.
  if (!present && quoteLinks.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-3" aria-busy={busy !== null}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold tracking-tight">
          {t('links.quote.title')}
        </h2>
        {present ? <CreateDocumentButton kind="quote_request" opportunity={opportunity} /> : null}
      </div>
      <CreatedDocumentNotice kind="quote_request" opportunity={opportunity} reload={reload} />

      {!present ? (
        <Alert>
          <AlertDescription>{t('links.quote.moduleOff')}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {quoteLinks.length === 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          <FileText aria-hidden="true" className="size-5 shrink-0" />
          <span>{canWrite ? t('links.quote.empty') : t('links.quote.emptyReadOnly')}</span>
        </div>
      ) : (
        <Table aria-labelledby={headingId}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('links.quote.col.number')}</TableHead>
              <TableHead>{t('links.quote.col.status')}</TableHead>
              <TableHead className="text-right">{t('links.quote.col.total')}</TableHead>
              {canWrite ? (
                <TableHead>
                  <span className="sr-only">{t('links.col.actions')}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {quoteLinks.map((item) => {
              const shown = present && item.available && item.number;
              const number = item.number ?? t('links.quote.unavailable');
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    {shown ? (
                      <Link
                        to={`/quote-requests/${item.documentId}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {item.number}
                      </Link>
                    ) : (
                      <span
                        className="text-muted-foreground"
                        title={t('links.quote.unavailableHint')}
                      >
                        {t('links.quote.unavailable')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {shown && item.status ? (
                      <Badge variant="outline">{t(quoteRequestStatusKey(item.status))}</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {shown ? moneyLabel(item.total, item.currency ?? opportunity.currency) : null}
                  </TableCell>
                  {canWrite ? (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 sm:min-h-9"
                        disabled={busy !== null}
                        aria-label={t('links.quote.unlink.label', { number })}
                        onClick={(): void => void unlink(item)}
                      >
                        <Unlink aria-hidden="true" />
                        {t('links.unlink.action')}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {canWrite && present ? (
        <div className="space-y-1">
          <Label htmlFor={pickerId}>{t('links.quote.add.label')}</Label>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-[240px] flex-1">
              <Combobox<string>
                id={pickerId}
                ariaLabel={t('links.quote.add.label')}
                options={options}
                value={selected}
                selectedLabel={selectedLabel}
                onChange={(next): void => {
                  setSelected(next);
                  setSelectedLabel(options.find((option) => option.value === next)?.label ?? '');
                }}
                onSearchChange={onSearchChange}
                manualFilter
                loading={searching}
                disabled={busy !== null}
                placeholder={t('links.quote.add.placeholder')}
                emptyMessage={
                  searchFailed ? t('links.quote.error.search') : t('links.quote.add.empty')
                }
              />
            </div>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              disabled={!selected || busy !== null}
              aria-busy={busy === 'add'}
              onClick={(): void => void link()}
            >
              <Link2 aria-hidden="true" />
              {t('links.quote.add.submit')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('links.quote.add.hint', { organization: opportunity.organization.name })}
          </p>
        </div>
      ) : null}

      <p role="status" className="sr-only">
        {notice}
      </p>
    </section>
  );
}
