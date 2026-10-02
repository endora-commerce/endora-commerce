/**
 * S1–S7 of `specs/110-instance-repository/contracts/instance-tree.md` §7.4, as
 * pure functions (`specs/138-separate-components/tasks.md` T10).
 *
 * The runner — `scripts/acceptance/separate-components.ts` — stands three
 * components up on three ports and observes; every judgement over what it
 * observed is here, where it can be shown **red** on an observation that
 * violates it. An assertion that cannot go red is a sentence, not a check.
 */
import { describe, expect, it } from 'vitest';

import {
  assertP1,
  assertP2,
  assertP3,
  assertP4,
  assertP5,
  assertP6,
  assertS1,
  assertS2,
  assertS3,
  assertS4,
  assertS5,
  assertS6,
  assertS7,
  compareToExpected,
  STEP_IDS_BEFORE_138,
  stepIdsOf,
  type P1Observation,
  type S3Observation,
  type S4Observation,
} from '../../../scripts/acceptance/separate-components-assertions.js';

const API = 'http://127.0.0.1:41001';
const ADMIN = 'http://127.0.0.1:41002';
const SHOP = 'http://127.0.0.1:41000';

describe('stepIdsOf — the step ids a run echoed, read off its own output', () => {
  it('names each `[n/N]` line by the command it echoes', () => {
    const output = [
      'endora install /tmp/x/api',
      '  wrote 30 files across root, deployment, backend, docs — 61 module(s)',
      '[1/5] pnpm install',
      '[2/5] pnpm run dev:services',
      '[3/5] pnpm run setup',
      '[4/5] pnpm run admin:create -- --email=a@b.c --password=<password> --first-name=A --last-name=B',
      '[5/5] pnpm run cli demo seed',
    ].join('\n');
    expect(stepIdsOf(output)).toEqual(['install', 'services', 'setup', 'admin', 'demo']);
  });

  it('a second `install` is the storefront\'s, and so is the only one of a run that wrote no tree', () => {
    const both = ['  wrote 30 files across root', '[1/3] pnpm install', '[2/3] pnpm run build:admin', '[3/3] pnpm install'].join('\n');
    expect(stepIdsOf(both)).toEqual(['install', 'build-admin', 'storefront-install']);
    const alone = ['  wrote the storefront at /tmp/shop — 433 files', '[1/1] pnpm install'].join('\n');
    expect(stepIdsOf(alone)).toEqual(['storefront-install']);
  });

  it('reads the dry run\'s list the same way, and the corepack spelling', () => {
    const dry = [
      '  would write 30 files across root, deployment, backend',
      'The pipeline it would run, in order:',
      '  corepack pnpm@9.15.0 install   # the platform',
      '  corepack pnpm@9.15.0 run setup   # generate, build',
    ].join('\n');
    expect(stepIdsOf(dry)).toEqual(['install', 'setup']);
  });

  it('a command it does not know is named as it was, never dropped', () => {
    expect(stepIdsOf('  wrote 3 files across root\n[1/1] pnpm run something:new')).toEqual([
      'unknown: pnpm run something:new',
    ]);
  });
});

describe('S1 — the API alone', () => {
  const met = {
    exitCode: 0,
    stepIds: ['install', 'services', 'setup', 'admin'],
    services: true,
    demo: false,
    adminDirExists: false,
    storefrontWritten: false,
    health: 200,
    port: 41001,
  };

  it('passes on the observation the contract describes', () => {
    expect(assertS1(met).status).toBe('pass');
    expect(assertS1({ ...met, services: false, stepIds: ['install', 'setup', 'admin'] }).status).toBe('pass');
    expect(
      assertS1({ ...met, demo: true, stepIds: ['install', 'services', 'setup', 'admin', 'demo'] }).status,
    ).toBe('pass');
  });

  it.each([
    ['the run failed', { exitCode: 1 }],
    ['an admin member was written', { adminDirExists: true }],
    ['a storefront was written', { storefrontWritten: true }],
    ['a step the selection removed ran', { stepIds: ['install', 'services', 'setup', 'admin', 'storefront-install'] }],
    ['demo rows were asked for and never seeded', { demo: true }],
    ['the API does not answer', { health: null }],
    ['the API answers unhealthy', { health: 503 }],
    ['it listens on a development default', { port: 3001 }],
  ])('is red when %s', (_name, change) => {
    expect(assertS1({ ...met, ...change }).status).toBe('fail');
  });
});

describe('S2 — the admin alone, with no database and no service', () => {
  const met = {
    exitCode: 0,
    stepIds: ['install', 'build-admin'],
    distExists: true,
    apiOrigin: API,
    bundleNamesApiOrigin: true,
    bundleNamesDefaultOrigin: false,
    serviceAddressesInEnvironment: [] as string[],
    containersStartedForIt: [] as string[],
  };

  it('passes on the observation the contract describes', () => {
    expect(assertS2(met).status).toBe('pass');
  });

  it.each([
    ['the run failed', { exitCode: 2 }],
    ['it ran the API\'s steps', { stepIds: ['install', 'setup', 'build-admin'] }],
    ['no bundle was built', { distExists: false }],
    ['the bundle does not name the API it was given', { bundleNamesApiOrigin: false }],
    ['the bundle still names the compiled-in default', { bundleNamesDefaultOrigin: true }],
    ['the run was handed a database address', { serviceAddressesInEnvironment: ['DATABASE_URL'] }],
    ['a service was started for it', { containersStartedForIt: ['admin-postgres-1'] }],
  ])('is red when %s', (_name, change) => {
    expect(assertS2({ ...met, ...change }).status).toBe('fail');
  });
});

describe('S3 — a browser on the admin\'s origin signs in to the API', () => {
  const met: S3Observation = {
    origin: ADMIN,
    adminIndex: { status: 200 },
    preflight: { allowOrigin: ADMIN, allowCredentials: 'true' },
    login: { status: 200, allowOrigin: ADMIN, allowCredentials: 'true', sessionCookie: true },
    authenticated: { status: 200 },
    anonymous: { status: 401 },
    foreignPreflight: { origin: 'http://127.0.0.1:9', allowOrigin: null },
  };

  it('passes on the observation the contract describes', () => {
    expect(assertS3(met).status).toBe('pass');
  });

  it.each<[string, Partial<S3Observation>]>([
    ['the bundle is not served at that origin', { adminIndex: { status: null } }],
    ['the preflight does not echo the origin', { preflight: { allowOrigin: null, allowCredentials: 'true' } }],
    ['the preflight allows any origin', { preflight: { allowOrigin: '*', allowCredentials: 'true' } }],
    ['credentials are not allowed', { preflight: { allowOrigin: ADMIN, allowCredentials: null } }],
    ['the sign-in is refused', { login: { status: 401, allowOrigin: ADMIN, allowCredentials: 'true', sessionCookie: false } }],
    ['the sign-in sets no cookie', { login: { status: 200, allowOrigin: ADMIN, allowCredentials: 'true', sessionCookie: false } }],
    ['the sign-in answer is not readable from that origin', { login: { status: 200, allowOrigin: null, allowCredentials: 'true', sessionCookie: true } }],
    ['the cookie does not authenticate the next request', { authenticated: { status: 401 } }],
    ['the route answers without a cookie too', { anonymous: { status: 200 } }],
    ['an origin outside the list is let in', { foreignPreflight: { origin: 'http://127.0.0.1:9', allowOrigin: 'http://127.0.0.1:9' } }],
  ])('is red when %s', (_name, change) => {
    expect(assertS3({ ...met, ...change }).status).toBe('fail');
  });
});

describe('S4 — the storefront alone', () => {
  const met: S4Observation = {
    exitCode: 0,
    stepIds: ['storefront-install'],
    instanceTreeExists: false,
    env: {
      NEXT_PUBLIC_API_BASE_URL: API,
      BACKEND_BASE_URL: API,
      NEXT_PUBLIC_SITE_URL: SHOP,
      NEXT_PUBLIC_SALES_CHANNEL_CODE: 'default',
      REVALIDATE_SECRET: 'the-secret',
    },
    expected: { apiOrigin: API, siteOrigin: SHOP, salesChannel: 'default', secret: 'the-secret' },
    port: 41000,
    home: { status: 200 },
    product: { link: '/p/demo-1', status: 200, heading: 'A demo product' },
  };

  it('passes on the observation the contract describes', () => {
    expect(assertS4(met).status).toBe('pass');
  });

  it.each<[string, Partial<S4Observation>]>([
    ['the run failed', { exitCode: 1 }],
    ['an instance tree was written', { instanceTreeExists: true }],
    ['it ran more than its own install', { stepIds: ['install', 'storefront-install'] }],
    ['a value of the five is missing', { env: { ...met.env, NEXT_PUBLIC_SITE_URL: undefined } }],
    ['a value of the five is not the one given', { env: { ...met.env, BACKEND_BASE_URL: 'http://localhost:3001' } }],
    ['the secret is another one', { env: { ...met.env, REVALIDATE_SECRET: 'generated-here' } }],
    ['the home page does not answer', { home: { status: 500 } }],
    ['nothing of the API\'s data was rendered', { product: null }],
    ['the product page renders no heading', { product: { link: '/p/demo-1', status: 200, heading: '' } }],
    ['it listens on a development default', { port: 3000 }],
  ])('is red when %s', (_name, change) => {
    expect(assertS4({ ...met, ...change }).status).toBe('fail');
  });
});

describe('S5 — one secret, two machines', () => {
  const met = {
    withTheSecret: { status: 200 },
    withAnother: { status: 401 },
    apiSecret: 'the-secret',
    storefrontSecret: 'the-secret',
  };

  it('passes on the observation the contract describes', () => {
    expect(assertS5(met).status).toBe('pass');
  });

  it.each([
    ['the route refuses the right secret', { withTheSecret: { status: 401 } }],
    ['the route accepts any secret', { withAnother: { status: 200 } }],
    ['the two files hold different values', { storefrontSecret: 'another' }],
    ['the API holds none', { apiSecret: undefined }],
  ])('is red when %s', (_name, change) => {
    expect(assertS5({ ...met, ...change }).status).toBe('fail');
  });
});

describe('S6 — a run with no `--only` plans what it planned before', () => {
  it('passes on the recorded list, with and without the optional steps', () => {
    expect(assertS6({ stepIds: [...STEP_IDS_BEFORE_138], services: true, demo: true, storefront: true }).status).toBe('pass');
    expect(
      assertS6({ stepIds: ['install', 'setup', 'admin'], services: false, demo: false, storefront: false }).status,
    ).toBe('pass');
  });

  it.each([
    ['a step was added', ['install', 'services', 'setup', 'build-admin', 'admin', 'demo', 'storefront-install']],
    ['a step is missing', ['install', 'services', 'setup', 'demo', 'storefront-install']],
    ['the order changed', ['install', 'setup', 'services', 'admin', 'demo', 'storefront-install']],
  ])('is red when %s', (_name, stepIds) => {
    expect(assertS6({ stepIds, services: true, demo: true, storefront: true }).status).toBe('fail');
  });
});

describe('S7 — what a selection refuses', () => {
  const refusal = (...names: string[]) => ({
    exitCode: 1,
    output: `endora: \`endora install\` cannot run yet — 1 thing to settle first:\n  - ${names.join(' ')}\n\nNothing was written and nothing was started.`,
    wrote: false,
  });
  const met = [
    { name: '--only admin', mustName: ['--api-url'], ...refusal('`--api-url` is required') },
    { name: '--only storefront --demo', mustName: ['--demo'], ...refusal('`--demo` answers a question') },
  ];

  it('passes when each exits 1, names what it must, and writes nothing', () => {
    expect(assertS7(met).status).toBe('pass');
  });

  it('is red when a case exits 0', () => {
    expect(assertS7([{ ...met[0]!, exitCode: 0 }, met[1]!]).status).toBe('fail');
  });

  it('is red when a case does not name what is missing', () => {
    expect(assertS7([{ ...met[0]!, mustName: ['--storefront-url'] }, met[1]!]).status).toBe('fail');
  });

  it('is red when a refused run left something on disk', () => {
    expect(assertS7([met[0]!, { ...met[1]!, wrote: true }]).status).toBe('fail');
  });

  it('is red when the refusal is not one refusal', () => {
    const twice = { ...met[0]!, output: `${met[0]!.output}\n${met[0]!.output}` };
    expect(assertS7([twice, met[1]!]).status).toBe('fail');
  });

  it('is unmeasured over no cases at all', () => {
    expect(assertS7([]).status).toBe('unmeasured');
  });
});

describe('the ratchet — drift against the recorded state, in both directions', () => {
  const expected = { S1: 'pass', S2: 'pass' } as const;
  const verdict = (id: string, status: 'pass' | 'fail' | 'unmeasured') => ({ id, title: id, status, detail: '' });

  it('no drift is exit 0', () => {
    expect(compareToExpected([verdict('S1', 'pass'), verdict('S2', 'pass')], expected)).toEqual({ exitCode: 0, drift: [] });
  });

  it('a regression is exit 1, named', () => {
    const result = compareToExpected([verdict('S1', 'fail'), verdict('S2', 'pass')], expected);
    expect(result.exitCode).toBe(1);
    expect(result.drift).toEqual(['S1: recorded pass, observed fail']);
  });

  it('an improvement is drift too: the record is stale', () => {
    const result = compareToExpected([verdict('S1', 'pass')], { S1: 'fail' });
    expect(result.exitCode).toBe(1);
  });

  it('an assertion that could not be measured is exit 2, never a pass', () => {
    expect(compareToExpected([verdict('S1', 'unmeasured'), verdict('S2', 'pass')], expected).exitCode).toBe(2);
  });

  it('an assertion the record names and the run never produced is exit 2', () => {
    expect(compareToExpected([verdict('S1', 'pass')], expected).exitCode).toBe(2);
  });
});

/**
 * P1–P6 — layout (b) of D-284 clause 5: one host with paths
 * (`specs/138-separate-components/` addendum, FR-032; contract §7.6).
 */
describe('P1 — `--public-url` writes one host into all three', () => {
  const HOST = 'http://localhost:41080';
  const met: P1Observation = {
    exitCode: 0,
    host: HOST,
    instanceEnv: {
      PUBLIC_API_BASE_URL: HOST,
      STOREFRONT_BASE_URL: HOST,
      ADMIN_BASE_URL: `${HOST}/admin`,
      CORS_ALLOWED_ORIGINS: HOST,
    },
    adminEnv: { VITE_API_BASE_URL: HOST, ADMIN_BASE_PATH: '/admin/' },
    storefrontEnv: { NEXT_PUBLIC_API_BASE_URL: HOST, NEXT_PUBLIC_SITE_URL: HOST, PORT: '41000' },
    storefrontPort: 41000,
    adminIndexReferences: ['/admin/assets/index-abc.js'],
  };

  it('passes on the observation the contract describes', () => {
    expect(assertP1(met).status).toBe('pass');
  });

  it.each<[string, Partial<P1Observation>]>([
    ['the run failed', { exitCode: 1 }],
    ['the allow-list names the host twice', { instanceEnv: { ...met.instanceEnv, CORS_ALLOWED_ORIGINS: `${HOST},${HOST}` } }],
    ['the admin address lost its path', { instanceEnv: { ...met.instanceEnv, ADMIN_BASE_URL: HOST } }],
    ['the API was given a path', { adminEnv: { ...met.adminEnv, VITE_API_BASE_URL: `${HOST}/api` } }],
    ['the admin was built for the root', { adminEnv: { VITE_API_BASE_URL: HOST } }],
    ['the bundle asks for its assets at the root', { adminIndexReferences: ['/assets/index-abc.js'] }],
    ['the proxy\'s port was taken as the storefront\'s', { storefrontEnv: { ...met.storefrontEnv, PORT: '41080' } }],
    ['the storefront was not told the host', { storefrontEnv: { ...met.storefrontEnv, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' } }],
  ])('is red when %s', (_name, change) => {
    expect(assertP1({ ...met, ...change }).status).toBe('fail');
  });
});

describe('P2 — the API under /api, and the two routes that are not where their prefix suggests', () => {
  const met = {
    health: 200,
    revalidateWithTheSecret: 200,
    revalidateWithAnother: 401,
    revalidateAnsweredBy: 'storefront' as const,
    assetRouteAnsweredBy: 'api' as const,
  };

  it('passes on the observation the contract describes', () => {
    expect(assertP2(met).status).toBe('pass');
  });

  it.each([
    ['the API does not answer under the host', { health: 502 }],
    ['/api/revalidate went to the API', { revalidateAnsweredBy: 'api' as const, revalidateWithTheSecret: 404 }],
    ['the storefront accepts any secret', { revalidateWithAnother: 200 }],
    ['/assets/file/ went to the storefront', { assetRouteAnsweredBy: 'storefront' as const }],
  ])('is red when %s', (_name, change) => {
    expect(assertP2({ ...met, ...change }).status).toBe('fail');
  });
});

describe('P3 — the admin under /admin', () => {
  const met = {
    bare: { status: 301, location: 'http://localhost:41080/admin/' },
    index: { status: 200, isAdmin: true },
    asset: { path: '/admin/assets/index-abc.js', status: 200, contentType: 'application/javascript' },
    deepLink: { path: '/admin/platform/modules', status: 200, isAdmin: true },
  };

  it('passes on the observation the contract describes', () => {
    expect(assertP3(met).status).toBe('pass');
  });

  it.each([
    ['/admin does not redirect into the base path', { bare: { status: 200, location: null } }],
    ['/admin/ is not the admin', { index: { status: 200, isAdmin: false } }],
    ['an asset is answered with a page', { asset: { ...met.asset, contentType: 'text/html' } }],
    ['an asset is missing', { asset: { ...met.asset, status: 404 } }],
    ['a reloaded screen is a 404', { deepLink: { ...met.deepLink, status: 404 } }],
    ['a reloaded screen is the storefront', { deepLink: { ...met.deepLink, isAdmin: false } }],
  ])('is red when %s', (_name, change) => {
    expect(assertP3({ ...met, ...change }).status).toBe('fail');
  });
});

describe('P4 — an administrator signs in on the one host', () => {
  const met = { login: { status: 200, sessionCookie: true }, authenticated: 200, anonymous: 401 };

  it('passes on the observation the contract describes', () => {
    expect(assertP4(met).status).toBe('pass');
  });

  it.each([
    ['the sign-in is refused', { login: { status: 401, sessionCookie: false } }],
    ['no cookie is set', { login: { status: 200, sessionCookie: false } }],
    ['the cookie does not authenticate', { authenticated: 401 }],
    ['the route is open anyway', { anonymous: 200 }],
  ])('is red when %s', (_name, change) => {
    expect(assertP4({ ...met, ...change }).status).toBe('fail');
  });
});

describe('P5 — the storefront at /', () => {
  const met = { home: 200, product: { link: '/p/demo-1', status: 200, heading: 'A demo product' } };

  it('passes on the observation the contract describes', () => {
    expect(assertP5(met).status).toBe('pass');
  });

  it.each([
    ['the home page fails', { home: 500 }],
    ['no product is linked', { product: null }],
    ['the product renders nothing', { product: { link: '/p/demo-1', status: 200, heading: '' } }],
  ])('is red when %s', (_name, change) => {
    expect(assertP5({ ...met, ...change }).status).toBe('fail');
  });
});

describe('P6 — the routing is the instance\'s own example, with nothing but the addresses changed', () => {
  const example = [
    'server {',
    '    listen 80;',
    '    listen [::]:80;',
    '    server_name example.com;',
    '    location /api/ {',
    '        proxy_pass http://127.0.0.1:3001;',
    '        proxy_set_header X-Forwarded-Host  $http_host;',
    '    }',
    '}',
  ].join('\n');
  const used = example
    .replace('    listen 80;\n    listen [::]:80;', '    listen 127.0.0.1:41080;')
    .replace('example.com', 'localhost')
    .replace('127.0.0.1:3001', '127.0.0.1:41001');

  it('passes when only listen, server_name and proxy_pass lines differ', () => {
    expect(assertP6({ example, used }).status).toBe('pass');
  });

  it('is red when a route was added by hand', () => {
    expect(assertP6({ example, used: used.replace('location /api/ {', 'location /api/v1/ {') }).status).toBe('fail');
  });

  it('is red when a header was changed by hand', () => {
    expect(assertP6({ example, used: used.replace('$http_host', '$host:41080') }).status).toBe('fail');
  });
});
