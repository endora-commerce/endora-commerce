/**
 * The example deployment files an instance is scaffolded with
 * (`specs/122-layer-deployment-independence/contracts/layer-independence.md` §3,
 * under owner ruling **D-230**).
 *
 * ## Why this file exists
 *
 * `instance-repository.md` R2.1 lists a compose file, an nginx configuration
 * and an `.env` as *"always in the instance"*. Measured on 2026-09-13, an
 * instance was handed **none of them**, and no Dockerfile either — so a client
 * asked for the owner's three-host topology wrote three deployment files from
 * scratch, against a compose example that lives in *our* repository and assumes
 * one host.
 *
 * ## They are examples, and they are derived from two axes and nothing else
 *
 * D-215: an instance holds *examples*, never a client's concrete files. So no
 * real registry, no real domain, no real secret and none of this repository's
 * container names appear below. What decides their content is the **member
 * set** — an admin-less instance has no admin service, no admin image and no
 * admin origin in its nginx example — and the **topology**, which selects which
 * files are written and records nothing (R3.2). A topology written into the
 * root manifest would be a third home for what an instance is, beside the
 * `dependencies` that are the module set.
 *
 * ## The three-host split is derived, not written
 *
 * Every service carries the host it belongs to, and {@link composeDocument}
 * drops an edge whose target is not in the same file. That is what makes R3.6
 * checkable rather than asserted: the single-host graph partitions with exactly
 * one edge crossing — `storefront -> backend`, `service_healthy`, a readiness
 * convenience — and the only `service_completed_successfully` edge in the file,
 * `backend -> backend-migrate`, lives entirely inside the backend host. The
 * lost edge is replaced by **nothing**: each layer starts, answers its own
 * health check and tolerates an absent peer, and a wait-for-it script is the
 * temptation this rule exists to refuse. An edge added across a boundary
 * changes what the renderer drops and reds `test/new-instance/deploy-examples.test.ts`.
 *
 * ## Nothing here spells a build input twice
 *
 * Every `--build-arg` the Dockerfile examples pass, and every `ARG` they
 * declare, is emitted from `../lib/instance-build-inputs.js` (§2 R2.3). A
 * fourth spelling of a build input cannot arrive here, because there is no
 * place to write one.
 *
 * ## The development compose is the same catalogue in a second mode
 *
 * `specs/125-first-mile-install/spec.md` §4.1 (FR-100…FR-112). A scaffolded
 * instance also carries `compose.dev.yml`, at its **root** and not under
 * `deploy/`, and that file is **runnable as written** where every file under
 * `deploy/` is an example the client has to build and push images for first. It
 * is rendered by {@link developmentComposeFile} from the **same**
 * {@link services} records, in `development` mode, and FR-103 is what that mode
 * exists for: *"no second statement of what Endora needs to run may enter the
 * tree"*. Two things differ between the modes and both are derived — where a
 * value comes from (an operator-filled `${NAME}` against an inline-defaulted
 * `${NAME:-…}`) and whether the service publishes a host port. The image, the
 * healthcheck and the volume are one record's.
 *
 * Defect F-2 is what that requirement is measured against: this repository's own
 * `docker-compose.yml` and the catalogue below name the same three stateful
 * images, and they agreed by coincidence until
 * `test/new-instance/dev-compose.test.ts` made them agree by instrument — that
 * case reads both files and names both paths, and it is also why no image tag
 * is written twice in this file, not even in this sentence. Writing a **third**
 * statement of them into every client's tree is what
 * this file would have done if the development compose had been authored rather
 * than derived.
 */
import type { EnvironmentInput } from '@endora-commerce/contracts';

import {
  buildArgFlags,
  buildInputsFor,
  type BuildTarget,
} from '../lib/instance-build-inputs.js';
import { InstanceInputError } from './host.js';
import type { FileKind, MemberName } from './template.js';

/** Which machine layout the examples describe. `--topology`'s vocabulary. */
export type Topology = 'single-host' | 'three-host';

/**
 * The vocabulary, in the order the flag's refusal prints it.
 *
 * `single-host` is first because it is the default, on the owner's own *"the
 * most common scenario is probably all three layers on one machine"* (D-215).
 */
export const TOPOLOGIES = ['single-host', 'three-host'] as const satisfies readonly Topology[];

/** What a run that named no topology gets (D-230). */
export const DEFAULT_TOPOLOGY: Topology = 'single-host';

/**
 * `--topology`'s value, or an operator-fixable refusal naming the vocabulary.
 *
 * F3's class: a flag the operator wrote and can rewrite, which
 * `instance-tree.md` §4 puts at exit `1`. It is refused rather than defaulted —
 * a run that silently ignored `--topology three-hosts` would write a
 * single-host example to a client who asked for three, and the first they would
 * hear of it is a compose file with a database in it.
 */
export function assertTopology(value: string): Topology {
  if ((TOPOLOGIES as readonly string[]).includes(value)) return value as Topology;
  throw new InstanceInputError(
    'F3',
    `\`--topology ${value}\` is not a topology this command writes an example for. It is ` +
      `one of ${TOPOLOGIES.join(' | ')}, and it selects which example deployment files go ` +
      `into \`deploy/\` — it is written into no manifest and read back by nothing, so a ` +
      `machine layout stays a fact about your machines. Nothing is written.`,
  );
}

/** Everything the examples are derived from. */
export interface DeployInput {
  readonly topology: Topology;
  /** The admin member was written (§2.4), so there is an admin artefact. */
  readonly admin: boolean;
  /** An `.npmrc` was written, so an image build has to carry it (R5.7). */
  readonly npmrc: boolean;
  /** The documentation member was written — it changes the image's install. */
  readonly docs: boolean;
  /** The root manifest's `engines.node`, which the image's tag is read from. */
  readonly enginesNode: string;
  /** The root manifest's `packageManager`, or `undefined`. */
  readonly packageManager: string | undefined;
  /**
   * What this instance reads from its environment — the platform's declaration
   * unioned with the manifests of the modules it installs.
   *
   * The **same** value the root `.env.example` is derived from, threaded here
   * rather than re-derived, so a variable an operator has to fill in has one
   * sentence in this repository and not two
   * (`specs/123-oss-install-experience/` G3). See {@link envExampleFor} for
   * which of the three sources answers a given name.
   */
  readonly declared: readonly EnvironmentInput[];
}

/** One planned file, in `template.ts`' own shape. */
export interface DeployFile {
  readonly path: string;
  readonly kind: FileKind;
  readonly member: MemberName;
  readonly content: string;
}

// ── the services, and the host each belongs to ──────────────────────────────

type HostName = 'backend' | 'storefront' | 'admin';
type Condition = 'service_healthy' | 'service_completed_successfully';

interface ExampleService {
  readonly name: string;
  readonly host: HostName;
  readonly dependsOn: readonly (readonly [string, Condition])[];
  /** The service's own keys, at the indentation compose wants them. */
  readonly body: readonly string[];
}

/**
 * Which rendering of the catalogue is being asked for (FR-103).
 *
 * `production` is what `deploy/`'s examples are: a value is a `${NAME}` the
 * operator fills in beside them, and a backing service publishes no host port
 * because the application reaches it over the project's own network.
 * `development` is `compose.dev.yml`: the same records, every value
 * inline-defaulted so the file runs in a tree whose `.env` was never opened
 * (FR-101), and every backing service published on a host port because the
 * application it serves runs **natively** from the workspace (FR-104).
 *
 * Nothing else may branch on it. A second list of services under a mode flag is
 * the defect FR-103 exists to refuse, one indirection later.
 */
type ServiceMode = 'production' | 'development';

const IMAGE = (member: string): string =>
  `    image: \${REGISTRY_IMAGE}/${member}:\${IMAGE_TAG:-latest}`;

/**
 * The backend's environment, declared once and read by both backend services.
 *
 * `ADMIN_BASE_URL` and `CORS_ALLOWED_ORIGINS` are here whatever the member set
 * is, and that is R3.7 rather than an oversight: both are read by the
 * **backend** — `mfa` composes mailed links from the first and the platform's
 * HTTP server reads the second — so a rule that dropped them with the admin
 * member would be keyed on the variable's name, which is wrong on two of the
 * three inputs that mention the admin. They are passed through from the `.env`
 * rather than composed from a domain, because under three hosts the backend
 * cannot guess an origin that is not its own.
 */
const BACKEND_ENVIRONMENT: readonly string[] = [
  'x-backend-env: &backend-env',
  '  NODE_ENV: production',
  '  LOG_LEVEL: ${LOG_LEVEL:-info}',
  '  PORT: "3001"',
  '  DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}',
  '  REDIS_URL: redis://redis:6379',
  '  MEILISEARCH_URL: http://meilisearch:7700',
  '  MEILISEARCH_API_KEY: ${MEILI_MASTER_KEY}',
  '  # The origin every payment-gateway callback, public product feed and',
  '  # newsletter confirmation link is built on. The backend refuses to boot in',
  '  # production when it resolves to nothing at all.',
  '  BACKEND_PUBLIC_URL: https://${API_DOMAIN}',
  '  PUBLIC_API_BASE_URL: https://${API_DOMAIN}',
  '  STOREFRONT_BASE_URL: https://${STOREFRONT_DOMAIN}',
  '  # Both of these are the BACKEND\'s inputs, whether or not this instance',
  '  # ships an admin: the first is what mailed links are composed from and the',
  '  # second is what the browser is allowed to call the API from. Get the',
  '  # second wrong and every call from the admin and the storefront fails with',
  '  # a message that names none of this.',
  '  ADMIN_BASE_URL: ${ADMIN_BASE_URL}',
  '  CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS}',
  '  # The other half of the revalidation seam. It must be the SAME value the',
  '  # storefront has; unset, the backend\'s revalidator is a silent no-op and a',
  '  # catalogue change never reaches the rendered storefront.',
  '  REVALIDATE_SECRET: ${REVALIDATE_SECRET}',
  '  SESSION_COOKIE_SECRET: ${SESSION_COOKIE_SECRET}',
  '  SETTINGS_SECRET_ENCRYPTION_KEY: ${SETTINGS_SECRET_ENCRYPTION_KEY}',
  '  MFA_SECRET_ENCRYPTION_KEY: ${MFA_SECRET_ENCRYPTION_KEY}',
  '  ASSETS_LIBRARY_HMAC_KEY: ${ASSETS_LIBRARY_HMAC_KEY}',
  '  # Which upstream proxy may be believed about the client address. Unset, the',
  '  # backend trusts none and every request looks like it came from your proxy.',
  '  TRUSTED_PROXY_HOPS: ${TRUSTED_PROXY_HOPS}',
  '  TRUSTED_PROXY_ADDRESSES: ${TRUSTED_PROXY_ADDRESSES}',
  '  DEFAULT_SALES_CHANNEL_CODE: ${DEFAULT_SALES_CHANNEL_CODE}',
  '  SALES_CHANNEL_HOST_MAP: ${SALES_CHANNEL_HOST_MAP}',
  '  SMTP_URL: ${SMTP_URL}',
  '  SMTP_FROM: ${SMTP_FROM}',
];

/**
 * Every service the examples can hold, with the host it belongs to (R1.4), in
 * the rendering the caller asked for (FR-103).
 *
 * `value` and `published` are the **only** two things the mode decides, and
 * every service below reads them rather than branching: a record that tested
 * the mode itself would be two records sharing a name, which is what
 * *"one catalogue, two renderings"* refuses.
 */
function services(
  input: DeployInput,
  mode: ServiceMode = 'production',
): readonly ExampleService[] {
  /**
   * One value, from the mode's own source.
   *
   * In `production` it is a `${NAME}` the operator fills in `deploy/.env` — a
   * default there would be this file choosing a client's database password. In
   * `development` it is the same name carrying that default inline, which is
   * FR-101: `docker compose -f compose.dev.yml up -d --wait` has to succeed in
   * a tree whose `.env` has never been opened, and one un-defaulted expansion
   * anywhere defeats that whatever the rest carry.
   */
  const value = (name: string, development: string): string =>
    mode === 'production' ? `\${${name}}` : `\${${name}:-${development}}`;
  /**
   * The host ports a backing service publishes, in `development` only.
   *
   * Under `deploy/` these are not published: the application is a container in
   * the same project and reaches them by service name. On a development machine
   * the backend, the admin and the storefront run **natively** from the
   * workspace the same run wrote (FR-104), so the only way they reach these is
   * a published port. Each one is overridable, because two checkouts on one
   * machine is the ordinary case and a fixed 5432 makes the second one fail.
   */
  const published = (
    ports: readonly (readonly [variable: string, host: number, container: number])[],
  ): readonly string[] =>
    mode === 'production'
      ? []
      : [
          '    ports:',
          ...ports.map(
            ([variable, host, container]) =>
              `      - '\${${variable}:-${String(host)}}:${String(container)}'`,
          ),
        ];
  const all: ExampleService[] = [
    {
      name: 'postgres',
      host: 'backend',
      dependsOn: [],
      body: [
        '    image: postgres:16-alpine',
        '    restart: unless-stopped',
        '    environment:',
        `      POSTGRES_USER: ${value('POSTGRES_USER', 'endora')}`,
        `      POSTGRES_PASSWORD: ${value('POSTGRES_PASSWORD', 'endora')}`,
        `      POSTGRES_DB: ${value('POSTGRES_DB', 'endora')}`,
        '    volumes:',
        '      - postgres-data:/var/lib/postgresql/data',
        ...published([['POSTGRES_PORT', 5432, 5432]]),
        '    healthcheck:',
        `      test: ['CMD-SHELL', 'pg_isready -U ${value('POSTGRES_USER', 'endora')} -d ${value('POSTGRES_DB', 'endora')}']`,
        '      interval: 5s',
        '      timeout: 5s',
        '      retries: 12',
      ],
    },
    {
      name: 'redis',
      host: 'backend',
      dependsOn: [],
      body: [
        '    image: redis:7-alpine',
        '    restart: unless-stopped',
        "    command: ['redis-server', '--appendonly', 'yes']",
        '    volumes:',
        '      - redis-data:/data',
        ...published([['REDIS_PORT', 6379, 6379]]),
        '    healthcheck:',
        "      test: ['CMD', 'redis-cli', 'ping']",
        '      interval: 5s',
        '      timeout: 3s',
        '      retries: 12',
      ],
    },
    {
      name: 'meilisearch',
      host: 'backend',
      dependsOn: [],
      body: [
        '    image: getmeili/meilisearch:v1.11',
        '    restart: unless-stopped',
        '    environment:',
        // The development default is a real key rather than a blank, and it has
        // to be: `MEILI_ENV: production` is the same record's line in both
        // modes, and that image refuses to start on a master key shorter than
        // 16 bytes. A development machine with no search engine is a health
        // route reporting the instance degraded, which is the state FR-100 is
        // about.
        `      MEILI_MASTER_KEY: ${value('MEILI_MASTER_KEY', 'endora-development-master-key')}`,
        '      MEILI_ENV: production',
        "      MEILI_NO_ANALYTICS: 'true'",
        '    volumes:',
        '      - meilisearch-data:/meili_data',
        ...published([['MEILISEARCH_PORT', 7700, 7700]]),
        '    healthcheck:',
        '      # 127.0.0.1 and not localhost: the image resolves localhost to ::1',
        '      # as well and meilisearch binds IPv4 only, so busybox wget gives up',
        '      # on the first refusal and the check never reports healthy.',
        "      test: ['CMD', 'wget', '--quiet', '--spider', 'http://127.0.0.1:7700/health']",
        '      interval: 5s',
        '      timeout: 3s',
        '      retries: 12',
      ],
    },
    // The mail catcher exists in the development rendering only, and that is
    // the honest shape rather than an omission: production mail goes to a real
    // SMTP relay, and a catcher there would swallow every order confirmation a
    // client's customers are waiting for (FR-112). `axllent/mailpit` and not
    // `mailhog/MailHog` — measured 2026-09-14 through the GitHub API, MailHog's
    // last commit is 2024-02-13 and Mailpit's is 2026-09-06.
    ...(mode === 'development'
      ? [
          {
            name: 'mailpit',
            host: 'backend' as HostName,
            dependsOn: [],
            body: [
              '    image: axllent/mailpit:v1.31',
              '    restart: unless-stopped',
              '    environment:',
              // A development SMTP_URL that carries credentials is the ordinary
              // case — the client is pointing the same configuration at a real
              // relay tomorrow — and this catcher accepts them rather than
              // refusing mail nobody will read anyway. It keeps no volume: a
              // caught message is worth exactly one session.
              "      MP_SMTP_AUTH_ACCEPT_ANY: '1'",
              "      MP_SMTP_AUTH_ALLOW_INSECURE: '1'",
              ...published([
                ['MAILPIT_SMTP_PORT', 1025, 1025],
                ['MAILPIT_UI_PORT', 8025, 8025],
              ]),
              '    healthcheck:',
              '      # The same 127.0.0.1 rule the search engine\'s check carries, for',
              '      # the same reason: busybox wget gives up on the first refusal.',
              "      test: ['CMD', 'wget', '--quiet', '--spider', 'http://127.0.0.1:8025/readyz']",
              '      interval: 5s',
              '      timeout: 3s',
              '      retries: 12',
            ],
          },
        ]
      : []),
    {
      name: 'backend-migrate',
      host: 'backend',
      dependsOn: [['postgres', 'service_healthy']],
      body: [
        '    # One-shot: apply the migrations before the API starts, from the SAME',
        '    # image the API is about to run. A migrate job running a different',
        '    # build of the application is the half-built state that ordering',
        '    # exists to close.',
        IMAGE('backend'),
        "    command: ['node', 'dist/db/migrate.js', 'up']",
        '    environment: *backend-env',
        "    restart: 'no'",
      ],
    },
    {
      name: 'backend',
      host: 'backend',
      dependsOn: [
        ['postgres', 'service_healthy'],
        ['redis', 'service_healthy'],
        ['meilisearch', 'service_healthy'],
        ['backend-migrate', 'service_completed_successfully'],
      ],
      body: [
        IMAGE('backend'),
        '    restart: unless-stopped',
        '    environment: *backend-env',
        '    # Published on loopback only — your own nginx proxies the public',
        '    # name here and terminates TLS. See nginx.example.conf.',
        '    ports:',
        "      - '${API_HOST_PORT}:3001'",
        '    volumes:',
        '      # The local-filesystem assets adapter writes under backend/var.',
        '      - backend-assets:/app/backend/var',
        '    healthcheck:',
        "      test: ['CMD', 'node', '-e', \"fetch('http://127.0.0.1:3001/api/v1/_health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"]",
        '      interval: 10s',
        '      timeout: 5s',
        '      retries: 12',
        '      start_period: 30s',
      ],
    },
    {
      name: 'storefront',
      host: 'storefront',
      // A readiness convenience and not a correctness guarantee: the storefront
      // starts without the backend and its first page fetch fails. That is why
      // the three-host example replaces it with nothing (R3.6).
      dependsOn: [['backend', 'service_healthy']],
      body: [
        '    # Built from the storefront repository `endora new storefront` wrote,',
        '    # which is its own tree and declares no module package (D-195).',
        IMAGE('storefront'),
        '    restart: unless-stopped',
        '    environment:',
        '      NODE_ENV: production',
        "      PORT: '3000'",
        '      HOSTNAME: 0.0.0.0',
        ...storefrontBackendUrl(input.topology),
        ...revalidateSecret(input.topology),
        '      #',
        '      # The public origin is NOT settable here. The origin this shop puts',
        '      # in every canonical link, in its sitemap and in its robots.txt is',
        '      # inlined by `next build` from NEXT_PUBLIC_SITE_URL, and the repair',
        '      # for a wrong one is a rebuild rather than a value in this block.',
        '    ports:',
        "      - '${STOREFRONT_HOST_PORT}:3000'",
        '    healthcheck:',
        "      test: ['CMD', 'node', '-e', \"fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"]",
        '      interval: 10s',
        '      timeout: 5s',
        '      retries: 12',
        '      start_period: 20s',
      ],
    },
  ];
  if (input.admin) {
    all.push({
      name: 'admin',
      host: 'admin',
      // Nothing. The admin is static files behind a web server and talks to the
      // API from the browser, so it has no peer to wait for — which is why a
      // host of its own costs it nothing at all.
      dependsOn: [],
      body: [
        '    # Static files behind nginx. No database, no cache, no search, and no',
        '    # `depends_on`: it reaches the API from the browser, so it starts,',
        '    # restarts and rolls back on a schedule of its own.',
        IMAGE('admin'),
        '    restart: unless-stopped',
        '    ports:',
        "      - '${ADMIN_HOST_PORT}:80'",
        '    healthcheck:',
        "      test: ['CMD', 'wget', '--quiet', '--spider', 'http://127.0.0.1:80/']",
        '      interval: 10s',
        '      timeout: 3s',
        '      retries: 6',
      ],
    });
  }
  return all;
}

/** R3.4 — a cross-host URL is a real origin, never a container name. */
function storefrontBackendUrl(topology: Topology): readonly string[] {
  if (topology === 'single-host') {
    return [
      '      # The server-side fetcher, over this project\'s own network. The',
      '      # container name resolves because both services are in one project;',
      '      # split them across hosts and this becomes a public origin.',
      '      BACKEND_BASE_URL: http://backend:3001',
    ];
  }
  return [
    '      # The backend is on another machine, so this is its PUBLIC origin. A',
    '      # container name resolves only on a shared Docker network and would',
    '      # fail here with a name lookup that says nothing about why.',
    '      # Where you have a private link between the two hosts, put that',
    '      # address here instead — it is the same value, over a cheaper path.',
    '      #',
    '      # WHAT THE SPLIT COSTS, AND IT IS NOT IN THE DIFF: every',
    '      # server-rendered page now makes a network round trip to a different',
    '      # machine. On one host that fetch was a bridge hop; here it is a TLS',
    '      # request over whatever is between the two, on every render.',
    '      BACKEND_BASE_URL: https://${API_DOMAIN}',
  ];
}

/** R3.5's second cost, stated in the file the operator edits. */
function revalidateSecret(topology: Topology): readonly string[] {
  if (topology === 'single-host') {
    return [
      '      # The secret `/api/revalidate` compares the backend\'s header',
      '      # against. Unset here, the endpoint answers 401 to a backend that is',
      '      # configured correctly.',
      '      REVALIDATE_SECRET: ${REVALIDATE_SECRET}',
    ];
  }
  return [
    '      # The secret `/api/revalidate` compares the backend\'s header against,',
    '      # and it must be the SAME value the backend has.',
    '      #',
    '      # THE SECOND COST OF THE SPLIT: on one host this value never left a',
    '      # private bridge network. Here it is a bearer secret on a public',
    '      # endpoint, presented over the internet on every catalogue change.',
    '      # Generate it freshly per environment and rotate it like a password.',
    '      REVALIDATE_SECRET: ${REVALIDATE_SECRET}',
  ];
}

/** The named volumes a set of services needs, derived from what they mount. */
function volumesFor(chosen: readonly ExampleService[]): readonly string[] {
  const named = new Set<string>();
  for (const service of chosen) {
    for (const line of service.body) {
      const match = /^ {6}- ([a-z-]+):\//.exec(line);
      if (match !== null) named.add(match[1]!);
    }
  }
  return [...named].sort();
}

/**
 * One compose document over a set of services.
 *
 * An edge whose target is not in the same document is **dropped**, never
 * translated: that is R3.6, and it is what makes the three-host files a
 * derivation of the single-host one rather than a second authoring of it.
 */
function composeDocument(
  header: readonly string[],
  chosen: readonly ExampleService[],
): string {
  const present = new Set(chosen.map((service) => service.name));
  const lines = [...header, ''];
  if (chosen.some((service) => service.name === 'backend')) {
    lines.push(...BACKEND_ENVIRONMENT, '');
  }
  lines.push('services:');
  for (const service of chosen) {
    lines.push(`  ${service.name}:`, ...service.body);
    const edges = service.dependsOn.filter(([target]) => present.has(target));
    if (edges.length > 0) {
      lines.push('    depends_on:');
      for (const [target, condition] of edges) {
        lines.push(`      ${target}:`, `        condition: ${condition}`);
      }
    }
    lines.push('');
  }
  const volumes = volumesFor(chosen);
  if (volumes.length > 0) {
    lines.push('volumes:', ...volumes.map((name) => `  ${name}:`), '');
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

// ── the development compose (`specs/125-first-mile-install/` §4.1) ──────────

/** Where the development compose is written, relative to the instance root. */
export const DEV_COMPOSE_PATH = 'compose.dev.yml';

/**
 * The names a document expands **without** an inline default (FR-111).
 *
 * The guard `envExampleFor` does not give you, and the reason it is a second
 * pattern rather than that function's constant is one character:
 * `/\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/g`'s default clause is **non-capturing**, so
 * a match there says nothing about which of the two forms it was. Reusing it
 * here would report every expansion as defaulted — a guard that is green on
 * precisely the document it was written to refuse (spec §5.3.3).
 *
 * Sorted and de-duplicated, because the sentence this feeds is read by whoever
 * added the record, and three occurrences of one name is one repair.
 */
export function undefaultedExpansions(document: string): readonly string[] {
  const names = new Set<string>();
  for (const match of document.matchAll(/\$\{([A-Z0-9_]+)(:-[^}]*)?\}/g)) {
    if (match[2] === undefined) names.add(match[1]!);
  }
  return [...names].sort();
}

/**
 * The header of the one file in a scaffolded tree that is meant to be **run**.
 *
 * It says the command, it says what the file is not, and it says where the
 * other compose files are — because a tree holding both a production example
 * and a development stack is a tree in which somebody will start the wrong one.
 */
const DEVELOPMENT_HEADER: readonly string[] = [
  '# The backing services this instance needs on a DEVELOPMENT machine.',
  '#',
  '#   docker compose -f compose.dev.yml up -d --wait',
  '#   docker compose -f compose.dev.yml down',
  '#',
  '# `--wait` blocks until every health check below passes, which is what stops',
  '# `pnpm run migrate` racing a Postgres that is still initialising. Both lines',
  '# are `pnpm run dev:services` and `pnpm run dev:services:down` in this',
  '# repository, and this file is what they run.',
  '#',
  '# EVERY value below carries an inline default, so this works in a tree whose',
  '# `.env` you have never opened. Set any of them in `.env` beside this file to',
  '# override one — two checkouts on one machine want different host ports.',
  '#',
  '# IT IS NOT A DEPLOYMENT, and it is deliberately not at one of Compose\'s four',
  '# default filenames: a bare `docker compose up` in this tree finds nothing.',
  '# The examples for a machine you own are in `deploy/` — they pull images you',
  '# have built and pushed, and they publish nothing on loopback by accident.',
  '#',
  '# There is no application service here. The backend, the admin and the',
  '# storefront run natively from this workspace (`pnpm run start`,',
  '# `pnpm run preview:admin`), against the ports published below.',
];

/**
 * `compose.dev.yml`, rendered from the catalogue in `development` mode.
 *
 * **Which services reach it is derived rather than listed** (FR-104): every
 * service whose image is this repository's own build — `${REGISTRY_IMAGE}/…` —
 * is an application service and is dropped, and everything else is a backing
 * service and is kept. So a backing service the catalogue gains appears here in
 * the same merge request with nothing edited, and an application service it
 * gains stays out, which is the direction both rules want. A list would have
 * been a second statement of the partition.
 *
 * `extra` exists for the guard's own proof and for nothing else: it is the only
 * way to put an expansion into this document that the catalogue cannot produce,
 * and a test that could not do that would be asserting the throw over a
 * document that never reaches it.
 */
export function developmentComposeFile(
  input: DeployInput,
  extra: readonly string[] = [],
): DeployFile {
  const backing = services(input, 'development').filter(
    (service) => !service.body.some((line) => line.includes('${REGISTRY_IMAGE}')),
  );
  const content = composeDocument([...DEVELOPMENT_HEADER, ...extra], backing);
  const blank = undefaultedExpansions(content);
  if (blank.length > 0) {
    throw new Error(
      `deploy: ${DEV_COMPOSE_PATH} expands ${blank.join(', ')} with no inline default. This ` +
        'file is the one a client starts without editing anything, so an expansion with no ' +
        '`:-` default is a container that comes up wrong — or not at all — in a tree whose ' +
        '`.env` has never been opened. Give the record a default, or keep the value out of ' +
        'the development rendering.',
    );
  }
  return { path: DEV_COMPOSE_PATH, kind: 'derived', member: 'root', content };
}

/**
 * The defaults a rendered document carries, by name.
 *
 * Read off the document rather than off the catalogue that wrote it, which is
 * the same discipline `envExampleFor` states for the production examples:
 * *"derived from the rendered document rather than listed, so the two cannot
 * come apart"*. A caller therefore cannot be handed a port the file does not
 * publish.
 */
function inlineDefaults(document: string): ReadonlyMap<string, string> {
  const defaults = new Map<string, string>();
  for (const match of document.matchAll(/\$\{([A-Z0-9_]+):-([^}]*)\}/g)) {
    if (!defaults.has(match[1]!)) defaults.set(match[1]!, match[2]!);
  }
  return defaults;
}

/**
 * How a **natively running** process reaches the development stack (FR-105).
 *
 * One entry per input the rendered document actually answers, composed from the
 * defaults that document carries — so a changed port or a changed credential
 * moves the address in the same run, with no second list to edit. An entry
 * whose composition names something the document does not carry is **not
 * produced**: a document with no mail catcher yields no `SMTP_URL`, and nothing
 * here has to know that `SMTP_URL` is the `email` module's input.
 *
 * That is the compose half of FR-105's intersection. The other half is the
 * instance's own declaration and belongs to the caller: *"an input is derived
 * only when the development compose provides a service for it **and** this
 * instance declares it"*, and a caller that skipped the second test would write
 * a value for a module nobody installed.
 *
 * `localhost` and not a container name, for the reason FR-104 gives: nothing in
 * this document is an application, so every reader of these values is a process
 * on the host reaching a published port.
 */
export function developmentAddresses(document: string): ReadonlyMap<string, string> {
  const defaults = inlineDefaults(document);
  const addresses = new Map<string, string>();
  /** One input, composed only if the document answers every name it needs. */
  const compose = (name: string, needs: readonly string[], build: (of: (key: string) => string) => string): void => {
    if (!needs.every((key) => defaults.has(key))) return;
    addresses.set(name, build((key) => defaults.get(key)!));
  };
  compose('DATABASE_URL', ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_PORT', 'POSTGRES_DB'], (of) =>
    `postgresql://${of('POSTGRES_USER')}:${of('POSTGRES_PASSWORD')}@localhost:${of('POSTGRES_PORT')}/${of('POSTGRES_DB')}`,
  );
  compose('REDIS_URL', ['REDIS_PORT'], (of) => `redis://localhost:${of('REDIS_PORT')}`);
  compose('MEILISEARCH_URL', ['MEILISEARCH_PORT'], (of) => `http://localhost:${of('MEILISEARCH_PORT')}`);
  compose('MEILISEARCH_API_KEY', ['MEILI_MASTER_KEY'], (of) => of('MEILI_MASTER_KEY'));
  compose('SMTP_URL', ['MAILPIT_SMTP_PORT'], (of) => `smtp://localhost:${of('MAILPIT_SMTP_PORT')}`);
  return addresses;
}

/**
 * Where the mail catcher's own interface is, if this document runs one.
 *
 * Not an environment input — nothing reads it — and therefore not in
 * {@link developmentAddresses}. It is printed, because a client whose instance
 * sends mail to a port has no way to learn where that mail went.
 */
export function developmentMailUrl(document: string): string | undefined {
  const port = inlineDefaults(document).get('MAILPIT_UI_PORT');
  return port === undefined ? undefined : `http://localhost:${port}`;
}

// ── the runtime inputs, and the `.env.example` derived from them ────────────

interface RuntimeInput {
  readonly name: string;
  /**
   * What it decides — **the fallback, not the authority**.
   *
   * Since G3 a variable the resolved platform or an installed module declares
   * takes the **declaration's** sentence, and {@link envExampleFor} enforces
   * that precedence: an operator reading a rendered `.env.example` never reads
   * the sentence below for a name anything declares.
   *
   * It stays required all the same, and the reason is a failure mode rather
   * than tidiness. The declaration is read off the resolved platform package at
   * run time, so a platform whose `./env` entry point will not import — an older
   * release, a broken install — yields an empty one; with no fallback here the
   * compose examples would then refuse to render at all, turning a missing
   * sentence into a scaffold that fails. Fourteen of these names are declared
   * somewhere in this repository and their sentences below are therefore dead
   * prose in every real run, which
   * `deploy-examples.test.ts`' precedence case is what keeps honest.
   */
  readonly meaning: string;
  /** The value written on the right of the `=`. An example, never a value. */
  readonly example: string;
}

/**
 * What a *running* stack needs, as opposed to what a *build* needs.
 *
 * What this list is **for**, since G3: an **example value**. The sentence
 * saying what a variable decides comes from the instance's own environment
 * declaration wherever one covers the name, and an entry that carries a
 * `meaning` is one no declaration does — an image path, a host port, the
 * database container's own credentials. That split is the whole of it: a
 * declaration deliberately carries no default (`environment-inputs.md` R1.3),
 * and this file's whole subject is a stack an operator can paste and start.
 *
 * Every entry here is an **example**, per D-215: no real domain, no real
 * registry and no real secret. Which of them reach a given host's
 * `.env.example` is not decided here — {@link envExampleFor} takes the ones
 * that host's compose file actually expands, so a variable nothing reads is
 * never handed to an operator to fill in.
 */
const RUNTIME_INPUTS: readonly RuntimeInput[] = [
  {
    name: 'REGISTRY_IMAGE',
    meaning:
      'The image path without the per-layer suffix. Each service appends its own name, so ' +
      'one value serves the backend, the storefront and the admin.',
    example: 'registry.example.com/your-group/your-project',
  },
  {
    name: 'IMAGE_TAG',
    meaning:
      'Which build to run. A deploy job normally supplies the commit it built; set a value ' +
      'here only for a manual `up`.',
    example: 'latest',
  },
  {
    name: 'API_DOMAIN',
    meaning: 'The public host the backend answers on. DNS must already point at it.',
    example: 'api.example.com',
  },
  {
    name: 'STOREFRONT_DOMAIN',
    meaning: 'The public host the storefront answers on.',
    example: 'example.com',
  },
  {
    name: 'ADMIN_BASE_URL',
    meaning:
      "The admin's public origin, as the BACKEND needs to know it: `mfa` composes the links " +
      'it mails from this value. It is the backend\'s input and not the admin\'s, so it is ' +
      'here whether or not this instance ships an admin — an operator running one elsewhere ' +
      'still owes the backend its origin.',
    example: 'https://admin.example.com',
  },
  {
    name: 'CORS_ALLOWED_ORIGINS',
    meaning:
      'Which browser origins may call the API. Comma-separated, scheme and host, no trailing ' +
      'slash — the storefront and the admin. Wrong here, every call from both fails with a ' +
      'message that names none of this.',
    example: 'https://example.com,https://admin.example.com',
  },
  {
    name: 'API_HOST_PORT',
    meaning:
      'Where the backend is published on this machine. Keep the 127.0.0.1 prefix: your own ' +
      'nginx proxies the public name here, and nothing outside the machine should reach it.',
    example: '127.0.0.1:3001',
  },
  {
    name: 'STOREFRONT_HOST_PORT',
    meaning:
      'Where the storefront is published on this machine. Keep the 127.0.0.1 prefix, for the ' +
      'same reason the API port has one.',
    example: '127.0.0.1:3000',
  },
  {
    name: 'ADMIN_HOST_PORT',
    meaning:
      'Where the admin is published on this machine. Keep the 127.0.0.1 prefix: your own ' +
      'nginx proxies the public name here, and nothing outside the machine should reach it.',
    example: '127.0.0.1:8080',
  },
  {
    name: 'POSTGRES_USER',
    meaning: 'The database role the backend connects as.',
    example: 'endora',
  },
  {
    name: 'POSTGRES_PASSWORD',
    meaning: 'Its password. Generate one: `openssl rand -hex 32`.',
    example: 'change-me-generate-one',
  },
  { name: 'POSTGRES_DB', meaning: 'The database name.', example: 'endora' },
  {
    name: 'MEILI_MASTER_KEY',
    meaning: 'The search engine\'s master key. `openssl rand -base64 32`.',
    example: 'change-me-generate-one',
  },
  {
    name: 'SESSION_COOKIE_SECRET',
    meaning: 'Signs the session cookie. `openssl rand -hex 32`, freshly per environment.',
    example: 'change-me-generate-one',
  },
  {
    name: 'SETTINGS_SECRET_ENCRYPTION_KEY',
    meaning: 'Encrypts the secret Settings modules store. `openssl rand -base64 32`.',
    example: 'change-me-generate-one',
  },
  {
    name: 'MFA_SECRET_ENCRYPTION_KEY',
    meaning: 'Encrypts stored MFA secrets. `openssl rand -base64 32`.',
    example: 'change-me-generate-one',
  },
  {
    name: 'ASSETS_LIBRARY_HMAC_KEY',
    meaning: 'Signs asset URLs. `openssl rand -hex 32`.',
    example: 'change-me-generate-one',
  },
  {
    name: 'REVALIDATE_SECRET',
    meaning:
      'The shared secret the backend presents to the storefront after a content write, and ' +
      'the one the storefront compares it against. The SAME value on both. Empty, and the ' +
      'revalidator is a silent no-op: a catalogue change does not appear until the fetch ' +
      'cache expires on its own.',
    example: 'change-me-generate-one',
  },
  {
    name: 'TRUSTED_PROXY_HOPS',
    meaning:
      'How many proxies sit in front of the backend. One nginx is 1; a CDN in front of it ' +
      'makes it 2. Unset, the backend believes no forwarded address, which collapses the ' +
      'per-IP rate limit into one bucket for the whole internet.',
    example: '1',
  },
  {
    name: 'TRUSTED_PROXY_ADDRESSES',
    meaning:
      'The alternative to the hop count, for a proxy whose address is fixed: IPs, CIDR ' +
      'ranges, or loopback / linklocal / uniquelocal. Set ONE of the two — the backend ' +
      'refuses to boot with both, and there is deliberately no "trust everything" value.',
    example: '',
  },
  {
    name: 'DEFAULT_SALES_CHANNEL_CODE',
    meaning: 'The channel content resolves against when the request names none.',
    example: 'default',
  },
  {
    name: 'SALES_CHANNEL_HOST_MAP',
    meaning: 'host=channelCode pairs, comma-separated. Empty disables host resolution.',
    example: '',
  },
  {
    name: 'SMTP_URL',
    meaning: 'Where mail goes. Empty falls back to a console mailer that delivers nothing.',
    example: '',
  },
  { name: 'SMTP_FROM', meaning: 'The From address on that mail.', example: 'no-reply@example.com' },
  { name: 'LOG_LEVEL', meaning: 'How much the backend says.', example: 'info' },
];

/**
 * The `.env.example` for one compose file — exactly the variables it expands.
 *
 * Derived from the rendered document rather than listed, so the two cannot come
 * apart: a variable the compose file expands and this file does not declare is
 * an operator finding a blank at run time, and a variable declared here that
 * nothing reads is a value nobody can act on. A `${NAME}` with no entry in
 * {@link RUNTIME_INPUTS} is a programming error and says so rather than being
 * written out with no explanation.
 */
function envExampleFor(
  header: readonly string[],
  compose: string,
  declared: readonly EnvironmentInput[],
): string {
  const referenced = new Set(
    [...compose.matchAll(/\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/g)].map((match) => match[1]!),
  );
  const describes = new Map(declared.map((input) => [input.name, input] as const));
  const lines = [...header];
  for (const input of RUNTIME_INPUTS) {
    if (!referenced.has(input.name)) continue;
    referenced.delete(input.name);
    // The declaration wins wherever one covers the name — see
    // {@link RuntimeInput.meaning} for why the fallback below still exists.
    const declaration = describes.get(input.name);
    const sentence =
      declaration === undefined ? input.meaning : declarationSentence(declaration);
    lines.push('', ...wrapComment(sentence), `${input.name}=${input.example}`);
  }
  // A variable only the declaration covers. It is rendered rather than refused
  // because the declaration is the more authoritative of the two sources: an
  // input a module started reading arrives here with its own sentence and needs
  // no entry written beside it. It gets no example, because a declaration
  // deliberately carries no default (`environment-inputs.md` R1.3) and one
  // invented here would be the seventieth home of a value nobody reviewed.
  for (const input of declared) {
    if (!referenced.has(input.name)) continue;
    referenced.delete(input.name);
    lines.push('', ...wrapComment(declarationSentence(input)), `${input.name}=`);
  }
  if (referenced.size > 0) {
    throw new Error(
      `deploy: the compose example expands ${[...referenced].sort().join(', ')}, which ` +
        'neither RUNTIME_INPUTS nor this instance\'s environment declaration describes. An ' +
        'operator would be handed a stack with a blank where a value belongs and no sentence ' +
        'saying what it decides.',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * One declared input's sentence, as the operator reads it in a `.env.example`.
 *
 * The declaration's own words in both halves — what it decides, and what leaving
 * it unset costs — because a rewrite here would be a second statement of the
 * author's fact with nothing reconciling the two.
 */
function declarationSentence(input: EnvironmentInput): string {
  if (input.requirement.kind === 'optional') {
    return `${input.describes.en} Without it, ${input.requirement.without.en}`;
  }
  if (input.requirement.kind === 'requiredWhen') {
    return (
      `${input.describes.en} Required when ` +
      `${input.requirement.input}=${input.requirement.equals}.`
    );
  }
  return `${input.describes.en} Required.`;
}

/** One sentence, wrapped to a width a terminal shows whole. */
function wrapComment(text: string, prefix = '# '): readonly string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line.length > 0 && `${line} ${word}`.length > 84) {
      out.push(`${prefix}${line}`);
      line = word;
      continue;
    }
    line = line.length === 0 ? word : `${line} ${word}`;
  }
  if (line.length > 0) out.push(`${prefix}${line}`);
  return out;
}

// ── the nginx example ──────────────────────────────────────────────────────

/** One `server` block, per public origin this instance actually has. */
function nginxBlock(
  title: string,
  domain: string,
  variable: string,
  port: string,
  extra: readonly string[],
): readonly string[] {
  return [
    `# --- ${title} ${'-'.repeat(Math.max(0, 60 - title.length))}`,
    'server {',
    '    listen 80;',
    '    listen [::]:80;',
    `    server_name ${domain};${' '.repeat(Math.max(1, 28 - domain.length))}# <- ${variable}`,
    '',
    ...extra,
    '    location / {',
    `        proxy_pass http://${port};`,
    '        proxy_http_version 1.1;',
    '        proxy_set_header Host              $host;',
    '        proxy_set_header X-Real-IP         $remote_addr;',
    '        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
    '        proxy_set_header X-Forwarded-Host  $host;',
    '        proxy_set_header Upgrade           $http_upgrade;',
    '        proxy_set_header Connection        $connection_upgrade;',
    '        proxy_read_timeout 120s;',
    '    }',
    '}',
    '',
  ];
}

function nginxExample(input: DeployInput): string {
  return `${[
    '# An EXAMPLE reverse-proxy configuration for the nginx already on this host.',
    '#',
    '# The compose stack publishes each layer on a loopback port; this file',
    '# terminates TLS and proxies each public name to the matching local port. It',
    '# is not applied by anything: copy it, put your own names in, and let certbot',
    '# rewrite each block in place.',
    '#',
    '#   sudo cp nginx.example.conf /etc/nginx/sites-available/endora',
    '#   sudo ln -s /etc/nginx/sites-available/endora /etc/nginx/sites-enabled/endora',
    '#   sudo nginx -t && sudo systemctl reload nginx',
    '#   sudo certbot --nginx -d example.com -d api.example.com',
    '#',
    '# The blocks start as plain :80 so certbot has something to attach to. If you',
    '# changed the host ports in .env, change the proxy_pass targets to match.',
    '',
    '# Next.js and the API\'s event streams both need the Connection/Upgrade dance.',
    'map $http_upgrade $connection_upgrade {',
    '    default upgrade;',
    "    ''      close;",
    '}',
    '',
    ...nginxBlock('Storefront', 'example.com', 'STOREFRONT_DOMAIN', '127.0.0.1:3000', [
      '    # Room for the SSR responses of a large catalogue page.',
      '    client_max_body_size 25m;',
      '',
    ]),
    ...(input.admin
      ? nginxBlock('Admin', 'admin.example.com', 'ADMIN_DOMAIN', '127.0.0.1:8080', [])
      : [
          '# There is deliberately no admin block: this instance was scaffolded',
          '# without the admin member, so there is no admin artefact to proxy and no',
          '# third public name. The backend still needs to be told an admin origin if',
          '# you run one elsewhere — see ADMIN_BASE_URL in .env.example.',
          '',
        ]),
    ...nginxBlock('Backend API', 'api.example.com', 'API_DOMAIN', '127.0.0.1:3001', [
      '    # Asset uploads and bulk imports go straight to the API.',
      '    client_max_body_size 100m;',
      '',
    ]),
  ]
    .join('\n')
    .replace(/\n+$/, '')}\n`;
}

// ── the image examples ─────────────────────────────────────────────────────

/**
 * The base image tag, derived from the `engines.node` the instance declares.
 *
 * R2.5a: a version this command chose would be a value nobody reviewed. The
 * major is what the range actually constrains, and a range with no digit in it
 * is not something a resolved manifest produces — the running interpreter's own
 * major is the fallback rather than a literal written here.
 */
function nodeImage(enginesNode: string): string {
  const major = /(\d+)/.exec(enginesNode)?.[1] ?? process.versions.node.split('.')[0]!;
  return `node:${major}-slim`;
}

/** `corepack`, activating the package manager the root manifest pins. */
function corepack(packageManager: string | undefined): readonly string[] {
  return packageManager === undefined
    ? [
        '# Your root manifest pins no `packageManager`, so corepack takes its own',
        '# default. Pin one and this line names it instead.',
        'RUN corepack enable',
      ]
    : [`RUN corepack enable && corepack prepare ${packageManager} --activate`];
}

/** The workspace manifests an install needs, which is one per written member. */
function memberManifests(input: DeployInput): readonly string[] {
  return [
    '# The lockfile is one of these on purpose: `--frozen-lockfile` below refuses',
    '# to resolve a range, so an image is built from the versions you committed and',
    '# never from whatever the registry had that morning. Commit it.',
    'COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./',
    ...(input.npmrc ? ['COPY .npmrc ./'] : []),
    'COPY backend/package.json backend/',
    ...(input.admin ? ['COPY admin/package.json admin/'] : []),
    ...(input.docs ? ['COPY docs/package.json docs/'] : []),
  ];
}

/** The `docker build` line, with every `--build-arg` the declaration emits. */
function buildInvocation(target: BuildTarget, path: string): readonly string[] {
  const flags = buildArgFlags(target);
  return [
    `#   docker build -f ${path} \\`,
    ...flags.map((flag) => `#     ${flag} \\`),
    `#     -t \${REGISTRY_IMAGE}/${target}:\${IMAGE_TAG} .`,
  ];
}

/** The `ARG`/`ENV` pair per input this target's build reads. */
function argDeclarations(target: BuildTarget): readonly string[] {
  return buildInputsFor(target).flatMap(({ input, consumer }) => [
    ...wrapComment(input.meaning),
    `ARG ${consumer.buildArg}`,
    `ENV ${consumer.buildArg}=$${consumer.buildArg}`,
  ]);
}

function backendDockerfile(input: DeployInput): string {
  return `${[
    '# syntax=docker/dockerfile:1.7',
    '# An EXAMPLE image for this instance\'s backend: the API and, by default, the',
    '# queue consumers beside it. Copy it, change what you need, own it.',
    '#',
    '# Build from the root of this repository, so the workspace is visible:',
    ...buildInvocation('backend', 'deploy/Dockerfile.backend'),
    '#',
    '# The backend runs BUILT output. `start`, `migrate` and every `module:*`',
    '# command name `dist/`, so the compile below is not an optimisation.',
    '',
    `FROM ${nodeImage(input.enginesNode)} AS base`,
    'ENV PNPM_HOME=/pnpm',
    'ENV PATH="$PNPM_HOME:$PATH"',
    '# argon2 ships a native addon; these cover a target with no prebuilt binary.',
    'RUN apt-get update \\',
    '  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \\',
    '  && rm -rf /var/lib/apt/lists/*',
    ...corepack(input.packageManager),
    'WORKDIR /app',
    '',
    '# --- dependencies: the manifests first, so a source edit does not reinstall ---',
    ...memberManifests(input),
    'RUN pnpm install --frozen-lockfile',
    '',
    '# --- the application ---',
    'COPY . .',
    '# The layer\'s own build command, and not a second spelling of it. Change what',
    '# `build:backend` runs and this image follows with no edit here.',
    'RUN pnpm run build:backend',
    '',
    ...argDeclarations('backend'),
    '',
    'ENV NODE_ENV=production',
    'ENV PORT=3001',
    'WORKDIR /app/backend',
    'EXPOSE 3001',
    '',
    '# The compose example overrides this for the one-shot migrate job.',
    'CMD ["node", "dist/index.js"]',
  ].join('\n')}\n`;
}

function adminDockerfile(input: DeployInput): string {
  return `${[
    '# syntax=docker/dockerfile:1.7',
    '# An EXAMPLE image for this instance\'s admin: a Vite build, served as static',
    '# files by nginx. It reaches the API from the browser and has no runtime',
    '# dependency on this tree, on Node, on the database, on Redis or on search —',
    '# which is what lets it live on a host of its own.',
    '#',
    '# Build from the root of this repository:',
    ...buildInvocation('admin', 'deploy/Dockerfile.admin'),
    '#',
    '# THE BUNDLE IS BOUND TO ONE API ORIGIN AT BUILD TIME. Vite inlines the value',
    '# below into the JavaScript, so one bundle serves one backend: promoting this',
    '# image from staging to production is a REBUILD, not a redeploy.',
    '#',
    '# The build needs this installed workspace and cannot be done without one: the',
    '# admin\'s own build runs `endora generate` first, which renders its screen',
    '# registry over the module packages THIS instance installed. That dependency',
    '# is what keeps one module list governing all three deployables.',
    '',
    `FROM ${nodeImage(input.enginesNode)} AS build`,
    'ENV PNPM_HOME=/pnpm',
    'ENV PATH="$PNPM_HOME:$PATH"',
    ...corepack(input.packageManager),
    'WORKDIR /app',
    '',
    ...memberManifests(input),
    'RUN pnpm install --frozen-lockfile',
    '',
    'COPY . .',
    '',
    ...argDeclarations('admin'),
    '# The layer\'s own build command. It runs `endora generate` first, so the',
    '# registry the bundle is built from is this install\'s.',
    'RUN pnpm run build:admin',
    '',
    '# --- runtime: static files, and nothing else ---',
    'FROM nginx:1.27-alpine AS run',
    '# A single-page application needs every unknown path to reach index.html, or a',
    '# reload of any screen but the first answers 404.',
    "RUN printf 'server {\\n  listen 80;\\n  root /usr/share/nginx/html;\\n  location / { try_files $uri $uri/ /index.html; }\\n}\\n' \\",
    '  > /etc/nginx/conf.d/default.conf',
    'COPY --from=build /app/admin/dist /usr/share/nginx/html',
    'EXPOSE 80',
  ].join('\n')}\n`;
}

// ── the README ─────────────────────────────────────────────────────────────

function deployReadme(input: DeployInput, written: readonly string[]): string {
  const files = written.filter((path) => path !== 'README.md');
  const singleHost = input.topology === 'single-host';
  return `${[
    '# Deploying this instance',
    '',
    'Everything in this directory is an **example**. None of it is applied by anything, none',
    'of it is read back by any command, and no value in it was chosen by anybody but you: the',
    'domains are `example.com`, the secrets say `change-me`, and the registry is nowhere. Copy',
    'what you need onto the machines you run, change it, and own it from then on.',
    '',
    `These files were written for the **${input.topology}** topology, which was a flag on the`,
    'command that scaffolded this tree. The choice is recorded in no file and read by nothing —',
    'a machine layout is a fact about your machines, and the one thing this repository states',
    'about itself is the module list in the root `package.json`. Scaffold again with the other',
    'topology if you want to see its examples; nothing here has to be undone first.',
    '',
    '## What is here',
    '',
    '| File | What it is |',
    '| --- | --- |',
    ...files.map((path) => `| \`${path}\` | ${describeFile(path)} |`),
    '',
    '## Bringing it up',
    '',
    ...(singleHost
      ? [
          'One machine, one command:',
          '',
          '```',
          'docker compose --env-file .env -f compose.prod.yml up -d',
          '```',
          '',
          'The migration job runs first and the API waits for it to exit 0, so a schema change',
          'is applied before anything serves a request. Point your host nginx at the loopback',
          'ports (see `nginx.example.conf`) and let certbot handle TLS.',
        ]
      : [
          'Three machines, in this order. The order matters once, on a first bring-up: the',
          'storefront\'s first page fetch and the admin\'s first API call both need a backend',
          'that has migrated.',
          '',
          '1. **The backend host** — it owns every stateful service, the migration job and the',
          '   API:',
          '',
          '   ```',
          '   docker compose --env-file .env -f three-host/compose.backend.yml up -d',
          '   ```',
          '',
          '2. **The storefront host**:',
          '',
          '   ```',
          '   docker compose --env-file .env -f three-host/compose.storefront.yml up -d',
          '   ```',
          '',
          '3. **The admin host** — static files; it waits for nothing and can go up at any',
          '   point:',
          '',
          '   ```',
          '   docker compose --env-file .env -f three-host/compose.admin.yml up -d',
          '   ```',
          '',
          '**The three `.env` files are not interchangeable.** Each carries exactly the values',
          'its own compose file reads and nothing else — the backend\'s holds the database',
          'password and every encryption key, the storefront\'s holds one shared secret and two',
          'origins, the admin\'s holds an image tag and a port. Copying one onto another host',
          'either hands that host secrets it has no use for or leaves it starting with blanks.',
          '',
          '## What the split costs, and neither is in the diff',
          '',
          'Both are written into the files themselves, so an operator editing one meets them:',
          '',
          '1. **Every server-rendered storefront page gains a network round trip.** On one host',
          '   the SSR fetch was a bridge hop; here it is a TLS request to another machine, on',
          '   every render.',
          '2. **`REVALIDATE_SECRET` becomes a bearer secret on a public endpoint.** It never',
          '   left a private network before; now it crosses whatever is between the two hosts',
          '   on every catalogue change.',
          '',
          '## What replaces `depends_on` across hosts: nothing',
          '',
          'On one host the storefront waits for the backend to report healthy. That was a',
          'readiness convenience and never a correctness guarantee — the storefront starts fine',
          'without the backend and its first page fetch fails. Across hosts it is dropped and',
          '**not** replaced by a wait-for-it script, an init container or an orchestration',
          'dependency. Each layer starts, answers its own health check and tolerates an absent',
          'peer. The one edge whose loss would be a correctness bug — the API waiting for the',
          'migration job — is inside the backend host and is untouched.',
        ]),
    '',
    '## Building the images',
    '',
    'The Dockerfiles here build from the **root of this repository**, because the admin bundle',
    'is rendered over the module packages this instance installed and cannot be built without',
    'the install. That is not a limitation to work around: it is what keeps one module list',
    'governing every artefact you deploy.',
    '',
    ...(input.admin
      ? [
          'One more consequence of it, stated because it surprises people: the admin bundle has',
          'its API origin inlined at build time. One bundle serves one backend, and moving an',
          'admin image from staging to production is a rebuild rather than a redeploy.',
          '',
        ]
      : []),
    'The commands are in each file\'s own header, with every `--build-arg` the build reads.',
  ]
    .join('\n')
    .replace(/\n+$/, '')}\n`;
}

function describeFile(path: string): string {
  if (path === 'compose.prod.yml') {
    return 'every service on one machine: the database, the cache, the search engine, the migration job, the API, the storefront and the admin';
  }
  if (path === '.env.example') return 'what that stack reads on every start. Copy to `.env` beside it; `.env` is git-ignored';
  if (path === 'nginx.example.conf') return 'a reverse-proxy block per public name, for the nginx already on the host';
  if (path === 'three-host/compose.backend.yml') {
    return 'the backend machine: the database, the cache, the search engine, the migration job and the API. Every stateful service is here';
  }
  if (path === 'three-host/compose.storefront.yml') return 'the storefront machine: one service, reaching the API over its public origin';
  if (path === 'three-host/compose.admin.yml') return 'the admin machine: static files behind nginx, with no peer to wait for';
  if (path.startsWith('three-host/.env.')) {
    const host = path.slice('three-host/.env.'.length).replace('.example', '');
    return `what the ${host} machine reads. Copy to \`.env\` on **that** machine and no other`;
  }
  if (path === 'Dockerfile.backend') return 'an example image for the API and its queue consumers';
  if (path === 'Dockerfile.admin') return 'an example image for the admin bundle, served by nginx';
  return 'an example';
}

// ── the plan ───────────────────────────────────────────────────────────────

const SINGLE_HOST_HEADER: readonly string[] = [
  '# An EXAMPLE production stack for ONE machine.',
  '#',
  '# It pulls images by tag and wires them together; it builds nothing and it',
  '# terminates no TLS. Your own nginx does that — see nginx.example.conf — and',
  '# every service below is published on a loopback port for it to reach.',
  '#',
  '#   docker compose --env-file .env -f compose.prod.yml up -d',
  '#',
  '# `.env` sits beside this file, is git-ignored, and is yours. Nothing here was',
  '# chosen by anybody else: see .env.example for what each value decides.',
];

function threeHostHeader(host: HostName, extra: readonly string[]): readonly string[] {
  return [
    `# An EXAMPLE production stack for the ${host.toUpperCase()} machine, one of three.`,
    '#',
    `#   docker compose --env-file .env -f compose.${host}.yml up -d`,
    '#',
    `# The \`.env\` this reads is \`.env.${host}.example\`, copied onto THAT machine.`,
    '# The three are not interchangeable: each carries exactly what its own file',
    '# reads, so copying one onto another host either hands it secrets it has no',
    '# use for or starts it with blanks. See README.md for the order.',
    ...extra,
  ];
}

/**
 * Every `deploy/` file this run writes.
 *
 * They are the **client's** kind: rendered once, edited by them, and read back
 * by nothing here. A file this command would read again would be a second home
 * for a fact the manifest already holds.
 */
export function deployFiles(input: DeployInput): readonly DeployFile[] {
  const all = services(input);
  const files: DeployFile[] = [];
  const write = (path: string, content: string): void => {
    files.push({ path: `deploy/${path}`, kind: 'client', member: 'root', content });
  };

  if (input.topology === 'single-host') {
    const compose = composeDocument(SINGLE_HOST_HEADER, all);
    write('compose.prod.yml', compose);
    write(
      '.env.example',
      envExampleFor(
        [
          '# What this stack reads on every start. Copy to `.env` beside this file and fill it',
          '# in; `.env` is git-ignored and nothing here is a value anybody but you chose.',
          '#',
          '# These are the values THIS compose file expands, for a stack on a host. The',
          '# `.env.example` at the root of this repository is the one a development machine',
          '# reads and it is a different set: it names the database and the cache directly,',
          '# where the services below are named by the compose network instead.',
        ],
        compose,
        input.declared,
      ),
    );
    write('nginx.example.conf', nginxExample(input));
  } else {
    const hosts: readonly HostName[] = input.admin
      ? ['backend', 'storefront', 'admin']
      : ['backend', 'storefront'];
    for (const host of hosts) {
      const chosen = all.filter((service) => service.host === host);
      const compose = composeDocument(threeHostHeader(host, extraHeaderFor(host)), chosen);
      write(`three-host/compose.${host}.yml`, compose);
      write(
        `three-host/.env.${host}.example`,
        envExampleFor(
          [
            `# What the ${host.toUpperCase()} machine reads on every start. Copy to \`.env\` on`,
            '# THAT machine and on no other — this file holds exactly the values',
            `# \`compose.${host}.yml\` expands, and the other two hosts hold theirs.`,
          ],
          compose,
          input.declared,
        ),
      );
    }
  }

  write('Dockerfile.backend', backendDockerfile(input));
  if (input.admin) write('Dockerfile.admin', adminDockerfile(input));
  write(
    'README.md',
    deployReadme(
      input,
      files.map((file) => file.path.slice('deploy/'.length)),
    ),
  );
  return files;
}

/** The one sentence each host's header owes beyond the shared four. */
function extraHeaderFor(host: HostName): readonly string[] {
  if (host === 'backend') {
    return [
      '#',
      '# Every stateful service is here — the database, the cache and the search',
      '# engine — along with the migration job. Putting one of them on another',
      '# machine is a layout these examples have not measured.',
    ];
  }
  if (host === 'storefront') {
    return [
      '#',
      '# One service, reaching the backend over its PUBLIC origin. It waits for',
      '# nothing: it starts without the backend and its first page fetch fails,',
      '# which is what the single-host `depends_on` bought and what is deliberately',
      '# not replaced here by a wait-for-it script or an init container.',
    ];
  }
  return [
    '#',
    '# Static files behind nginx. No database, no cache, no search, no Node and no',
    '# `depends_on` — it talks to the API from the browser. It is the cheapest of',
    '# the three to move, and the one whose bundle is bound to one API origin at',
    '# build time: promoting it between environments is a rebuild.',
  ];
}
