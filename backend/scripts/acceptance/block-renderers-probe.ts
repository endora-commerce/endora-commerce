/**
 * The platform half of the block-renderers acceptance criterion
 * (`specs/141-module-block-renderers/contracts/block-renderers.md` §9, A5–A8).
 *
 * One platform process per phase, as `instance-probe.ts` runs them and for its
 * reason: the composition root is built once per process, and an activation
 * flip has to be read by a platform that booted after it. Each phase prints one
 * machine-readable line, `ACCEPTANCE_JSON {...}`; the runner judges it.
 *
 * `boot` composes once, so boot convergence registers the core modules before
 * `instance-probe.ts`'s `install` phase installs the package. `render-on` and
 * `render-off` flip the fixture module's activation Setting, boot the **real**
 * composition root against the instance the package is installed in, sign in
 * as the administrator the runner created, and ask the platform's own routes:
 *
 *   - the Page Builder descriptor — is the block declared to the editors;
 *   - a transactional e-mail preview holding the block;
 *   - a newsletter campaign holding the block, created once, previewed in every
 *     phase and read back byte for byte.
 *
 * Nothing here calls a renderer or the registry directly: what is measured is
 * what an operator's request gets.
 */

/* eslint-disable no-console -- a probe: stdout is the interface. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import type { PlatformObservation, RenderedPair } from './block-renderers-assertions.js';

const MODULE_ID = 'acceptance_blocks';
const BLOCK = 'acceptance_blocks.Badge';
const ACTIVATION_SETTING = 'acceptance_blocks.activation';
const LOGIN_PATH = '/api/v1/auth/admin/login';

class Inconclusive extends Error {}

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Inconclusive(`${name} is not set`);
  return value;
}

const badge = (id: string, text: string, explode = 'no'): unknown => ({
  type: BLOCK,
  props: { id, text, explode },
});
const tree = (content: unknown[]): unknown => ({ root: { props: {} }, content, zones: {} });
const ONE = tree([badge('b1', 'Gold')]);
const THREE = tree([badge('s1', 'Before'), badge('x1', 'Exploding', 'yes'), badge('s2', 'After')]);

async function phaseBoot(): Promise<void> {
  const { composeApp } = await import('../../src/composition.js');
  const { deploymentRoot } = await import('../../src/overlay/overlay-roots.js');
  const composition = await composeApp({ deploymentRoot: deploymentRoot() });
  await composition.dispose();
}

async function setActivation(active: boolean): Promise<void> {
  const { initOrm, closeOrm } = await import('../../src/db/index.js');
  const { Setting, enterSystemScope } = await import('@endora-commerce/platform/kernel');
  const orm = await initOrm();
  try {
    await enterSystemScope(
      'acceptance: set activation',
      async () => {
        const em = orm.em.fork();
        const setting = await em.findOne(Setting, { code: ACTIVATION_SETTING });
        if (!setting) {
          throw new Error(
            `no settings row "${ACTIVATION_SETTING}" exists, so there is no control to flip — ` +
              `the install phase did not reconcile ${MODULE_ID}'s manifest`,
          );
        }
        setting.globalValue = active;
        await em.flush();
      },
      { entryPoint: 'cli' },
    );
  } finally {
    await closeOrm().catch(() => undefined);
  }
}

async function phaseRender(active: boolean): Promise<PlatformObservation> {
  await setActivation(active);
  const statePath = env('ACCEPTANCE_STATE_FILE');
  const state = existsSync(statePath)
    ? (JSON.parse(readFileSync(statePath, 'utf8')) as { campaignId?: string })
    : {};

  const { composeApp } = await import('../../src/composition.js');
  const { deploymentRoot } = await import('../../src/overlay/overlay-roots.js');
  const { buildServer } = await import('@endora-commerce/platform/composition');
  const composition = await composeApp({ deploymentRoot: deploymentRoot() });
  try {
    const app = await buildServer({
      sessionCookieSecret: env('SESSION_COOKIE_SECRET'),
      openApi: { title: 'Block renderers probe', version: '0.0.0', serverUrl: 'http://localhost:3001' },
      modules: composition.modules,
      errorEnvelope: composition.errorEnvelope,
      apiInterceptors: composition.apiInterceptors,
      disableRateLimit: true,
    });
    try {
      const login = await app.inject({
        method: 'POST',
        url: LOGIN_PATH,
        payload: { email: env('ACCEPTANCE_ADMIN_EMAIL'), password: env('ACCEPTANCE_ADMIN_PASSWORD') },
      });
      if (login.statusCode !== 200) {
        throw new Inconclusive(`the administrator could not sign in (${String(login.statusCode)}): ${login.body.slice(0, 300)}`);
      }
      const cookie = login.cookies.map((entry) => `${entry.name}=${entry.value}`).join('; ');
      const ask = async (
        method: 'GET' | 'POST' | 'PUT',
        url: string,
        payload?: unknown,
      ): Promise<{ status: number; json: Record<string, unknown> | null; body: string }> => {
        const reply = await app.inject({
          method,
          url,
          headers: { cookie },
          ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
        });
        let json: Record<string, unknown> | null = null;
        try {
          json = JSON.parse(reply.body) as Record<string, unknown>;
        } catch {
          // not JSON — the status and the text are the answer
        }
        return { status: reply.statusCode, json, body: reply.body };
      };
      const pairOf = (reply: Awaited<ReturnType<typeof ask>>): RenderedPair => {
        const data = (reply.json?.['data'] ?? reply.json ?? {}) as Record<string, unknown>;
        return {
          status: reply.status,
          html: typeof data['html'] === 'string' ? data['html'] : '',
          text: typeof data['text'] === 'string' ? data['text'] : '',
        };
      };

      const descriptor = await ask('GET', '/api/v1/admin/cms/page-builder/config');
      const components =
        ((descriptor.json?.['data'] ?? descriptor.json) as { components?: Record<string, unknown>[] } | null)
          ?.components ?? [];
      const descriptorEntry = components.find((entry) => entry['name'] === BLOCK) ?? null;

      const emails = await ask('GET', '/api/v1/admin/transactional-emails');
      const code = ((emails.json?.['data'] as { items?: { code?: string }[] } | undefined)?.items ?? [])[0]?.code;
      if (code === undefined) {
        throw new Inconclusive(`the platform lists no transactional e-mail to preview (${String(emails.status)})`);
      }
      const preview = `/api/v1/admin/transactional-emails/${code}/preview`;
      const transactional = pairOf(await ask('POST', preview, { draftContent: ONE }));
      const transactionalExploding = pairOf(await ask('POST', preview, { draftContent: THREE }));

      let campaignId = state.campaignId;
      if (campaignId === undefined) {
        // The campaign names a sales channel. One with none answers 500 from its
        // preview route today — branding is read with an undefined channel — which
        // is a defect of that route and not this criterion's subject.
        const channels = (await composition.orm.em
          .fork()
          .getConnection()
          .execute('select id from sales_channels limit 1')) as { id: string }[];
        const salesChannelId = channels[0]?.id;
        if (salesChannelId === undefined) throw new Inconclusive('the platform has no sales channel');
        const created = await ask('POST', '/api/v1/admin/newsletter/campaigns', {
          name: 'Block renderers acceptance',
          language: 'en-US',
          subject: 'Acceptance',
          content: ONE,
          targetType: 'all',
          salesChannelId,
        });
        campaignId = ((created.json?.['data'] ?? created.json ?? {}) as { id?: string }).id;
        if (campaignId === undefined) {
          throw new Error(`the campaign holding the block could not be created (${String(created.status)}): ${created.body.slice(0, 300)}`);
        }
        writeFileSync(statePath, JSON.stringify({ campaignId }));
      }
      const newsletter = pairOf(
        await ask('POST', `/api/v1/admin/newsletter/campaigns/${campaignId}/preview`, {}),
      );
      const stored = await ask('GET', `/api/v1/admin/newsletter/campaigns/${campaignId}`);
      const storedContent = ((stored.json?.['data'] ?? stored.json ?? {}) as { content?: unknown }).content;

      // Content holding the block must be saveable whatever the owner's state:
      // off is non-destructive, and an operator editing the rest of the message
      // must not be refused because one of its blocks lost its module.
      const save = await ask(
        'PUT',
        `/api/v1/admin/transactional-emails/${code}/content?language=en-US`,
        { subject: 'Acceptance', content: ONE },
      );

      return {
        active,
        descriptorEntry,
        descriptorStatus: descriptor.status,
        transactional,
        transactionalExploding,
        newsletter,
        storedCampaignContent: JSON.stringify(storedContent ?? null),
        saveStatus: save.status,
      };
    } finally {
      await app.close();
    }
  } finally {
    await composition.dispose();
  }
}

async function main(): Promise<void> {
  const phase = process.argv[2];
  try {
    if (phase === 'boot') {
      await phaseBoot();
      console.log(`ACCEPTANCE_JSON ${JSON.stringify({ ok: true })}`);
    } else if (phase === 'render-on' || phase === 'render-off') {
      const observation = await phaseRender(phase === 'render-on');
      console.log(`ACCEPTANCE_JSON ${JSON.stringify({ observation })}`);
    } else {
      throw new Inconclusive(`unknown phase: ${String(phase)}`);
    }
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.log(
      `ACCEPTANCE_JSON ${JSON.stringify(error instanceof Inconclusive ? { inconclusive: message } : { phaseError: message })}`,
    );
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
