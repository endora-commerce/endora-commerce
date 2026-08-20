import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TransactionalEmail } from '../../../src/modules/transactional_emails/entities/transactional-email.entity.js';
import { TransactionalEmailContent } from '../../../src/modules/transactional_emails/entities/transactional-email-content.entity.js';
import {
  TransactionalEmailReconciler,
  TransactionalEmailCodeCollision,
} from '../../../src/modules/transactional_emails/services/manifest-reconciler.js';
import { EmailDefaultsRegistry } from '../../../src/modules/transactional_emails/services/email-defaults-registry.js';

const CODE = 'test_registered_email';

function manifest(id: string, codes: string[]): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    dependencies: [],
    transactionalEmails: codes.map((code) => ({ code, name: code, variables: [] })),
  } as ModuleManifest;
}

describe('transactional emails — registration + prune (US5)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('upserts a declared email, preserves customizations, and prunes when removed', async () => {
    const defaults = new EmailDefaultsRegistry();
    defaults.register(
      CODE,
      {
        defaultSubject: { 'en-US': 'Default subj' },
        defaultContent: {
          schema_version: 1,
          languages: { 'en-US': { root: { props: {} }, content: [] } },
        },
      },
      // The contributing module, required since D-39: a contribution seam
      // records who contributed, so the registry can state a policy for an
      // absent owner rather than having no way to express one.
      'test_mod',
    );
    const reconciler = new TransactionalEmailReconciler(h.em, defaults);

    // Reconcile with a manifest set that includes our test module. Real modules'
    // manifests are not passed here, so they would be pruned — guard by passing
    // them through alongside (use the registered set + ours).
    const { REGISTERED_MANIFESTS } = await import(
      '../../../src/modules/_lifecycle/registered-manifests.js'
    );
    const base = REGISTERED_MANIFESTS.map((e) => e.manifest);

    await reconciler.reconcile([...base, manifest('test_mod', [CODE])]);
    let row = await h.em().findOne(TransactionalEmail, { code: CODE });
    expect(row).toBeTruthy();
    expect(row!.defaultSubject['en-US']).toBe('Default subj');

    // Save an admin customization, then reconcile again — it must be preserved.
    const writeEm = h.em();
    writeEm.create(TransactionalEmailContent, {
      emailId: row!.id,
      salesChannelId: null,
      language: 'en-US',
      subject: 'CUSTOM',
      content: { root: { props: {} }, content: [] },
      version: 1,
    });
    await writeEm.flush();

    await reconciler.reconcile([...base, manifest('test_mod', [CODE])]);
    const content = await h.em().findOne(TransactionalEmailContent, { emailId: row!.id, language: 'en-US' });
    expect(content?.subject).toBe('CUSTOM');

    // Reconcile WITHOUT the test module — its definition (and the customization
    // via FK cascade) is pruned.
    await reconciler.reconcile(base);
    row = await h.em().findOne(TransactionalEmail, { code: CODE });
    expect(row).toBeNull();
  });

  it('rejects a cross-module code collision', async () => {
    const reconciler = new TransactionalEmailReconciler(h.em, new EmailDefaultsRegistry());
    await expect(
      reconciler.reconcile([manifest('mod_a', ['dup_code']), manifest('mod_b', ['dup_code'])]),
    ).rejects.toBeInstanceOf(TransactionalEmailCodeCollision);
  });
});
