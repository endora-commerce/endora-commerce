/**
 * The environment-input declaration — what a running Endora needs, said once.
 *
 * Normative: `specs/117-instance-bring-up/contracts/environment-inputs.md`
 * §1–§2, FR-001 and FR-005.
 *
 * ## Why the shape lives here
 *
 * Three programs read a declaration and none of them may author a second copy
 * of it (D-100): `endora new instance` and `endora new storefront` (which
 * values to resolve and write), `endora doctor` (which values to require and
 * what their absence costs), and the reconciliation check. Four *authors*
 * write one — the platform, each application, and every module in its own
 * manifest — so the shape is a contract before it is anybody's data, which is
 * what `packages/contracts` is for.
 *
 * ## `describes` carries both languages inline, and that is a decision
 *
 * §R1.1 puts this prose in the translation boundary's case 1 — the reader's
 * language is resolvable when the sentence is composed — and says a module's
 * ships in its own bundle. **A bundle is not reachable here.** The first
 * reader is a CLI on a client's machine: it loads no `_i18n` reconciler, has
 * no settings store to ask, and the *platform's* inputs have no owning
 * module whose bundle they could sit in. So the sentence ships as `{ en, pl }`
 * on the declaration itself, which satisfies the owner's translation policy
 * (English by default, a Polish bundle beside it, English as the fallback)
 * with the one mechanism a standalone program can read. The check holds both
 * languages to a non-empty sentence, so a single-language declaration is a
 * finding rather than a silent English-only input.
 *
 * ## There is deliberately no `default` field
 *
 * §R1.3. A declaration that could carry a default would become the seventieth
 * home of an invented value, blessed by a contract — which is the exact thing
 * the provenance line's `defaulted=0` exists to make impossible. The absence
 * is load-bearing, not an omission.
 *
 * ## `consumers` scopes `requirement`; it does not merely describe it
 *
 * `specs/118-instance-member-selection/` establishes that an instance may
 * deliberately omit a member — today its admin, while
 * `@endora-commerce/admin-shell` does not exist
 * (`specs/110-instance-repository/contracts/instance-tree.md` §2.4). An input
 * no written member reads is not "required and missing"; it is **not in this
 * run's population at all**, which is what keeps the provenance line to four
 * outcomes instead of five.
 *
 * **Scope by declared consumer, never by name.** Measured on this tree, the
 * name-based rule is wrong on two of the three inputs that mention the admin:
 *
 *   * `VITE_API_BASE_URL` — read by `admin/src` alone. Dropped with the
 *     member.
 *   * `ADMIN_BASE_URL` — read by the **backend** (`mfa`, when it composes the
 *     links it mails). Its *value* names the admin; its consumer is the
 *     backend, and it matters **more** when the admin is on another host.
 *   * `CORS_ALLOWED_ORIGINS` — read by the backend
 *     (`packages/platform/src/http/server.ts`), and its value has to name the
 *     admin's origin for the admin to work at all.
 *
 * Two of those three would be dropped by any rule keyed on the spelling.
 */
import { z } from 'zod';

/**
 * The trees that read an environment value.
 *
 * A value read by more than one is a value those trees must **agree** about,
 * and under D-195 and D-207 two of the three are the client's own
 * repositories — so the agreement cannot be checked from inside any one of
 * them. That is `environment-inputs.md` §5's subject and the derivation is
 * this field, never a table (R5.1, R5.4).
 */
export const ENVIRONMENT_CONSUMERS = ['backend', 'admin', 'storefront'] as const;

export const EnvironmentConsumerSchema = z.enum(ENVIRONMENT_CONSUMERS);
export type EnvironmentConsumer = z.infer<typeof EnvironmentConsumerSchema>;

/**
 * A sentence in every language the platform ships, on the declaration itself.
 *
 * See the header for why this is not a bundle key. Both members are required:
 * "ships `en` and `pl`" enforced by the type rather than by anybody
 * remembering, in the idiom the storefront's own `Record<MessageKey, string>`
 * uses.
 */
export const LocalizedSentenceSchema = z.object({
  en: z.string().min(1),
  pl: z.string().min(1),
});
export type LocalizedSentence = z.infer<typeof LocalizedSentenceSchema>;

/**
 * Required, conditionally required, or optional — and the middle term is the
 * one that matters (§R1.2).
 *
 * `requiredWhen` is a predicate over **another input**: `MEILISEARCH_URL` is
 * required iff `CATALOG_SEARCH_BACKEND=meilisearch`, and without the predicate
 * a doctor would demand a service two thirds of deployments do not run.
 *
 * `optional` carries **what is lost**, never the word "optional". An operator
 * deciding whether to set `SETTINGS_SECRET_ENCRYPTION_KEY` needs to read
 * *"secret settings cannot be read or written"*, which is the fact; that the
 * boot survives without it is not.
 */
export const EnvironmentRequirementSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('required') }),
  z.object({
    kind: z.literal('requiredWhen'),
    /** The input the condition reads. Held to a declared name by the check. */
    input: z.string().min(1),
    /** The value of that input which makes this one required. */
    equals: z.string().min(1),
  }),
  z.object({
    kind: z.literal('optional'),
    /** What the platform loses without it, in the operator's terms. */
    without: LocalizedSentenceSchema,
  }),
]);
export type EnvironmentRequirement = z.infer<typeof EnvironmentRequirementSchema>;

/**
 * Who declares the input, which is what `foreign-input` is asked against.
 *
 * A module declaring an input another module owns is two answers to one
 * question waiting to disagree, so ownership is a field rather than an
 * inference from where the file sits.
 */
export const EnvironmentInputOwnerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('platform') }),
  z.object({ kind: z.literal('application'), application: EnvironmentConsumerSchema }),
  z.object({ kind: z.literal('module'), moduleId: z.string().min(1) }),
]);
export type EnvironmentInputOwner = z.infer<typeof EnvironmentInputOwnerSchema>;

/** One entry per environment variable a running platform reads (§1). */
export const EnvironmentInputSchema = z.object({
  /** The variable, verbatim. */
  name: z.string().min(1),
  /** One sentence: what it configures, in the operator's terms, not the code's. */
  describes: LocalizedSentenceSchema,
  requirement: EnvironmentRequirementSchema,
  /** Whether the value must not be printed, logged or committed. */
  secret: z.boolean(),
  /**
   * Whether a command may generate it (`input-resolution.md` §4).
   *
   * Permitted only where `secret` **and** where two correct values are
   * interchangeable — the check refuses `generable` on a non-secret as
   * `generable-without-secret`, and R4.5's judgement test (a URL, a name, a
   * channel code, a hostname are never generable) is the author's.
   */
  generable: z.boolean(),
  owner: EnvironmentInputOwnerSchema,
  /** Which trees read it. Non-empty: an input nothing reads is a finding. */
  consumers: z.array(EnvironmentConsumerSchema).min(1),
});
export type EnvironmentInput = z.infer<typeof EnvironmentInputSchema>;

/** A whole declaration, as an application or the platform publishes it. */
export const EnvironmentInputsSchema = z.array(EnvironmentInputSchema);

/**
 * Is this input in the population of a run that writes exactly these members?
 *
 * The `specs/118-instance-member-selection/` scoping, as one predicate. An
 * input whose declared consumers are all outside the written set is **out of
 * the population**: not resolved, not prompted for, not counted, not refused.
 *
 * Reading it the other way — "required, and therefore missing" — is what would
 * force a fifth provenance outcome, because such an input can be neither
 * `defaulted` (there is nothing to invent) nor honestly reported as resolved.
 */
export function isReadByAnyOf(
  input: EnvironmentInput,
  members: readonly EnvironmentConsumer[],
): boolean {
  return input.consumers.some((consumer) => members.includes(consumer));
}

/**
 * The declared inputs a run over these members actually has to answer for.
 *
 * Order is the declaration's, which is the order a prompt asks in
 * (`input-resolution.md` §1: "in the declared order"). Sorting here would put
 * the sequence in a comparator rather than in the hands of whoever wrote the
 * declaration, and the first thing an operator is asked would then depend on
 * an alphabet.
 */
export function scopeToMembers(
  inputs: readonly EnvironmentInput[],
  members: readonly EnvironmentConsumer[],
): readonly EnvironmentInput[] {
  return inputs.filter((input) => isReadByAnyOf(input, members));
}

/**
 * Is this input required, given what the rest of the environment holds?
 *
 * `requiredWhen` is resolved against the **resolved** values rather than
 * against `process.env`, so a condition can be answered by a flag the operator
 * has just supplied — which is the case that happens: a run that sets
 * `CATALOG_SEARCH_BACKEND=meilisearch` on its command line must be asked for
 * `MEILISEARCH_URL` in the same run, not in the next one.
 */
export function isRequiredGiven(
  input: EnvironmentInput,
  values: Readonly<Record<string, string | undefined>>,
): boolean {
  switch (input.requirement.kind) {
    case 'required':
      return true;
    case 'requiredWhen':
      return values[input.requirement.input] === input.requirement.equals;
    case 'optional':
      return false;
  }
}
