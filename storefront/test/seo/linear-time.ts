/**
 * Whether a function's cost grows no faster than its input, measured so that
 * the host's speed cancels out (issue #612).
 *
 * A wall-clock budget — "this took less than 250 ms" — measures the machine as
 * much as the code: on a loaded host it fails although nothing changed. What
 * the tests that use this guard is the *shape* of the cost: a pattern that
 * re-scans a run of characters from each of its positions is quadratic, and
 * that is a request the storefront answers nobody during.
 *
 * So the function is timed, in the same run, once on an input {@link GROWTH}
 * times longer than a small one, against {@link GROWTH} calls on the small one.
 * Linear code does the same work on both sides, so the ratio is about 1 however
 * busy the host is — a per-call overhead only lowers it. A quadratic path makes
 * it about {@link GROWTH}, and anything worse far more. Each side is the fastest
 * of {@link SAMPLES} timings after a warm-up, so a pause that lands on one
 * sample is not counted, and every call gets an input of its own, so a cache
 * keyed on the input cannot answer for the code.
 */

/** How much longer the large input is than the small one. */
export const GROWTH = 16;

/**
 * The ratio a linear cost stays under: four times above linear, four times
 * below what a quadratic path gives.
 */
export const LINEAR_BOUND = 4;

/** Timings per side; the fastest is the one compared. */
const SAMPLES = 5;

/**
 * The time `run` takes on an input of `length`, over the time it takes on
 * {@link GROWTH} inputs of `length / GROWTH`. `input` builds a fresh input of
 * about the length it is given; it is called outside the timed region.
 */
export async function growthRatio<T>(
  run: (input: T) => unknown,
  input: (length: number) => T,
  length: number,
): Promise<number> {
  const small = Math.ceil(length / GROWTH);
  const fastest = async (inputs: () => T[]): Promise<number> => {
    let best = Number.POSITIVE_INFINITY;
    // One more round than counted: the first warms the code up.
    for (let sample = 0; sample <= SAMPLES; sample += 1) {
      const batch = inputs();
      const start = performance.now();
      for (const value of batch) await run(value);
      const elapsed = performance.now() - start;
      if (sample > 0) best = Math.min(best, elapsed);
    }
    return best;
  };
  const once = await fastest(() => [input(length)]);
  const many = await fastest(() => Array.from({ length: GROWTH }, () => input(small)));
  return once / many;
}
