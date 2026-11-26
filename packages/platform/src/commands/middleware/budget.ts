/**
 * Running one middleware call within its time budget
 * (`specs/189-command-middleware/` FR-013, FR-021, research R-8).
 *
 * The call is raced against a timer, and an `AbortController` fires when the
 * timer wins, so a well-behaved handler can stop its own I/O — a promise
 * cannot be cancelled otherwise. A handler that returns synchronously settles
 * without a timer ever being armed, which keeps the common, synchronous
 * `admit` cheap (SC-003).
 */

export type BudgetResult = { readonly status: 'settled' } | { readonly status: 'threw'; readonly error: unknown } | { readonly status: 'timeout' };

const SETTLED: BudgetResult = Object.freeze({ status: 'settled' });
const TIMEOUT: BudgetResult = Object.freeze({ status: 'timeout' });

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function';
}

/** Runs `fn` and answers how it ended; never throws. Synchronous when `fn` is. */
export function withinBudget(
  fn: (signal: AbortSignal) => unknown,
  timeoutMs: number,
): BudgetResult | Promise<BudgetResult> {
  const controller = new AbortController();
  let returned: unknown;
  try {
    returned = fn(controller.signal);
  } catch (error) {
    return { status: 'threw', error };
  }
  if (!isThenable(returned)) return SETTLED;
  return new Promise<BudgetResult>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      controller.abort();
      resolve(TIMEOUT);
    }, timeoutMs);
    Promise.resolve(returned).then(
      () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(SETTLED);
      },
      (error: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ status: 'threw', error });
      },
    );
  });
}
