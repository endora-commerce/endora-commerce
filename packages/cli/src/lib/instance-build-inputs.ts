/**
 * The per-instance build inputs — the four values that genuinely vary between
 * one deployment of this platform and another, and that nothing derives
 * (`specs/110-instance-repository/` FR-009).
 *
 * ## Why this file exists
 *
 * They are an **instance's**, not our pipeline's. Under D-207 a client's
 * repository depends on the platform, the admin shell and the module packages
 * and holds a copy of none of them, so everything a build needs is either
 * derived by the platform or is one of these; and `spec.md` §5 is the argument
 * that there is no fifth — five of `endora.config.ts`'s six fields restate a
 * fact something already derives, which is D-100 at the scale of a whole file
 * in a tree we cannot grep.
 *
 * Before this declaration existed, the set was written in three places in
 * `.gitlab-ci.yml` and nowhere else: a comment block listing the CI/CD
 * variables an operator must set, and two `docker build` invocations spelling
 * the mapping from an input to the build argument each image reads. Nothing
 * reconciled the three, nothing could tell a client which values they owe, and
 * **`DEPLOYMENT` reached no build at all** — the one input whose absence is
 * silent, because `selectedDeployment` reads a blank value as *bare core* and a
 * deployment whose overlay modules simply did not compose looks exactly like a
 * deployment that has none.
 *
 * ## What is here, and what is deliberately not
 *
 * Each input carries its **meaning**, an **example**, and its **default** —
 * `null` where the instance must supply one, because a value the tool invented
 * is a value nobody reviewed (`cli-product.md` R2.5). Each also carries its
 * consumers: which build reads it, under which name, and how the value is
 * spelled.
 *
 * The spelling is a **shell expansion** over the input names (`https://${API_DOMAIN}`)
 * for one reason: it is the form a pipeline can paste verbatim and the form a
 * renderer can substitute into, so the mapping has one home rather than one per
 * consumer. Nothing here knows what a GitLab job is; `.gitlab-ci.yml` reads
 * this list, `endora new instance` will render an `.env` and a pipeline from it
 * (T132), and `backend/test/unit/ci/instance-build-inputs.test.ts` is what
 * refuses a third spelling.
 */

/** Which build reads an input. The storefront is scaffolded separately (D-195). */
export type BuildTarget = 'backend' | 'admin' | 'storefront';

/** One build's use of one input. */
export interface BuildInputConsumer {
  readonly target: BuildTarget;
  /** The `ARG` the image declares, and the `--build-arg` a pipeline passes. */
  readonly buildArg: string;
  /**
   * The value, written as a shell expansion over the input names.
   *
   * `${API_DOMAIN}` rather than `$API_DOMAIN`: both expand, and the braced form
   * is the one that cannot silently swallow a following character.
   */
  readonly value: string;
}

/** One per-instance build input. */
export interface InstanceBuildInput {
  /** The environment variable an operator sets, and the name a value expands to. */
  readonly name: string;
  /** What it decides. One sentence, for a client's developer reading it first. */
  readonly meaning: string;
  readonly example: string;
  /**
   * The value used when the instance sets none, or `null` when it must set one.
   *
   * A `null` default is not an omission: it says the platform has no honest
   * answer, and the refusal belongs to whatever reads it.
   */
  readonly default: string | null;
  readonly consumers: readonly BuildInputConsumer[];
}

/**
 * The four, in the order a client meets them.
 *
 * `DEPLOYMENT` first because it is the one an instance always has — it names
 * the client's own deployment directory, where their overlay modules and their
 * `divergence.ts` live (Principle XV) — and the three that follow are what the
 * two frontend builds inline into their bundles.
 */
export const INSTANCE_BUILD_INPUTS: readonly InstanceBuildInput[] = [
  {
    name: 'DEPLOYMENT',
    meaning:
      "The deployment whose overlay modules and divergence declaration this build composes. " +
      'Unset, or blank, is bare core: no overlay module is composed and the build behaves ' +
      'byte-for-byte like one with no deployment directory at all.',
    example: 'acme',
    // A platform with no deployment is a real and supported state — it is what
    // `test:backend`'s bare-core shards run — so "none" is a default rather
    // than a missing value.
    default: null,
    consumers: [{ target: 'backend', buildArg: 'DEPLOYMENT', value: '${DEPLOYMENT}' }],
  },
  {
    name: 'API_DOMAIN',
    meaning:
      'The host the instance serves its API from. Both frontends inline it at build time, ' +
      'because a bundle cannot resolve it later.',
    example: 'api.example.com',
    default: null,
    consumers: [
      { target: 'admin', buildArg: 'VITE_API_BASE_URL', value: 'https://${API_DOMAIN}' },
      {
        target: 'storefront',
        buildArg: 'NEXT_PUBLIC_API_BASE_URL',
        value: 'https://${API_DOMAIN}',
      },
    ],
  },
  {
    name: 'SALES_CHANNEL_CODE',
    meaning:
      'The sales channel the storefront resolves its content against (Principle XII). One ' +
      'always exists — the install creates it — so this names which, never whether.',
    example: 'pl_default',
    default: null,
    consumers: [
      {
        target: 'storefront',
        buildArg: 'NEXT_PUBLIC_SALES_CHANNEL_CODE',
        value: '${SALES_CHANNEL_CODE}',
      },
    ],
  },
  {
    name: 'DEFAULT_LOCALE',
    meaning:
      "The locale the storefront renders when the reader asks for none. A message missing " +
      'from it falls back to English, which is the platform default every module ships.',
    example: 'en-US',
    default: 'en-US',
    consumers: [
      {
        target: 'storefront',
        buildArg: 'NEXT_PUBLIC_DEFAULT_LOCALE',
        value: '${DEFAULT_LOCALE}',
      },
    ],
  },
];

/** Every consumer of one build target, in declaration order. */
export function buildInputsFor(
  target: BuildTarget,
  inputs: readonly InstanceBuildInput[] = INSTANCE_BUILD_INPUTS,
): readonly { readonly input: InstanceBuildInput; readonly consumer: BuildInputConsumer }[] {
  return inputs.flatMap((input) =>
    input.consumers
      .filter((consumer) => consumer.target === target)
      .map((consumer) => ({ input, consumer })),
  );
}

/**
 * The `--build-arg` flags one image build takes, one per line.
 *
 * Emitted rather than written down, so a pipeline — ours or a client's — passes
 * what the declaration says and cannot come to pass a fourth spelling of it.
 *
 * A default is applied **here**, as POSIX's own `${NAME:-value}` expansion,
 * rather than being repeated inside every template that mentions the input:
 * the default has one home, and a reader of the emitted flag can see it.
 */
export function buildArgFlags(
  target: BuildTarget,
  inputs: readonly InstanceBuildInput[] = INSTANCE_BUILD_INPUTS,
): readonly string[] {
  const defaults = new Map(
    inputs
      .filter((input) => input.default !== null)
      .map((input) => [`\${${input.name}}`, `\${${input.name}:-${input.default!}}`]),
  );
  return buildInputsFor(target, inputs).map(({ consumer }) => {
    let value = consumer.value;
    for (const [plain, withDefault] of defaults) value = value.split(plain).join(withDefault);
    return `--build-arg ${consumer.buildArg}="${value}"`;
  });
}
