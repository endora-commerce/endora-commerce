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
 * deliberately omit a member — its admin being the ruled case (D-215). That
 * member is absent when the operator declines it, or when
 * `@endora-commerce/admin-shell` does not **resolve** at the version being
 * installed (`specs/110-instance-repository/contracts/instance-tree.md` §2.4).
 * This comment read *"while `@endora-commerce/admin-shell` does not exist"*
 * until 2026-09-13, by which time `packages/admin-shell` did — a premise about
 * the tree, written into a source file where nothing re-derives it. An input
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
  /**
   * Which member of an instance this value is the **address of**, or `null`.
   *
   * Two programs ask *"which of these variables names the backend"* — `endora
   * new storefront`, whose next step tells an author to point them at their
   * backend, and the scaffold acceptance criterion, which points them at the
   * backend it booted. Both used to answer it from the **shape of the value**
   * in `.env.example`: *an absolute `http(s)` URL*. That predicate is only ever
   * accidentally right. It cannot tell the backend's address from the
   * storefront's own, from a CDN's or from an object store's, so the first
   * URL-valued variable that is not a backend joins the set silently — and the
   * next step then tells a client, in a file they own outright, that a variable
   * "names the backend this storefront talks to" when it does not. A confident
   * wrong sentence is worse than the silence it replaces.
   *
   * So it is declared rather than inferred, and the field is **required**: an
   * author must answer it, and `EnvironmentInputSchema` refuses a declaration
   * that does not — at `loadTreeDeclaration`, at `check:env-inputs`' fourth
   * refusal, and in every other reader. An optional field would be forgotten
   * exactly once, by the author of the next backend address, and nothing would
   * say so.
   *
   * `null` is an answer and not an absence: this value is not the address of a
   * member of this instance. A third party's address is `null` — `DATABASE_URL`
   * and `REDIS_URL` are addresses, of a database and a cache, and neither is a
   * member — because the question the two consumers ask is which of an
   * *instance's own* parts a value points at. A list of origins is `null` too:
   * `CORS_ALLOWED_ORIGINS` names several, and "the address of" is singular.
   */
  addressOf: EnvironmentConsumerSchema.nullable(),
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
 * Several authors' declarations, as the one population a reader has to answer.
 *
 * The four authors of `EnvironmentInput` are the platform, each application and
 * every module in its own manifest, and nothing joins them: a scaffolded
 * instance reads the platform's declaration **and** the manifest of every module
 * it installed, and a doctor run against that instance reads the same pair. Two
 * programs computing that join separately is two answers waiting to disagree,
 * which is why the join is here rather than in either of them.
 *
 * **First author wins, and order is the first declaration's.** A name that
 * migrates between authors is the case that happens — feature 121 moved
 * `MEILISEARCH_URL` out of a module and into the platform, and a module may not
 * describe a name the platform declares — so during such a move the platform's
 * sentence is the one an operator reads, and the module's stale copy is shadowed
 * rather than duplicated. Callers therefore pass the platform's declaration
 * first. Across authors a shared name is expected and is **not** a finding;
 * `check:env-inputs` says so, and this function is that rule's consequence
 * rather than a second opinion about it.
 */
export function unionEnvironmentInputs(
  declarations: readonly (readonly EnvironmentInput[])[],
): readonly EnvironmentInput[] {
  const merged = new Map<string, EnvironmentInput>();
  for (const declaration of declarations) {
    for (const input of declaration) {
      if (!merged.has(input.name)) merged.set(input.name, input);
    }
  }
  return [...merged.values()];
}

/**
 * The variables whose value is the address of `member`, in declaration order.
 *
 * One derivation, because the two programs that ask are `endora new storefront`
 * — telling an author which variables to point at their backend — and the
 * acceptance criterion, which points those same variables at the backend it
 * booted. Deriving it twice is two answers waiting to disagree, and that is not
 * hypothetical: the criterion once configured `PUBLIC_API_BASE_URL`, a name no
 * file in the storefront reads, and its boot assertion measured the compiled-in
 * fallback for a whole investigation.
 *
 * The population is the declaration handed in, so it is the **copy's** answer
 * about the copy — under D-195 a client's storefront is theirs, declaring what
 * it reads — and never a list compiled into either program.
 */
export function addressVariablesFor(
  inputs: readonly EnvironmentInput[],
  member: EnvironmentConsumer,
): readonly string[] {
  return inputs.filter((input) => input.addressOf === member).map((input) => input.name);
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
