import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { BellRing, ChevronDown } from 'lucide-react';
import { Alert, AlertDescription, Button, Checkbox, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cn } from '@endora-commerce/admin-kit/lib';
import { tasksApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';

/** The hour a digest is turned on at when nobody chose one yet. */
const DEFAULT_HOUR = 8;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** `8` → `08:00` — a wall-clock hour of the Tasks time zone. */
function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * The *Daily digest* control on *My Tasks* (`specs/165-task-management/` User
 * Story 7 scenario 5, FR-036; `contracts/admin-surfaces.md` §1).
 *
 * The caller's own, off by default (Q3 = A): on, at an hour of the Tasks time
 * zone, a notification and an e-mail list their open Tasks due that day or
 * overdue — and nothing is sent on a day with none. Turning it on or off is
 * saved at once; a chosen hour is staged and saved with *Save the hour*, so
 * moving through the list with the arrow keys writes nothing (WCAG 3.2.2,
 * T092) (`PUT` / `DELETE /tasks/me/digest`). Each save is said in a polite
 * live region.
 *
 * Issue #1563 (UX WORK-14, architect ruling DEC-14 on #512): the control is a
 * setting, not the work, so *My Tasks* no longer opens with it above the
 * filters. {@link useDigestDisclosure} returns a one-line summary for the
 * page header's actions — "Daily digest: off" / "Daily digest: on, 08:00",
 * so the state is read without opening anything — and the panel it discloses
 * (`aria-expanded` / `aria-controls`), mounted below the header and closed by
 * default (Flow, Signal-to-noise). The panel stays mounted while closed, so
 * its polite live region exists before a save gives it text (WCAG 4.1.3).
 */
export function useDigestDisclosure(): { trigger: ReactNode; panel: ReactNode } {
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const toggleId = useId();
  const hourId = useId();
  const hintId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState<number | null>(null);
  /** The hour chosen in the list and not saved yet; `null` when it is the stored one. */
  const [staged, setStaged] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Bumped by *Retry*: the digest is read again (issue #512). */
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const hourRef = useRef<HTMLSelectElement>(null);
  /** After saving a staged hour: back to the list, since *Save the hour* is disabled again. */
  const [refocusHour, setRefocusHour] = useState(false);

  useEffect(() => {
    if (!refocusHour || busy) return;
    setRefocusHour(false);
    hourRef.current?.focus();
  }, [refocusHour, busy]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoadFailed(false);
    tasksApi
      .digest()
      .then((subscription) => {
        if (!live) return;
        setHour(subscription?.hour ?? null);
        setLoaded(true);
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const save = async (next: number | null): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      if (next === null) {
        await tasksApi.stopDigest();
        setHour(null);
        setStaged(null);
        setNotice(t('digest.off'));
      } else {
        const saved = await tasksApi.setDigest(next);
        const savedHour = saved?.hour ?? next;
        setHour(savedHour);
        setStaged(null);
        setNotice(t('digest.on', { hour: hourLabel(savedHour) }));
      }
    } catch (failure) {
      setError(errorMessage(failure, t('digest.saveError')));
    } finally {
      setBusy(false);
    }
  };

  const summary = !loaded
    ? t('digest.title')
    : hour === null
      ? t('digest.summary.off')
      : t('digest.summary.on', { hour: hourLabel(hour) });

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      className="min-h-11 sm:min-h-9"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={(): void => setOpen((current) => !current)}
    >
      <BellRing aria-hidden="true" />
      {summary}
      <ChevronDown aria-hidden="true" className={cn('transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
    </Button>
  );

  const panel = (
    <section
      id={panelId}
      hidden={!open}
      aria-label={t('digest.title')}
      className="mb-4 space-y-2 rounded-md border p-3 text-sm"
    >
      {loadFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground">{t('digest.error')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={(): void => setAttempt((count) => count + 1)}
          >
            {tCore('common.action.retry')}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label htmlFor={toggleId} className="flex min-h-11 items-center gap-2 font-medium sm:min-h-8">
              <Checkbox
                id={toggleId}
                checked={hour !== null}
                disabled={!loaded || busy}
                aria-describedby={hintId}
                onChange={(event): void => void save(event.target.checked ? DEFAULT_HOUR : null)}
              />
              {t('digest.toggle')}
            </label>
            {hour !== null ? (
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={hourId}>{t('digest.hour')}</Label>
                <Select
                  ref={hourRef}
                  id={hourId}
                  className="w-28"
                  value={String(staged ?? hour)}
                  disabled={busy}
                  onChange={(event): void => {
                    const chosen = Number(event.target.value);
                    setStaged(chosen === hour ? null : chosen);
                  }}
                >
                  {HOURS.map((value) => (
                    <option key={value} value={value}>
                      {hourLabel(value)}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-8"
                  disabled={busy || staged === null}
                  aria-busy={busy}
                  onClick={(): void => {
                    if (staged === null) return;
                    setRefocusHour(true);
                    void save(staged);
                  }}
                >
                  {t('digest.saveHour')}
                </Button>
              </div>
            ) : null}
          </div>
          <p id={hintId} className="text-xs text-muted-foreground">
            {t('digest.hint')}
          </p>
        </>
      )}
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {notice}
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );

  return { trigger, panel };
}
