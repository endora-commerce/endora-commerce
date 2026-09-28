/**
 * The `.npmrc` a scaffolded storefront installs through — and the reason the
 * command writes none unless it is asked.
 *
 * ## No `--registry` writes no file, and that is the destination
 *
 * `specs/104-package-publication/contracts/registry-and-scope.md` R3.4: a public
 * consumer installs `@endora-commerce/*` with no `.npmrc` and no token. So the
 * path this command takes **without being told anything** is the public one, and
 * the private registry is the argument. The other way round would make every
 * open-source consumer's first act the deletion of a file naming a host they
 * have no credential for.
 *
 * ## The file holds no secret, and that is enforced rather than trusted
 *
 * The token is written as an environment **reference**, `${ENDORA_NPM_TOKEN}`,
 * which pnpm expands at install time in both the registry and the auth position
 * (measured, `research.md` §5). So the file is committable, and a registry URL
 * carrying its own credentials — `https://user:token@host/…`, the one shape that
 * would put a secret into a client's repository — is a refusal rather than a
 * string this module copies through.
 *
 * ## The scope is derived from what the storefront installs
 *
 * Never a literal: the scopes are read off the reference storefront's own
 * `workspace:` ranges, which are exactly the packages a registry has to answer
 * for. A checkout that grows a second scope gets a second registry line in the
 * same run, and a storefront that declares no scoped workspace dependency is a
 * refusal — an `.npmrc` naming no scope configures nothing.
 *
 * ## A registry does not have to serve its tarballs under its metadata path
 *
 * That premise is what this file held until the acceptance criterion's registry
 * mode was first run. It wrote **one** auth line, keyed on the configured
 * endpoint, on the reasoning that *a credential is a property of the endpoint
 * rather than of a scope*. The second half of that sentence is still true and the
 * first no longer follows from it: the endpoint serves the **packument**, and the
 * `dist.tarball` URL inside that document is the **server's** to choose. GitLab
 * chooses the owning project's path, so an instance- or group-level endpoint
 * answers with a tarball on `/api/v4/projects/<id>/packages/npm/…` — a path whose
 * project id varies per package and is unknowable at the moment this file is
 * written. The endpoint key does not cover it, that one fetch goes out
 * unauthenticated, and GitLab answers an absent credential with **404**, the same
 * sentence it gives for a package that was never published (`research.md` §6). So
 * the install fails with *the package is not there*, immediately after a metadata
 * request for that same package succeeded.
 *
 * `authKeys` below is the repair, and it is where the reasoning for the shape
 * that was chosen — and for the two that were not — is written down.
 */
import { StorefrontInputError, workspaceRanges } from './reference.js';

/**
 * The environment variable the auth line refers to.
 *
 * One name, spelled here and in `.gitlab-ci.yml`'s `publish:packages` job,
 * because it is the name the contract writes (R3) and the one an operator is told
 * to set. It is deliberately not an option: a per-scaffold variable name is a
 * support conversation per client for no capability.
 */
export const TOKEN_VARIABLE = 'ENDORA_NPM_TOKEN';

/**
 * The registry URL as an `.npmrc` line writes it: absolute, `http(s)`, with the
 * trailing slash GitLab's own troubleshooting requires (R3.2).
 */
export function normalizeRegistry(registry: string): string {
  const raw = registry.trim();
  if (raw.length === 0) {
    throw new StorefrontInputError(
      '`--registry` was given no value. It names the endpoint the scaffolded storefront ' +
        'installs `@endora-commerce/*` from; omit the flag entirely to get the public ' +
        'registry, which is what an open-source consumer installs from and what this command ' +
        'does when it is not told otherwise.',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StorefrontInputError(
      `\`--registry ${raw}\` is not an absolute URL. An \`.npmrc\` registry line is a URL and ` +
        `nothing else — npm resolves no relative form — so a value that is not one would be ` +
        `written into the client's file and fail at their install rather than at this command.`,
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new StorefrontInputError(
      `\`--registry ${raw}\` names the "${url.protocol}" scheme. A registry is reached over ` +
        `http or https; anything else is a value npm cannot fetch from.`,
    );
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new StorefrontInputError(
      `\`--registry\` carries credentials in the URL. The \`.npmrc\` this command writes is a ` +
        `file the client commits, and it holds no secret by construction: the token is written ` +
        `as \${${TOKEN_VARIABLE}} and expanded at install time. Give the registry without its ` +
        `userinfo and put the credential in the environment.`,
    );
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new StorefrontInputError(
      `\`--registry ${raw}\` carries a query or a fragment. Neither is part of a registry ` +
        `endpoint, and the auth line is keyed on the host and path, so a value carrying one ` +
        `would authenticate for an address the fetches never use.`,
    );
  }
  const text = url.toString();
  return text.endsWith('/') ? text : `${text}/`;
}

/**
 * The scopes a scaffolded storefront installs from a registry.
 *
 * Read off the reference storefront's `workspace:` ranges — the packages that
 * stop resolving the moment the copy leaves the workspace — rather than off the
 * checkout's members. The two populations are not the same question: what the
 * platform *publishes* is `check:release-intent`'s, and what this storefront
 * *installs* is this one's.
 */
export function installedScopes(manifest: Record<string, unknown>): readonly string[] {
  const scopes = new Set<string>();
  for (const range of workspaceRanges(manifest)) {
    if (!range.name.startsWith('@')) continue;
    const slash = range.name.indexOf('/');
    if (slash > 0) scopes.add(range.name.slice(0, slash));
  }
  return [...scopes].sort();
}

/**
 * The keys the auth lines are written under: the endpoint, and the host it is on.
 *
 * Both are npm's own spelling for a credential — the request URL with its scheme
 * removed — and both matter, for two different fetches.
 *
 * **The endpoint key** is the narrowest key covering the one address the operator
 * actually named, and it is what GitLab's own documentation writes. It is kept
 * rather than replaced by the broader one below: pnpm was measured walking a
 * request path upward — a key on `//host/api/v4/` authenticates a tarball under
 * `/api/v4/projects/…` — so for pnpm the endpoint key is redundant, and a client
 * matching these keys **exactly** would still authenticate the packument with it.
 * No such client was measured here, so the honest reason to keep the line is the
 * smaller one: dropping it would make the file say less than it knows about the
 * one address the operator gave.
 *
 * **The host key** is the one that covers a tarball. It is broad on purpose: the
 * tarball URL is chosen by the server and appears for the first time inside a
 * packument this file will never see, so the only statically derivable key
 * guaranteed to cover it is the whole host. Measured with a local registry
 * standing in for GitLab's shape — a packument served on the endpoint whose
 * `dist.tarball` names `/api/v4/projects/302/packages/npm/…` on the same host —
 * under pnpm 9.15.0, the version CI pins, and under pnpm 10:
 *
 *   endpoint key alone   ERR_PNPM_FETCH_404 … Not Found - 404
 *                        "No authorization header was set for the request."
 *   endpoint + host key  the tarball request carries the header; the install
 *                        completes.
 *
 * ### Why not a narrower prefix
 *
 * Not because a narrower one would fail — measured, `//host/api/v4/` and
 * `//host/api/v4/projects/` both authenticate that same tarball, because pnpm
 * walks a request's path upward looking for a key. The mechanism is not the
 * obstacle; the **derivation** is. Getting `/api/v4/` out of
 * `/api/v4/packages/npm/` means knowing GitLab's URL layout, which is trading one
 * unexamined premise about the server for a narrower one — and `--registry` names
 * *a registry*, not *a GitLab*: the flag is documented as the endpoint the
 * storefront installs from, and a Verdaccio or an Artifactory behind it has its
 * own layout. `ENDORA_NPM_REGISTRY` is masked and may be the instance endpoint or
 * a group one, so the file cannot even be written against one observed shape.
 *
 * ### What is given up, stated rather than glossed
 *
 * The credential is offered to **every** request pnpm makes to this host and
 * port, not only to the endpoint's own subtree. That is broader than the single
 * line this file used to write. It is accepted because the host is the one the
 * operator named on the command line, the credential a client is handed is a
 * deploy token scoped `read_package_registry` (R3.3) whose whole authority on
 * that host is reading packages, and the alternative — the credential not
 * reaching the address the registry itself directed the client to — is an install
 * that cannot work.
 *
 * And what it does **not** cover, so nobody reads it as more than it is: a
 * registry that serves tarballs from a **different host** (a CDN, a storage
 * bucket) is not reached by this key or by any other one derivable here, because
 * that host appears nowhere in the input. Such a registry needs a line naming it,
 * and the symptom would be this same 404 on the tarball alone.
 *
 * A registry configured at the root of its host makes the two keys identical, and
 * then there is one line rather than two: a duplicate would not be wrong, it
 * would read as though it said something.
 */
export function authKeys(registry: string): readonly string[] {
  const endpoint = normalizeRegistry(registry);
  const endpointKey = endpoint.replace(/^https?:/, '');
  const hostKey = `//${new URL(endpoint).host}/`;
  return endpointKey === hostKey ? [endpointKey] : [endpointKey, hostKey];
}

/**
 * The file's text: one registry line per scope, and the auth lines `authKeys`
 * derives.
 *
 * There is one set of auth lines however many scopes there are, because a
 * credential is a property of the endpoint rather than of a scope — the half of
 * this file's original reasoning that survived the measurement above.
 */
export function npmrcContent(registry: string, scopes: readonly string[]): string {
  if (scopes.length === 0) {
    throw new StorefrontInputError(
      `\`--registry ${registry}\` was given, and the reference storefront declares no scoped ` +
        `\`workspace:\` dependency for it to answer for. An \`.npmrc\` naming no scope ` +
        `configures nothing: every fetch would go to the default registry and the file would ` +
        `read as though it did something.`,
    );
  }
  const endpoint = normalizeRegistry(registry);
  const lines = [
    '# Written by `endora new storefront --registry`. It holds no secret: the token below is',
    `# an environment reference that pnpm expands at install time, so set ${TOKEN_VARIABLE} in`,
    '# your environment (a CI variable, a keyring) and commit this file as it is.',
  ];
  for (const scope of scopes) lines.push(`${scope}:registry=${endpoint}`);
  lines.push(
    '# The endpoint serves the metadata; the tarball it names in that metadata can be on any',
    '# path of this host (GitLab serves it from the owning project), so the credential is',
    '# declared for the host as well. Without the second line that one fetch goes out',
    '# unauthenticated and the registry answers 404.',
  );
  for (const key of authKeys(endpoint)) lines.push(`${key}:_authToken=\${${TOKEN_VARIABLE}}`);
  return `${lines.join('\n')}\n`;
}
