import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * `specs/182-related-payers/` FR-046 — the start of "today" for the daily limit: the latest local
 * midnight in the store's time zone, as an instant.
 */
export function dailyWindowStart(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // The wall clock now, read as if it were UTC, minus now: the zone's offset at this instant.
  const wallAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  const offsetMs = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const localMidnightAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'));
  return new Date(localMidnightAsUtc - offsetMs);
}

/**
 * FR-046 — requests plus invitations the sender's Organization sent today; at the limit the
 * next one is refused `429 RELATED_PAYER_REQUEST_LIMIT`, before the tax ID is looked up.
 */
export function assertWithinDailyLimit(sentToday: number, limit: number): void {
  if (sentToday >= limit) {
    throw new HttpError(
      429,
      ERROR_CODES.RELATED_PAYER_REQUEST_LIMIT,
      'Your organization has sent as many payer requests and invitations as it may today.',
    );
  }
}
