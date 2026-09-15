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
};

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
