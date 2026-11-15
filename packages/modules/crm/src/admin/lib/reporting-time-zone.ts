import { createContext, useContext, useMemo } from 'react';
import type { AnalyticsAnswer } from '../analytics-api.js';

/**
 * Where an analytics figure tells the screen which time zone the server
 * counted its days in (issue #475). The screen provides it; each figure
 * reports the zone its answer names. Outside a screen it is a no-op.
 */
export const ReportingTimeZoneContext = createContext<(timeZone: string) => void>(() => undefined);

/**
 * A figure's read, unwrapped to its data for `useFigure`, with the zone its
 * answer names reported to the screen on the way. An answer without one — a
 * server older than the field — reports nothing.
 */
export function useReportedTimeZone<T>(
  load: (() => Promise<AnalyticsAnswer<T>>) | null,
): (() => Promise<T>) | null {
  const report = useContext(ReportingTimeZoneContext);
  return useMemo(
    () =>
      load
        ? async (): Promise<T> => {
            const answer = await load();
            if (answer.timeZone) report(answer.timeZone);
            return answer.data;
          }
        : null,
    [load, report],
  );
}
