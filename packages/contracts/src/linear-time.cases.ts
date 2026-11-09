/**
 * Whether a function's cost grows no faster than its input — the **one**
 * implementation of the linear-time protocol (issues #612, #250, #953).
 *
 * Imported by the tests that guard a cost's shape: the contracts tests beside
 * this file, `@endora-commerce/mod-crm`'s `reference-tokens.test.ts` and the
 * storefront's `test/seo/` tests. It is a `*.cases.ts` file so this package's
 * `tsconfig.build.json` keeps it out of `dist`: it is reached through the
 * source path and never published.
 *
 * One copy remains, in `@endora-commerce/mod-seo`'s `preview-model.test.ts`
 * (#951, where this protocol was first written): that test is type-checked by
 * the module's admin program, whose `rootDir` is the module's own `src`, so it
 * cannot name a file of another package. Change the two together.
 *
 * **Why not a clock budget (#612).** "This took less than 250 ms" measures the
 * machine as much as the code, and on a loaded host it fails although nothing
 * changed. What these tests guard is the *shape* of the cost: a pattern that
 * re-scans a run of characters from each of its positions is quadratic.
 *
 * So `run` is timed once on an input of `length` against {@link GROWTH} calls on
 * inputs {@link GROWTH} times shorter, every call on an input of its own built
 * outside the timed region, so a cache keyed on the input cannot answer for the
 * code. Linear code does the same work on both sides, so the ratio is about 1 —
 * a per-call overhead only lowers it; a quadratic path makes it grow with
 * {@link GROWTH}.
 *
 * **Why CPU time, warm-up and turns (#250).** Under load the wall clock also
 * counts the time the scheduler gave to other processes, and a timing of a
 * millisecond or two can absorb a whole time slice: on a loaded CI runner a
 * linear function read `16× the text, 6.05× the time`. So the process's own CPU
 * time is measured ({@link cpuNow}); both sides are warmed up before anything is
 * kept, so neither is timed before the compiler has reached it; and
 * {@link SAMPLES} timings per side are taken in turns, of which the fastest is
 * kept, so a pause lands on both sides or on neither.
 */

/** How much longer the large input is than each small one. */
export const GROWTH = 64;

/**
 * The ratio a linear cost stays under. Measured for #250 on 2026-11-08 under
 * load (40 cold runs, half pinned to one core shared with three busy processes,
 * half beside 32 busy processes at load ~55): 0.36-1.41 for a linear function,
 * 9.48-19.65 with the #612 quadratic planted in its place — about 2.5 times
 * clear of each.
 */
export const LINEAR_BOUND = 4;

/** Timings per side, after the warm-up; the fastest is the one compared. */
const SAMPLES = 15;
/** Untimed rounds per side before the first kept sample. */
const WARM_UP = 3;

/**
 * The CPU time this process has spent, in milliseconds — not the wall clock.
 * The process's own CPU time does not advance while it is not scheduled, so
 * what it measures is the work.
 *
 * Every importer runs under Node, while several are type-checked in programs
 * that carry no Node types (this package's, an admin bundle's), so the one
 * call needed is declared here rather than pulling `@types/node` into them.
 */
function cpuNow(): number {
  const { process } = globalThis as unknown as {
    readonly process: { cpuUsage(): { readonly user: number; readonly system: number } };
  };
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * The CPU time `run` takes on an input of `length`, over the time it takes on
 * {@link GROWTH} inputs of `length / GROWTH`. `input` builds a fresh input of
 * about the length it is given; it is called outside the timed region.
 *
 * `run` may be synchronous or return a promise; a promise is awaited inside the
 * timed region, and a plain value is not, so a synchronous function pays no
 * per-call scheduling cost.
 */
export async function growthRatio<T>(
  run: (input: T) => unknown,
  input: (length: number) => T,
  length: number,
): Promise<number> {
  const timed = async (batch: readonly T[]): Promise<number> => {
    const start = cpuNow();
    for (const value of batch) {
      const result = run(value);
      if (isThenable(result)) await result;
    }
    return cpuNow() - start;
  };
  const one = (): T[] => [input(length)];
  const many = (): T[] => Array.from({ length: GROWTH }, () => input(Math.ceil(length / GROWTH)));
  for (let round = 0; round < WARM_UP; round += 1) {
    await timed(one());
    await timed(many());
  }
  let fastestOne = Number.POSITIVE_INFINITY;
  let fastestMany = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const longer = one();
    const shorter = many();
    fastestOne = Math.min(fastestOne, await timed(longer));
    fastestMany = Math.min(fastestMany, await timed(shorter));
  }
  return fastestOne / fastestMany;
}
