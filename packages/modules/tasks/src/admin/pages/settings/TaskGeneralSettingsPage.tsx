import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  InlineStatus,
  Label,
  PageHeader,
  Select,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../../api.js';
import { errorMessage } from '../../lib/labels.js';
import { TaskConfigurationTabs } from '../../components/TaskConfigurationTabs.js';

/** Every zone the runtime knows, and UTC — the server validates the same way (`isIanaTimeZone`). */
function knownTimeZones(current: string | null): string[] {
  const zones = new Set<string>(['UTC', ...Intl.supportedValuesOf('timeZone')]);
  if (current) zones.add(current);
  return [...zones].sort((a, b) => a.localeCompare(b));
}

/**
 * The general Task settings (`specs/165-task-management/` research R-17;
 * `contracts/admin-surfaces.md` §1): the time zone date-only due dates,
 * reminders before the due date and the daily digest hour are counted in —
 * `GET` / `PUT /tasks/settings/time-zone`, the configurators' screen
 * (`tasks:configure`). The server refuses a zone it does not know, in its own
 * words.
 *
 * **The configuration's *General* tab** since issue #1557 (UX audit WORK-06):
 * one field is one short card under the strip, not a page of its own with a
 * description and a back link. The result shows beside Save.
 */
export function TaskGeneralSettingsPage(): ReactNode {
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const zoneId = useId();
  const hintId = useId();
  const [stored, setStored] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = useInlineStatus();
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => knownTimeZones(stored), [stored]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const { timeZone } = await tasksApi.timeZone();
      setStored(timeZone);
      setChosen(timeZone);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    status.clear();
    try {
      const { timeZone } = await tasksApi.setTimeZone(chosen);
      setStored(timeZone);
      setChosen(timeZone);
      status.show(t('settings.saved'));
    } catch (failure) {
      setError(errorMessage(failure, t('settings.saveError')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('settings.title')} />
      <TaskConfigurationTabs />

      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {tCore('common.state.loading')}
        </p>
      ) : loadFailed ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('settings.error')}</span>
            <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
              {tCore('common.action.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardContent className="space-y-4">
            <div className="max-w-md space-y-1">
              <Label htmlFor={zoneId}>{t('settings.timeZone')}</Label>
              <Select
                id={zoneId}
                value={chosen}
                disabled={busy}
                aria-describedby={hintId}
                onChange={(event): void => {
                  setChosen(event.target.value);
                  status.clear();
                }}
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
              <p id={hintId} className="text-xs text-muted-foreground">
                {t('settings.timeZoneHint')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                className="min-h-11 sm:min-h-8"
                disabled={busy || chosen === stored}
                aria-busy={busy}
                onClick={(): void => void save()}
              >
                {t('settings.save')}
              </Button>
              <InlineStatus {...status.props} />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TaskGeneralSettingsPage;
