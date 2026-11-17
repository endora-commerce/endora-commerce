import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { ProjectTemplateSummary } from '@endora-commerce/contracts';
import { Card, Input, Label, PageHeader, Select } from '@endora-commerce/admin-kit/ui';
import { useFigure } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { RANGE_PRESETS, isDayRange, presetRange, type DayRange, type RangePreset } from '@endora-commerce/admin-kit/lib';
import { projectsApi } from '../api.js';
import { projectsAnalyticsApi, type ProjectAnalyticsFilters } from '../analytics-api.js';
import { AdminUserLookup, OrganizationLookup } from '../components/LookupPickers.js';
import {
  AverageValueCard,
  DurationsCard,
  LossReasonsCard,
  LossStagesCard,
  LostValueCard,
  ManagersCard,
  SummaryCard,
  TimeInStageCard,
  TopOpenCard,
} from './analytics/cards.js';

/** One read per figure, or none while the range on screen is not a range. */
function useAnalyticsFigure<T>(read: (filters: ProjectAnalyticsFilters) => Promise<T>, filters: ProjectAnalyticsFilters | null) {
  const load = useMemo(() => (filters ? (): Promise<T> => read(filters) : null), [read, filters]);
  return useFigure(load);
}

/**
 * Project analytics (`specs/163-projects-and-tasks/`, User Story 10;
 * `contracts/admin-surfaces.md` §2; FR-037, FR-038): how Projects opened,
 * closed and were lost over a range of days — where they are lost, why, and
 * what was lost with them — modelled on CRM analytics.
 *
 * **One set of filters, independent figures.** The range, the Template, the
 * Organization and the Project Manager narrow every figure; each figure is
 * its own read with its own loading, empty and failed state, so one slow or
 * failed figure does not take the others with it. The three loss cards share
 * one read. A change of filter applies at once — there is nothing to press.
 *
 * **Every figure is over the Projects the reader may see** — the server
 * applies Organization reach and visibility — and each says the period and
 * how many Projects it counted (FR-038).
 *
 * **Days are the reporting time zone's** (issue #475): every figure names the
 * zone the server counted in, the screen says it under the filters, and the
 * presets take "today" from that zone's calendar rather than this computer's.
 *
 * The screen opens on `projects:analytics`; the Template list and the two
 * pickers are `projects:read` reads, which that code's `requires` names.
 */
export function AnalyticsPage(): ReactNode {
  const t = useTranslation('projects');
  const ids = useId();
  const [preset, setPreset] = useState<RangePreset>('thisMonth');
  const [range, setRange] = useState<DayRange>(() => presetRange('thisMonth'));
  const [templateId, setTemplateId] = useState('');
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [projectManagerId, setProjectManagerId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ProjectTemplateSummary[]>([]);

  useEffect(() => {
    let alive = true;
    projectsApi
      .listTemplates()
      .then((loaded) => {
        if (alive) setTemplates(loaded);
      })
      // Without the list the figures are still right; the filter offers "any" only.
      .catch(() => undefined);
    return (): void => {
      alive = false;
    };
  }, []);

  const valid = isDayRange(range);
  const filters = useMemo<ProjectAnalyticsFilters | null>(
    () =>
      valid
        ? { from: range.from, to: range.to, templateId: templateId || null, organizationId, projectManagerId }
        : null,
    [valid, range.from, range.to, templateId, organizationId, projectManagerId],
  );

  const summary = useAnalyticsFigure(projectsAnalyticsApi.summary, filters);
  const durations = useAnalyticsFigure(projectsAnalyticsApi.durations, filters);
  const timeInStage = useAnalyticsFigure(projectsAnalyticsApi.timeInStage, filters);
  const losses = useAnalyticsFigure(projectsAnalyticsApi.losses, filters);
  const value = useAnalyticsFigure(projectsAnalyticsApi.value, filters);
  const topOpen = useAnalyticsFigure(projectsAnalyticsApi.topOpen, filters);
  const managers = useAnalyticsFigure(projectsAnalyticsApi.managers, filters);

  // The zone the server counted in, as the first figure to answer names it (issue #475).
  const timeZone =
    [summary, durations, timeInStage, losses, value, topOpen, managers].find((figure) => figure.data?.timeZone)?.data
      ?.timeZone ?? null;

  // A preset means days of the reporting time zone's calendar: once the zone is
  // known — or if it changes — the preset on screen is taken again in it. A
  // range of the operator's own is theirs and is left alone.
  useEffect(() => {
    if (!timeZone || preset === 'custom') return;
    const next = presetRange(preset, { timeZone });
    setRange((previous) => (previous.from === next.from && previous.to === next.to ? previous : next));
  }, [timeZone, preset]);

  const choosePreset = (next: RangePreset): void => {
    setPreset(next);
    // "Custom" keeps the days on screen: they are where the operator starts from.
    if (next !== 'custom') setRange(presetRange(next, { timeZone }));
  };
  const editRange = (patch: Partial<DayRange>): void => {
    setPreset('custom');
    setRange((previous) => ({ ...previous, ...patch }));
  };

  const invalidId = `${ids}-invalid`;

  return (
    <>
      <PageHeader title={t('analytics.title')} description={t('analytics.description')} />

      <Card className="mb-6 p-4 sm:p-6">
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
          aria-label={t('analytics.filter.label')}
          onSubmit={(event): void => event.preventDefault()}
        >
          <div className="space-y-1">
            <Label htmlFor={`${ids}-range`}>{t('analytics.filter.range')}</Label>
            <Select
              id={`${ids}-range`}
              className="min-h-11 sm:min-h-9"
              value={preset}
              onChange={(event): void => choosePreset(event.target.value as RangePreset)}
            >
              {RANGE_PRESETS.map((option) => (
                <option key={option} value={option}>
                  {t(`analytics.filter.range.${option}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${ids}-from`}>{t('analytics.filter.from')}</Label>
            <Input
              id={`${ids}-from`}
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
            <Label htmlFor={`${ids}-to`}>{t('analytics.filter.to')}</Label>
            <Input
              id={`${ids}-to`}
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
            <Label htmlFor={`${ids}-template`}>{t('analytics.filter.template')}</Label>
            <Select
              id={`${ids}-template`}
              className="min-h-11 sm:min-h-9"
              value={templateId}
              onChange={(event): void => setTemplateId(event.target.value)}
            >
              <option value="">{t('analytics.filter.templateAll')}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.archivedAt ? `${template.name} (${t('templates.list.archived')})` : template.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${ids}-organization`}>{t('analytics.filter.organization')}</Label>
            <OrganizationLookup
              id={`${ids}-organization`}
              ariaLabel={t('analytics.filter.organization')}
              value={organizationId}
              onChange={setOrganizationId}
              placeholder={t('analytics.filter.organizationAny')}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${ids}-manager`}>{t('analytics.filter.manager')}</Label>
            <AdminUserLookup
              id={`${ids}-manager`}
              ariaLabel={t('analytics.filter.manager')}
              value={projectManagerId}
              onChange={setProjectManagerId}
              placeholder={t('analytics.filter.managerAny')}
            />
          </div>
          {/* Mounted before it has text, so the message is announced when it appears. */}
          <p
            id={invalidId}
            role="alert"
            className={valid ? 'sr-only' : 'text-sm text-destructive sm:col-span-2 lg:col-span-3 xl:col-span-6'}
          >
            {valid ? '' : t('analytics.filter.invalidRange')}
          </p>
          {timeZone ? (
            <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3 xl:col-span-6">
              {t('analytics.timeZone', { zone: timeZone })}
            </p>
          ) : null}
        </form>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <SummaryCard figure={summary} />
        <DurationsCard figure={durations} />
        <TimeInStageCard figure={timeInStage} />
        <LossStagesCard figure={losses} />
        <LossReasonsCard figure={losses} />
        <LostValueCard figure={losses} />
        <AverageValueCard figure={value} />
        <ManagersCard figure={managers} />
        <TopOpenCard figure={topOpen} />
      </div>
    </>
  );
}

export default AnalyticsPage;
