/**
 * The scaffolded storefront's `Dockerfile` and `.dockerignore`, rendered for the
 * tree `endora new storefront` writes (`specs/136-open-source-publication/` plan
 * W7.4, D-274 clause 6).
 *
 * ## Why they are rendered rather than copied
 *
 * The reference storefront's own `Dockerfile` builds from **this repository's
 * root**: it runs `scripts/collect-workspace-manifests.sh` to find the workspace
 * members, copies `packages/` to build them, and filters the install to the
 * storefront's slice of a monorepo. A scaffolded storefront is a tree of its own
 * (D-195) whose `@endora-commerce/*` dependencies arrive built from a registry,
 * so none of that exists there — measured on 2026-09-28, `docker build` of a
 * fresh scaffold stopped at `cannot open scripts/collect-workspace-manifests.sh`.
 * The copy was a Dockerfile for a tree the client does not have.
 *
 * ## What is derived, and from where
 *
 * The build arguments are `../lib/instance-build-inputs.js`'s, through the same
 * two emitters the instance's own image examples use (`layer-independence.md`
 * R3.8), so a fifth spelling of a build input cannot arrive here. The base image
 * and the package manager are the rewritten manifest's `engines.node` and
 * `packageManager` — the values the scaffold already copies from the checkout
 * rather than invents (FR-023).
 *
 * The run stage mirrors the reference's: the storefront's `next.config.js`
 * traces the standalone output from the directory **above** the application, so
 * the tree is built one level down, at `/app/storefront`, and the server lands at
 * `.next/standalone/storefront/server.js` whatever the client called the
 * directory.
 */
import { argDeclarations, buildInvocation, corepack, nodeImage } from '../new-instance/deploy.js';
import { TOKEN_VARIABLE } from './npmrc.js';

/** The BuildKit secret the install reads the registry token from (D-274 clause 2.4). */
const TOKEN_SECRET = TOKEN_VARIABLE.toLowerCase();

/** What the rendering needs to know about the copy. */
export interface StorefrontDockerInput {
  /** The rewritten manifest's `engines.node`, if it declares one. */
  readonly enginesNode: string | undefined;
  /** The rewritten manifest's `packageManager`, if it pins one. */
  readonly packageManager: string | undefined;
  /** Whether the scaffold writes an `.npmrc` (`--registry`). */
  readonly npmrc: boolean;
}

export function storefrontDockerfile(input: StorefrontDockerInput): string {
  // An absent range is a digit-free one to `nodeImage`, which falls back to the
  // running interpreter's major rather than to a literal written here.
  const base = nodeImage(input.enginesNode ?? '');
  const invocation = buildInvocation('storefront', 'Dockerfile');
  return `${[
    // 1.10 for `RUN --mount=type=secret,…,env=`, which the private-registry
    // install below uses.
    '# syntax=docker/dockerfile:1.10',
    '# The image for this storefront: `next build`, served by its standalone server.',
    '# Copy it, change what you need, own it.',
    '#',
    '# Build from the root of this storefront:',
    ...(input.npmrc
      ? [
          ...invocation.slice(0, -1),
          `#     --secret id=${TOKEN_SECRET},env=${TOKEN_VARIABLE} \\`,
          invocation.at(-1)!,
        ]
      : invocation),
    '#',
    '# THE NEXT_PUBLIC_* VALUES ARE INLINED AT BUILD TIME. The API origin and this',
    '# shop\'s own public origin (every canonical link, the sitemap and robots.txt)',
    '# are compiled into the bundle, so no container environment can correct them',
    '# afterwards: a wrong one is a rebuild, not a redeploy. What the server reads at',
    '# RUNTIME — BACKEND_BASE_URL, REVALIDATE_SECRET — comes from the container',
    '# environment, never from `.env`, which `.dockerignore` keeps out of the image.',
    ...(input.npmrc
      ? [
          '#',
          `# \`.npmrc\` names your registry and reads its token from ${TOKEN_VARIABLE} at`,
          '# install time. The install below receives it as a BuildKit secret, which',
          '# exists for that one RUN and is in no layer. Never pass it as a build',
          '# argument: an ARG is readable in `docker history` by anyone who can pull',
          '# the image.',
        ]
      : []),
    '',
    `FROM ${base} AS base`,
    'ENV PNPM_HOME=/pnpm',
    'ENV PATH="$PNPM_HOME:$PATH"',
    ...corepack(input.packageManager),
    '# One level down: `next.config.js` traces the standalone output from the',
    '# directory above this one.',
    'WORKDIR /app/storefront',
    '',
    'FROM base AS build',
    '# The lockfile is one of these on purpose: `--frozen-lockfile` below refuses to',
    '# resolve a range, so an image is built from the versions you committed and',
    '# never from whatever the registry had that morning. `pnpm install` writes it;',
    '# commit it.',
    'COPY package.json pnpm-lock.yaml ./',
    ...(input.npmrc ? ['COPY .npmrc ./'] : []),
    input.npmrc
      ? `RUN --mount=type=secret,id=${TOKEN_SECRET},env=${TOKEN_VARIABLE} pnpm install --frozen-lockfile`
      : 'RUN pnpm install --frozen-lockfile',
    '',
    'COPY . .',
    ...argDeclarations('storefront'),
    'ENV NEXT_TELEMETRY_DISABLED=1',
    '# The storefront\'s own build command — themes, `next build`, the theme check —',
    '# and not a second spelling of it.',
    'RUN pnpm run build',
    '',
    'FROM base AS run',
    'ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0',
    'WORKDIR /app',
    'COPY --from=build /app/storefront/.next/standalone ./',
    'COPY --from=build /app/storefront/.next/static ./storefront/.next/static',
    'COPY --from=build /app/storefront/public ./storefront/public',
    'EXPOSE 3000',
    'CMD ["node", "storefront/server.js"]',
  ].join('\n')}\n`;
}

/**
 * What the build context leaves out.
 *
 * `.env` first, and for a reason rather than tidiness: it holds this
 * storefront's `REVALIDATE_SECRET`, and `COPY . .` would put it in a layer of an
 * image that is pushed to a registry. The installed and built trees are the
 * image's own to produce; a host's would shadow them.
 */
export const STOREFRONT_DOCKERIGNORE = `${[
  '# The build context `docker build` sends. See Dockerfile.',
  '.env',
  '.env.*',
  '!.env.example',
  '**/node_modules',
  '**/.next',
  '**/.git',
  'test-results/',
  'playwright-report/',
  'blob-report/',
  '.playwright/',
].join('\n')}\n`;
