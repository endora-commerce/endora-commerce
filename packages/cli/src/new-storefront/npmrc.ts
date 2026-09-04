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
 */
import { StorefrontInputError, workspaceRanges } from './reference.js';

/**
 * The environment variable the auth line refers to.
 *
 * One name, spelled here and in `.gitlab-ci.yml`'s `publish:packages` job,
 * because it is the name the contract writes (R3) and the one an operator is told to
 * set. It is deliberately not an option: a per-scaffold variable name is a
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
 * The file's text: one registry line per scope, one auth line for the endpoint.
 *
 * The auth line is keyed on the host and path with the scheme removed, which is
 * npm's own spelling for a per-registry credential and the one GitLab documents.
 * There is one of it however many scopes there are, because a credential is a
 * property of the endpoint rather than of a scope.
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
  const authKey = endpoint.replace(/^https?:/, '');
  const lines = [
    '# Written by `endora new storefront --registry`. It holds no secret: the token below is',
    `# an environment reference that pnpm expands at install time, so set ${TOKEN_VARIABLE} in`,
    '# your environment (a CI variable, a keyring) and commit this file as it is.',
  ];
  for (const scope of scopes) lines.push(`${scope}:registry=${endpoint}`);
  lines.push(`${authKey}:_authToken=\${${TOKEN_VARIABLE}}`);
  return `${lines.join('\n')}\n`;
}
