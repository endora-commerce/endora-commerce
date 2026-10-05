import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { OpportunityWorkflowStatus } from '@endora-commerce/contracts';
import { Card, Input, Label, PageHeader, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import type { AnalyticsFilters } from '../analytics-api.js';
import { AssigneeLookup, SalesChannelLookup } from '../components/LookupPickers.js';
import {
  RANGE_PRESETS,
  isDayRange,
  presetRange,
  type DayRange,
  type RangePreset,
} from '../lib/analytics-format.js';
import { AverageValueCard } from './analytics/AverageValueCard.js';
import { HandlingTimeCard } from './analytics/HandlingTimeCard.js';
import { RepEffectivenessCard } from './analytics/RepEffectivenessCard.js';
import { TimeInStatusCard } from './analytics/TimeInStatusCard.js';
import { TopOpportunitiesCard } from './analytics/TopOpportunitiesCard.js';

/**
 * CRM analytics (User Story 13; `contracts/admin-api.md` §12): five figures
 * over a range of days — how long an Opportunity takes from creation to
 * closing, how long it stays in each status, which Sales Reps win the most,
 * which Opportunities are worth the most, and what an Opportunity is worth on
 * average.
 *
 * **One set of filters, five independent figures.** The range, the Sales
 * Channel and the Sales Rep narrow every figure; each figure is its own read
 * with its own loading, empty and failed state, so one slow or failed figure
 * does not take the others with it. A change of filter applies at once — there
 * is nothing to press.
 *
 * **A chart is never the only carrier.** Each chart is hidden from assistive
 * technology and sits above a table of the same numbers; the two figures whose
 * substance is a list (the most valuable Opportunities, the average per
 * currency) are tables only.
 *
 * **Money is shown per currency**, as the endpoints answer it. Nothing on this
 * screen adds two currencies.
 *
 * The screen opens on `crm:analytics`. The status names and the two pickers
 * are read from `crm:read` endpoints, which that code's `requires` names; a
 * role holding the analytics code alone still gets every figure, with status
 * codes in place of names.
 */
export function AnalyticsPage(): ReactNode {
  const t = useTranslation('crm');
  const ids = useId();
  const [preset, setPreset] = useState<RangePreset>('thisMonth');
  const [range, setRange] = useState<DayRange>(() => presetRange('thisMonth'));
  const [salesChannelId, setSalesChannelId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<OpportunityWorkflowStatus[] | null>(null);

  useEffect(() => {
    let current = true;
    crmApi
      .getWorkflow()
      .then((workflow) => {
        if (current) setStatuses([...workflow.statuses].sort((a, b) => a.weight - b.weight));
      })
      // Without the workflow the figures are still right; a status is then
      // named by its code and cannot be chosen.
      .catch(() => undefined);
    return (): void => {
      current = false;
    };
  }, []);

  const valid = isDayRange(range);
  const filters = useMemo<AnalyticsFilters | null>(
    () =>
      valid
        ? { from: range.from, to: range.to, salesChannelId, assignedAdminUserId: assigneeId }
        : null,
    [valid, range.from, range.to, salesChannelId, assigneeId],
  );

  const presetLabel: Record<RangePreset, string> = {
    thisMonth: t('analytics.filter.range.thisMonth'),
    lastMonth: t('analytics.filter.range.lastMonth'),
    last90Days: t('analytics.filter.range.last90Days'),
    thisYear: t('analytics.filter.range.thisYear'),
    custom: t('analytics.filter.range.custom'),
  };

  const choosePreset = (next: RangePreset): void => {
    setPreset(next);
    // "Custom" keeps the days on screen: they are where the operator starts from.
    if (next !== 'custom') setRange(presetRange(next));
  };
  const editRange = (patch: Partial<DayRange>): void => {
    setPreset('custom');
    setRange((previous) => ({ ...previous, ...patch }));
  };

  const rangeId = `${ids}-range`;
  const fromId = `${ids}-from`;
  const toId = `${ids}-to`;
  const invalidId = `${ids}-invalid`;

  return (
    <>
      <PageHeader title={t('analytics.title')} description={t('analytics.description')} />

      <Card className="mb-6 p-4 sm:p-6">
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
          aria-label={t('analytics.filter.label')}
          onSubmit={(event): void => event.preventDefault()}
        >
          <div className="space-y-1">
            <Label htmlFor={rangeId}>{t('analytics.filter.range')}</Label>
            <Select
              id={rangeId}
              className="min-h-11 sm:min-h-9"
              value={preset}
              onChange={(event): void => choosePreset(event.target.value as RangePreset)}
            >
              {RANGE_PRESETS.map((option) => (
                <option key={option} value={option}>
                  {presetLabel[option]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={fromId}>{t('analytics.filter.from')}</Label>
            <Input
              id={fromId}
              className="min-h-11 sm:min-h-9"
              type="date"
              value={range.from}
              max={range.to || undefined}
              aria-invalid={!valid}
              aria-describedby={valid ? undefined : invalidId}
              onChange={(event): void => editRange({ from: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={toId}>{t('analytics.filter.to')}</Label>
            <Input
              id={toId}
              className="min-h-11 sm:min-h-9"
              type="date"
              value={range.to}
              min={range.from || undefined}
              aria-invalid={!valid}
              aria-describedby={valid ? undefined : invalidId}
              onChange={(event): void => editRange({ to: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${ids}-channel`}>{t('analytics.filter.salesChannel')}</Label>
            <SalesChannelLookup
              id={`${ids}-channel`}
              ariaLabel={t('analytics.filter.salesChannel')}
              value={salesChannelId}
              onChange={setSalesChannelId}
              placeholder={t('analytics.filter.salesChannelAny')}
              emptyMessage={t('opportunity.picker.salesChannelEmpty')}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${ids}-assignee`}>{t('analytics.filter.assignee')}</Label>
            <AssigneeLookup
              id={`${ids}-assignee`}
              ariaLabel={t('analytics.filter.assignee')}
              value={assigneeId}
              onChange={setAssigneeId}
              placeholder={t('analytics.filter.assigneeAny')}
              emptyMessage={t('assignment.picker.empty')}
            />
          </div>
          {/* Mounted before it has text, so the message is announced when it appears. */}
          <p
            id={invalidId}
            role="alert"
            className={valid ? 'sr-only' : 'text-sm text-destructive sm:col-span-2 lg:col-span-5'}
          >
            {valid ? '' : t('analytics.filter.invalidRange')}
          </p>
        </form>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <HandlingTimeCard filters={filters} />
        <AverageValueCard filters={filters} />
        <TimeInStatusCard filters={filters} statuses={statuses} />
        <RepEffectivenessCard filters={filters} />
        <TopOpportunitiesCard filters={filters} />
      </div>
    </>
  );
}

export default AnalyticsPage;
