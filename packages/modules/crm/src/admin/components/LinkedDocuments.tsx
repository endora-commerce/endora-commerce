import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Unlink } from 'lucide-react';
import type { OpportunityDetail, OpportunityLink } from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
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
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { crmApi, type LinkableOrder, type OrderStatusOption } from '../api.js';
import { CreateDocumentButton, CreatedDocumentNotice } from './CreateFromOpportunity.js';
import { errorMessage, moneyLabel, orderStatusLabel } from '../lib/labels.js';

const SEARCH_DEBOUNCE_MS = 250;

/** The code `orders` reads an Order with; linking one, or making it follow, asks for it too. */
const ORDERS_READ = 'orders:read';

export interface LinkedDocumentsProps {
  opportunity: OpportunityDetail;
  orderStatuses: readonly OrderStatusOption[];
  language: string;
  /** `crm:write` — without it the links are listed and cannot be changed. */
  canWrite: boolean;
  /** A link was added, changed or removed: read the Opportunity again. */
  reload: () => Promise<void>;
}

/**
 * The Orders linked to an Opportunity (FR-020): each with its number, status
 * and total, whether it follows the Opportunity's status, and the way to link
 * another or unlink one.
 *
 * Linking searches **this Organization's** Orders through `orders`' own list
 * endpoint — an Order of another Organization cannot be linked, so it is not
 * offered. The server still decides: an Order that already belongs to another
 * Opportunity is refused in its own words.
 *
 * **Choosing an Order, and deciding whether it follows, needs `orders:read`**
 * as well as `crm:write` — the server asks for both (research N-R3), so the
 * picker and the switch are offered to a holder of both, the Orders list is
 * not asked on behalf of anybody else, and a holder of `crm:write` alone is
 * told why. Unlinking shows nothing of the Order and stays with `crm:write`.
 *
 * Quote Requests have a section of their own (`LinkedQuoteRequests`).
 */
export function LinkedDocuments(props: LinkedDocumentsProps): ReactNode {
  const { opportunity, orderStatuses, language, canWrite, reload } = props;
  const { hasPermission } = useAuth();
  const canLink = canWrite && hasPermission(ORDERS_READ);
  const t = useTranslation('crm');
  const headingId = useId();
  const pickerId = useId();
  const [found, setFound] = useState<LinkableOrder[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);

  const organizationId = opportunity.organization.id;
  const orderLinks = useMemo(
    () => opportunity.links.filter((item) => item.documentKind === 'order'),
    [opportunity.links],
  );

  const search = useCallback(
    async (query: string): Promise<void> => {
      const current = ++sequence.current;
      setSearching(true);
      setSearchFailed(false);
      try {
        const orders = await crmApi.searchOrders(organizationId, query);
        if (current === sequence.current) setFound(orders);
      } catch {
        if (current === sequence.current) {
          setFound([]);
          setSearchFailed(true);
        }
      } finally {
        if (current === sequence.current) setSearching(false);
      }
    },
    [organizationId],
  );

  // The Organization's most recent Orders are offered before anything is typed.
  useEffect(() => {
    if (canLink) void search('');
    return (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [canLink, search]);

  const onSearchChange = (query: string): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void search(query), SEARCH_DEBOUNCE_MS);
  };

  const options = useMemo<ComboboxOption<string>[]>(() => {
    const linked = new Set(orderLinks.map((item) => item.documentId));
    return found
      .filter((order) => !linked.has(order.id))
      .map((order) => ({
        value: order.id,
        label: order.businessId,
        description: `${orderStatusLabel(order.status, orderStatuses, language)} · ${moneyLabel(
          String(order.total),
          order.currency,
        )}`,
      }));
  }, [found, orderLinks, orderStatuses, language]);

  const run = async (key: string, action: () => Promise<string>): Promise<void> => {
    setBusy(key);
    setError(null);
    setNotice('');
    try {
      const done = await action();
      await reload();
      setNotice(done);
    } catch (failure) {
      setError(errorMessage(failure, t('links.error.generic')));
    } finally {
      setBusy(null);
    }
  };

  const link = (): Promise<void> | undefined => {
    if (!selected) return undefined;
    const documentId = selected;
    return run('add', async () => {
      await crmApi.addLink(opportunity.id, { documentKind: 'order', documentId });
      setSelected(null);
      setSelectedLabel('');
      return t('links.linked');
    });
  };

  const setFollowing = (target: OpportunityLink, syncStatus: boolean): Promise<void> =>
    run(target.id, async () => {
      await crmApi.setLinkSync(opportunity.id, target.id, syncStatus);
      return syncStatus ? t('links.followingOn') : t('links.followingOff');
    });

  const unlink = (target: OpportunityLink): Promise<void> =>
    run(target.id, async () => {
      await crmApi.removeLink(opportunity.id, target.id);
      return t('links.unlinked');
    });

  return (
    <section aria-labelledby={headingId} className="space-y-3" aria-busy={busy !== null}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold tracking-tight">
          {t('links.title')}
        </h2>
        <CreateDocumentButton kind="order" opportunity={opportunity} />
      </div>
      <CreatedDocumentNotice kind="order" opportunity={opportunity} reload={reload} />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {orderLinks.length === 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          <Link2 aria-hidden="true" className="size-5 shrink-0" />
          <span>{canWrite ? t('links.empty') : t('links.emptyReadOnly')}</span>
        </div>
      ) : (
        <Table aria-labelledby={headingId}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('links.col.order')}</TableHead>
              <TableHead>{t('links.col.status')}</TableHead>
              <TableHead className="text-right">{t('links.col.total')}</TableHead>
              <TableHead>{t('links.col.following')}</TableHead>
              {canWrite ? (
                <TableHead>
                  <span className="sr-only">{t('links.col.actions')}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {orderLinks.map((item) => {
              const number = item.number ?? t('links.unavailable');
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    {item.available && item.number ? (
                      <Link
                        to={`/orders/${item.documentId}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {item.number}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground" title={t('links.unavailableHint')}>
                        {t('links.unavailable')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.available && item.status ? (
                      <Badge variant="outline">
                        {orderStatusLabel(item.status, orderStatuses, language)}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.available ? moneyLabel(item.total, item.currency ?? opportunity.currency) : null}
                  </TableCell>
                  <TableCell>
                    {canLink ? (
                      <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                        <Checkbox
                          checked={item.syncStatus}
                          disabled={busy !== null}
                          aria-label={t('links.following.label', { number })}
                          onChange={(event): void => void setFollowing(item, event.target.checked)}
                        />
                        <span aria-hidden="true">
                          {item.syncStatus ? t('links.following.on') : t('links.following.off')}
                        </span>
                      </label>
                    ) : (
                      <span className="text-sm">
                        {item.syncStatus ? t('links.following.on') : t('links.following.off')}
                      </span>
                    )}
                  </TableCell>
                  {canWrite ? (
                    <TableCell className="text-right">
                      <Button className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        aria-label={t('links.unlink.label', { number })}
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

      {canWrite && !canLink ? (
        <p className="text-sm text-muted-foreground">{t('links.add.needsOrdersRead')}</p>
      ) : null}
      {canLink ? (
        <div className="space-y-1">
          <Label htmlFor={pickerId}>{t('links.add.label')}</Label>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-[240px] flex-1">
              <Combobox<string>
                id={pickerId}
                ariaLabel={t('links.add.label')}
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
                placeholder={t('links.add.placeholder')}
                emptyMessage={searchFailed ? t('links.error.search') : t('links.add.empty')}
              />
            </div>
            <Button className="min-h-11 sm:min-h-9"
              variant="outline"
              disabled={!selected || busy !== null}
              aria-busy={busy === 'add'}
              onClick={(): void => void link()}
            >
              <Link2 aria-hidden="true" />
              {t('links.add.submit')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('links.add.hint', { organization: opportunity.organization.name })}
          </p>
        </div>
      ) : null}

      <p role="status" className="sr-only">
        {notice}
      </p>
    </section>
  );
}
