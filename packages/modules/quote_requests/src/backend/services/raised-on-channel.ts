import { currentSalesChannel } from '@endora-commerce/platform/kernel';

/**
 * The sales channel a quote request is being raised on (issue #266).
 *
 * **Read, never resolved.** The kernel's resolver middleware runs once as an
 * `onRequest` hook on every `/api/v1/*` path and puts the answer on the request
 * scope; this reads that slot. There is no header re-parse, no `sales_channels`
 * query and no second call to the resolver here — MR !775 removed four such
 * re-resolutions and this is not the fifth (feature 053 / FR-011, Principle
 * XII).
 *
 * **`null` is a real answer and the only shape "no channel" is allowed to
 * take.** On a storefront request it cannot happen: step 4 of the resolver
 * falls back to the system-default channel, which always exists. It happens
 * where there is no request scope at all — a CLI entry point, a BullMQ worker,
 * a test or fixture calling the service directly — and there `null` is the
 * truth. It is not filled in with the system default, because that would make
 * a request nobody raised on a channel indistinguishable from one that was,
 * and the FR-006 delete guard would then refuse a channel on evidence the
 * platform made up. An empty string, the nil uuid and `randomUUID()` are the
 * other three spellings of this, and all three are defects (D-47…D-51).
 */
export function raisedOnChannelId(): string | null {
  return currentSalesChannel()?.id ?? null;
}
