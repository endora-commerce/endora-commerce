/**
 * The secrets a test run may not take from the machine it runs on.
 *
 * ## The population is derived, and it used to be written down
 *
 * `global-setup.ts` pinned **a hand-written list of two**, described in its own
 * words as *"the two ciphers that refuse to construct without one"*. The
 * platform already **declares** that population — `secret && generable` over
 * `PLATFORM_ENVIRONMENT_INPUTS` and every registered module's `env` — and
 * `@endora-commerce/cli`'s `planResolution` derives the identical set to decide
 * what `endora new instance` generates into a scaffolded `.env`
 * (`inputs/resolve.ts`: `if (input.generable && input.secret)`). One
 * declaration, two derivations and a third statement kept in step by hand is
 * D-100's shape, and the list was already wrong: the declared population is
 * **five** and the list named two. `NEWSLETTER_TOKEN_SECRET` was one of the
 * three it did not name, and it was found by a boot — `composeApp` reads
 * `NEWSLETTER_TOKEN_SECRET ?? SESSION_COOKIE_SECRET ?? ''` and
 * `NewsletterTokenHelper` refuses the empty string — rather than by the list.
 *
 * So the list is gone. What is left is a **disposition** per member, which is a
 * different fact and a much smaller one.
 *
 * ## Withheld by default, pinned by exception
 *
 * Each derived member is one of two things, and never a third:
 *
 *   - **pinned** — the harness assigns its own deterministic value,
 *     *unconditionally*, overwriting whatever the ambient environment carried.
 *     Two entries, both ciphers that throw in their constructor.
 *   - **withheld** — the harness `delete`s it, so the run meets the state a
 *     fresh clone and every continuous-integration job meets.
 *
 * Withheld is the default because the default is what a new declaration gets,
 * and the safe answer for a value nobody has thought about is the one the
 * target has. A test that needs it then fails on the author's machine in the
 * same second it fails in the job, which is the entire point; the remedy is an
 * entry below with a reason, not an ambient export.
 *
 * **Unconditional is the load-bearing word in "pinned".** The two entries were
 * previously applied behind `if (!process.env[name])`, which is precisely the
 * hole: a developer whose shell exported `ASSETS_LIBRARY_HMAC_KEY` ran the
 * suite against *their* key and nobody else's, and a signature fixture that
 * depended on it would have been green for them alone.
 *
 * ## What this cannot see
 *
 * A module package's own vitest run has no `globalSetup` of this kind, so the
 * dispositions below govern the backend suite and not
 * `packages/modules/<id>`'s co-located tests. Stated rather than discovered:
 * the failure class is the same one and the seam is not shared yet.
 */

import type { EnvironmentInput } from '@endora-commerce/contracts';

/** A derived member of the population, with the declaration that produced it. */
export interface GenerableSecret {
  readonly name: string;
  /** `platform`, or the module id whose manifest declares it. */
  readonly declaredBy: string;
}

/** What the harness does with one member. */
export type SecretDisposition = 'pinned' | 'withheld';

export interface PinnedSecret {
  /** The deterministic value, identical on every machine and every run. */
  readonly value: string;
  /** Why this one may not simply be withheld like the rest. */
  readonly reason: string;
}

/**
 * The exceptions. Everything the derivation produces and this record does not
 * name is withheld.
 *
 * `test/unit/harness/generable-secrets.test.ts` holds this honest in both
 * directions: an entry naming an input the declarations no longer produce fails,
 * and the value's shape is checked against what the consumer decodes.
 */
export const PINNED_GENERABLE_SECRETS: Readonly<Record<string, PinnedSecret>> = {
  // Feature 013 — the Assets Library's HMAC signer demands an env key.
  // `HmacSigner.fromEnv()` throws without one, and it is constructed during
  // module composition, so withholding this would take every asset route with
  // it. Hex, 32 bytes, because that is the spelling this key has had since the
  // module shipped and signatures computed from it appear in fixtures.
  ASSETS_LIBRARY_HMAC_KEY: {
    value: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    reason:
      "`HmacSigner.fromEnv()` throws on an unset key and runs during the module's " +
      'composition, so an absent value is not a degraded asset route — it is no ' +
      'composition at all.',
  },
  // Feature 042 — the MFA module's SecretCipher needs a base64 32-byte AES key
  // to encrypt TOTP secrets; enrolment refuses without one, and the refusal is
  // a behaviour several cases assert *around* rather than assert.
  MFA_SECRET_ENCRYPTION_KEY: {
    value: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    reason:
      'The TOTP secret cipher decodes this as a 32-byte AES key and enrolment ' +
      'refuses without it, so the whole second-factor surface would test only its ' +
      'own refusal.',
  },
  // Feature 004 / 058 — the settings secret codec is the third cipher that
  // throws in its constructor, and it was withheld while 151 test files needed
  // it, so each of them assigned its own. The note below is what that cost.
  //
  // Base64, 32 bytes, because `secret-value-codec.ts` decodes it that way and
  // refuses any other length.
  SETTINGS_SECRET_ENCRYPTION_KEY: {
    value: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
    reason:
      'The settings secret codec decodes this as a 32-byte AES key and throws ' +
      'without it, and `composeApp` reads it from the environment while composing, ' +
      'so an absent value is not a degraded secret setting — it is a composition ' +
      'that cannot process one, taking every credential and secret-typed setting ' +
      'with it.',
  },
};

/**
 * Why the third entry is a pin and not 151 restores — and why the fast suite
 * could never have told you.
 *
 * This key was withheld, and 151 test files set it themselves. Withholding is a
 * `delete`, so a file using the preserving idiom
 * `process.env[K] = process.env[K] ?? randomBytes(32).toString('base64')` always
 * fell through to the random branch: the **first** of those files to run in a
 * shard's single fork injected a value that then stood for every file after it
 * in that fork, and `test/unit/harness/generable-secrets.test.ts` — the
 * instrument that asserts this population is the harness's and not the machine's
 * — reported it whenever it happened to run after one of them. That is the same
 * defect as the `settings.global_value` reset in `helpers/test-server.ts`: state
 * surviving the file that wrote it. A third channel, `process.env`, rather than
 * a third cause.
 *
 * **The 151 is not the useful fact; the split is.** Measured over
 * `backend/test/`, and summed rather than subtracted:
 *
 *   - **112** preserve — the `??` idiom above, a self-assignment once pinned;
 *   - **36** assign `randomBytes(32).toString('base64')` **unconditionally**,
 *     overwriting a pinned value for every later file in the fork;
 *   - **2** capture the ambient value and restore it;
 *   - **1** assigns its own `TEST_KEY`.
 *
 * 112 + 36 + 2 + 1 = 151. Separately, **38** files `delete` the variable in
 * `afterAll` — correct while it was withheld, and fatal to a pinned key. So
 * **74 of the 151 break a pin**, and pinning alone was therefore *not* the whole
 * repair: `test/pinned-secrets-setup.ts` re-asserts the pinned values per test
 * file, which is what makes the entry above hold for every file rather than only
 * until the first of those 74 runs.
 *
 * That correction cost a merge. The claim was that pinning edits none of the 151
 * because the `??` finds the pinned value — true of 112 files, false of 36, and
 * the pair that verified it used a leaker from the 112. A count was decomposed
 * only after the population it described had already refuted it; see
 * `specs/conventions/backend-test-suite.md` § *Proving a cross-file leak*, third
 * way.
 *
 * The reason this key is pinned at all is the one the two entries above already
 * give — a cipher that throws in a hundred files — so it is that rule applied
 * consistently rather than an exception made for one key.
 *
 * The repair that suggested itself first would have broken all 151: re-applying
 * the seam per composition, the exact parallel of the `settings.global_value`
 * reset. `compose-app.ts` reads this key from `process.env` *while composing*
 * (lines 744 and 872) and `secret-value-codec.ts` throws without it, so those
 * assignments are load-bearing rather than vestigial, and deleting the variable
 * per composition would have taken every file that exercises a credential or a
 * secret-typed setting with it.
 *
 * **`test:unit:fast` cannot catch this class, and that is measured rather than
 * argued.** Of the 151 files that set this variable, **37 are contract, 110
 * integration, 4 perf, and zero are under `test/unit`** — so in the fast config
 * nothing sets it, this test passes every time, and it reds only in a run that
 * puts a contract or integration file in the same fork ahead of it. Anyone
 * deciding how far to trust the fast suite should read that number: it is green
 * here because the population that breaks it is not in it.
 */

/**
 * The declared population: every environment input that is both `secret` and
 * `generable`, from the platform's declaration and from every manifest this
 * deployment registers.
 *
 * The predicate is `planResolution`'s, verbatim in meaning — an input with no
 * human judgement in its value, which is exactly the class a harness may supply
 * and a machine may not smuggle in.
 *
 * Read from the built declarations rather than from source text. That is the
 * opposite of `check:env-inputs`' choice and right for the opposite reason: the
 * check judges the tree an author is editing, this governs the environment of
 * the code the run *executes*, which is the same `dist` the declarations are
 * imported from.
 */
export async function derivedGenerableSecrets(): Promise<readonly GenerableSecret[]> {
  const { PLATFORM_ENVIRONMENT_INPUTS } = await import('@endora-commerce/platform/env');
  const { REGISTERED_MANIFESTS } = await import('../src/lifecycle/registered-manifests.js');

  const found: GenerableSecret[] = [];
  const isGenerableSecret = (input: EnvironmentInput): boolean => input.secret && input.generable;

  for (const input of PLATFORM_ENVIRONMENT_INPUTS) {
    if (isGenerableSecret(input)) found.push({ name: input.name, declaredBy: 'platform' });
  }
  for (const entry of REGISTERED_MANIFESTS) {
    for (const input of entry.manifest.env ?? []) {
      if (isGenerableSecret(input)) found.push({ name: input.name, declaredBy: entry.manifest.id });
    }
  }
  return found;
}

/** What one invocation decided, in the shape a report and a test both want. */
export interface AppliedSecretEnv {
  readonly pinned: readonly string[];
  readonly withheld: readonly string[];
}

/**
 * Put the whole declared population beyond the machine's reach: assign the
 * pinned values, delete the rest.
 *
 * Called from `global-setup.ts` in the parent process, before the run branches
 * on `BACKEND_TEST_SERVICES` and before any worker forks — a fast unit run that
 * constructs `HmacSigner.fromEnv()` must see the same key the complete run
 * does, and neither may see the developer's.
 */
export async function applyGenerableSecretEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AppliedSecretEnv> {
  const pinned: string[] = [];
  const withheld: string[] = [];
  for (const secret of await derivedGenerableSecrets()) {
    const exception = PINNED_GENERABLE_SECRETS[secret.name];
    if (exception) {
      env[secret.name] = exception.value;
      pinned.push(secret.name);
      continue;
    }
    delete env[secret.name];
    withheld.push(secret.name);
  }
  return { pinned, withheld };
}
