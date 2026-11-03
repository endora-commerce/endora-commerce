import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  PROJECT_ATTACHMENT_MAX_BYTES,
  ProjectAttachmentListResponseSchema,
  ProjectAttachmentResponseSchema,
  type AssetReferenceRegistryPort,
  type ProjectAttachment,
  type ProjectDetail,
} from '@endora-commerce/contracts';
import { EventBus } from '@endora-commerce/platform/events';
import { composeModules, createRootContainer, registerValues } from '@endora-commerce/platform/composition';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { AssetReferenceRegistry } from '../../../../packages/modules/assets_library/src/backend/services/reference-registry.js';
import { AssetsLibraryService } from '../../../../packages/modules/assets_library/src/backend/services/assets-library.service.js';
import { AssetVisibility } from '../../../../packages/modules/assets_library/src/backend/services/asset-visibility.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { Asset } from '../../helpers/package-entities.js';
import { removeCrmAssets, seedCrmAdmin, seedCrmAsset } from '../../helpers/seed-crm.js';
import { multipartBody, TINY_PNG, useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  PROJECTS_ADMIN,
  PROJECTS_API,
  callProjects,
  createProject,
  deleteProjects,
  errorShape,
  setProjectsVisibility,
} from './helpers.js';

/**
 * User Story 7 — files attached to a Project
 * (`specs/163-projects-and-tasks/spec.md` FR-027; research R-17;
 * `contracts/admin-api.md` §2.4).
 *
 * The bytes are the asset library's: an attachment is an asset id held by
 * value, private, live and never active content. The upload stores the file
 * first and attaches it second, and takes the file back when attaching fails.
 * The download link is resolved here, as a download. The library refuses to
 * delete a file a Project uses, naming the Project by number — also while
 * Projects is switched off. Every attach and removal is audited.
 */
describe('projects — attachments (US7)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let writer: Person;
  let withLibrary: Person;
  let outsider: Person;
  let project: ProjectDetail;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  const created: string[] = [];
  const assets: string[] = [];

  function uploadRaw(
    projectId: string,
    file: { filename: string; mime?: string; value: Buffer | string },
    who?: Person,
  ) {
    const { body, contentType } = multipartBody([{ name: 'file', ...file }]);
    return h.app.inject({
      method: 'POST',
      url: `${PROJECTS_API}/${projectId}/attachments/upload`,
      headers: { 'content-type': contentType },
      cookies: who?.cookies ?? PROJECTS_ADMIN,
      payload: body,
    });
  }

  async function upload(
    projectId: string,
    file: { filename: string; mime?: string; value: Buffer | string },
    who?: Person,
  ) {
    const response = await uploadRaw(projectId, file, who);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = ProjectAttachmentResponseSchema.parse(response.json());
    assets.push(data.assetId);
    return data;
  }

  async function list(projectId: string, who?: Person): Promise<ProjectAttachment[]> {
    const response = await callProjects(h, 'GET', `/${projectId}/attachments`, who ? { cookies: who.cookies } : {});
    expect(response.statusCode, response.body).toBe(200);
    return ProjectAttachmentListResponseSchema.parse(response.json()).data;
  }

  const asset = async (overrides: Parameters<typeof seedCrmAsset>[1] = {}) => {
    const seeded = await seedCrmAsset(h.em(), overrides);
    assets.push(seeded.id);
    return seeded;
  };

  const registry = () => h.container.resolve<AssetReferenceRegistryPort>('assetReferenceRegistry');
  const audit = async (objectId: string) =>
    (await h.auditLogService.query({ objectType: 'project', objectId })).map((row) => ({
      action: row.action,
      before: row.stateBefore,
      after: row.stateAfter,
    }));

  beforeAll(async () => {
    h = await setupBackendServer();
    await setProjectsVisibility(h, 'members');
    store = await useTemporaryAssetStore(h);
    writer = await seedCrmAdmin(h.em(), 'att-writer', ['projects:read', 'projects:write']);
    withLibrary = await seedCrmAdmin(h.em(), 'att-library', ['projects:read', 'projects:write', 'assets.read']);
    outsider = await seedCrmAdmin(h.em(), 'att-outsider', ['projects:read', 'projects:write', 'assets.read']);
    project = await createProject(h, {
      title: 'Attachments',
      organizationIds: [TEST_ORGANIZATION_ID],
      members: [writer, withLibrary].map((p) => ({ adminUserId: p.adminUserId, roleIds: [] })),
    });
    created.push(project.id);
  });

  afterAll(async () => {
    for (const p of [writer, withLibrary, outsider]) p?.undo();
    await deleteProjects(h, created);
    await removeCrmAssets(h.em(), assets);
    await store.undo();
    await teardownBackendServer(h);
  });

  it('uploads and attaches a private file for somebody holding only Projects codes, lists it as a download, and removes it — audited', async () => {
    const attached = await upload(project.id, { filename: 'plan.png', mime: 'image/png', value: TINY_PNG }, writer);
    expect(attached).toMatchObject({
      fileName: 'plan.png',
      mimeType: 'image/png',
      uploadedBy: { id: writer.adminUserId },
    });
    expect(attached.sizeBytes).toBe(TINY_PNG.byteLength);
    const stored = await h.em().findOneOrFail(Asset, { id: attached.assetId }, { filters: false });
    expect(stored.visibility).toBe('private');

    const listed = await list(project.id, writer);
    expect(listed.map((row) => row.id)).toEqual([attached.id]);
    expect(listed[0]?.url).toMatch(/[?&]download=1/);

    const removed = await callProjects(h, 'DELETE', `/${project.id}/attachments/${attached.id}`, {
      cookies: writer.cookies,
    });
    expect(removed.statusCode, removed.body).toBe(204);
    expect(await list(project.id)).toEqual([]);
    // The file stays in the library.
    expect(
      (await h.em().findOneOrFail(Asset, { id: attached.assetId }, { filters: false })).deletedAt ?? null,
    ).toBeNull();

    const trail = (await audit(project.id)).filter((row) => row.action.startsWith('projects.project.attachment_'));
    expect(trail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'projects.project.attachment_add',
          after: expect.objectContaining({ attachmentId: attached.id, assetId: attached.assetId }),
        }),
        expect.objectContaining({
          action: 'projects.project.attachment_remove',
          before: expect.objectContaining({ attachmentId: attached.id, assetId: attached.assetId }),
        }),
      ]),
    );
  });

  it('takes the stored file back when attaching it fails (compensation)', async () => {
    const service = h.container.resolve<{ add: (...args: unknown[]) => Promise<unknown> }>('projectsAttachmentService');
    const spy = vi.spyOn(service, 'add').mockRejectedValueOnce(new Error('attach failed'));
    try {
      const response = await uploadRaw(project.id, {
        filename: 'orphan.png',
        mime: 'image/png',
        value: TINY_PNG,
      });
      expect(response.statusCode, response.body).toBe(500);
    } finally {
      spy.mockRestore();
    }
    const rows = await h.em().find(Asset, { filename: 'orphan.png' }, { filters: false });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      assets.push(row.id);
      expect(row.deletedAt).toBeInstanceOf(Date);
    }
    expect(await list(project.id)).toEqual([]);
  });

  it('refuses active content — 415, nothing stored', async () => {
    for (const file of [
      { filename: 'page.html', mime: 'text/html', value: '<script>1</script>' },
      { filename: 'image.svg', mime: 'image/svg+xml', value: '<svg/>' },
    ]) {
      const response = await uploadRaw(project.id, file);
      expect(response.statusCode, response.body).toBe(415);
      expect(response.json().error.code).toBe(ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED);
      expect(await h.em().count(Asset, { filename: file.filename }, { filters: false })).toBe(0);
    }
  });

  /**
   * Issue #623: the refusal carries `details.code: 'attachment_active_content'`,
   * which picks the asset library's attachment sentence. Without it the
   * envelope answered the library's generic "cannot be uploaded to the asset
   * library", which names the wrong place and none of the refused types.
   * An administrator's language is the stored preference, not a header.
   */
  it('says, in English and Polish, that the file cannot be an attachment and which types are refused', async () => {
    const setLanguage = async (preferredLanguage: 'en' | 'pl' | null) => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/me/preferred-language',
        cookies: PROJECTS_ADMIN,
        payload: { preferredLanguage },
      });
      expect(res.statusCode, res.body).toBe(200);
    };
    const refuse = () =>
      uploadRaw(project.id, { filename: 'page.html', mime: 'text/html', value: '<script>1</script>' });
    try {
      await setLanguage('en');
      const en = await refuse();
      expect(en.statusCode, en.body).toBe(415);
      const enError = en.json().error as { code: string; message: string; details?: unknown };
      expect(enError.code).toBe(ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED);
      expect(enError.details).toEqual({ code: 'attachment_active_content' });
      expect(enError.message).toBe(
        'HTML, SVG, XML and JavaScript files cannot be attachments: a browser would open and run them.',
      );

      await setLanguage('pl');
      const pl = await refuse();
      expect(pl.statusCode, pl.body).toBe(415);
      const plError = pl.json().error as { code: string; message: string };
      expect(plError.code).toBe(ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED);
      expect(plError.message).toBe(
        'Pliki HTML, SVG, XML i JavaScript nie mogą być załącznikami: przeglądarka by je otworzyła i uruchomiła.',
      );
      expect(plError.message).not.toBe(enError.message);
      expect(plError.message).not.toMatch(/biblioteki zasobów|cannot be|\{/);
    } finally {
      // The preference outlives this file in a single-fork run.
      await setLanguage(null);
    }
  });

  it('refuses a file larger than an attachment may be — 413 PROJECT_ATTACHMENT_TOO_LARGE', async () => {
    const response = await uploadRaw(project.id, {
      filename: 'too-large.bin',
      value: Buffer.alloc(PROJECT_ATTACHMENT_MAX_BYTES + 1, 0x41),
    });
    expect(response.statusCode, response.body.slice(0, 400)).toBe(413);
    expect(response.json().error.code).toBe('PROJECT_ATTACHMENT_TOO_LARGE');
  });

  describe('attaching a file of the library by its id', () => {
    it('needs the library’s read code beside projects:write', async () => {
      const file = await asset();
      const refused = await callProjects(h, 'POST', `/${project.id}/attachments`, {
        payload: { assetId: file.id },
        cookies: writer.cookies,
      });
      expect(refused.statusCode, refused.body).toBe(403);
      const ok = await callProjects(h, 'POST', `/${project.id}/attachments`, {
        payload: { assetId: file.id },
        cookies: withLibrary.cookies,
      });
      expect(ok.statusCode, ok.body).toBe(201);
      // The same file again answers what exists and writes nothing.
      const again = await callProjects(h, 'POST', `/${project.id}/attachments`, {
        payload: { assetId: file.id },
        cookies: withLibrary.cookies,
      });
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json().data.id).toBe(ok.json().data.id);
    });

    it('refuses a public file (422), active content (415) and a file that is not there (422)', async () => {
      const publicFile = await asset({ visibility: 'public' });
      const svg = await asset({ filename: 'logo.svg', mimeType: 'image/svg+xml' });
      const gone = await asset();
      await h.em().getConnection().execute(`update "assets" set "deleted_at" = now() where "id" = ?`, [gone.id]);
      const attach = (assetId: string) =>
        callProjects(h, 'POST', `/${project.id}/attachments`, { payload: { assetId } });
      const pub = await attach(publicFile.id);
      expect(pub.statusCode, pub.body).toBe(422);
      const active = await attach(svg.id);
      expect(active.statusCode, active.body).toBe(415);
      expect(active.json().error.code).toBe(ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED);
      const missing = await attach(gone.id);
      expect(missing.statusCode, missing.body).toBe(422);
    });

    it('a file attached to a Project the caller may not see is not there to them', async () => {
      const hiddenProject = await createProject(h, {
        title: 'Hidden holder',
        members: [{ adminUserId: writer.adminUserId, roleIds: [] }],
      });
      created.push(hiddenProject.id);
      const file = await asset();
      expect(
        (
          await callProjects(h, 'POST', `/${hiddenProject.id}/attachments`, {
            payload: { assetId: file.id },
          })
        ).statusCode,
      ).toBe(201);
      const mine = await createProject(h, {
        title: 'Outsider’s own',
        members: [{ adminUserId: outsider.adminUserId, roleIds: [] }],
      });
      created.push(mine.id);
      const refused = await callProjects(h, 'POST', `/${mine.id}/attachments`, {
        payload: { assetId: file.id },
        cookies: outsider.cookies,
      });
      expect(refused.statusCode, refused.body).toBe(422);
    });
  });

  describe('the library refuses to delete a file a Project uses', () => {
    it('names the Project by number while attached, and lets go after removal', async () => {
      const attached = await upload(project.id, {
        filename: 'kept.png',
        mime: 'image/png',
        value: TINY_PNG,
      });
      expect(registry().owners()).toContain('projects');
      expect(await registry().findReferences(attached.assetId)).toEqual([
        { kind: 'project_attachment', entityId: project.id, label: `Project ${project.number}`, assetId: attached.assetId },
      ]);
      const refused = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/assets/${attached.assetId}`,
        cookies: PROJECTS_ADMIN,
      });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().error.code).toBe(ERROR_CODES.ASSET_REFERENCED);
      expect(refused.body).toContain(`Project ${project.number}`);

      await withModuleOff('projects', 'deactivated', async () => {
        expect((await registry().findReferences(attached.assetId)).map((r) => r.kind)).toEqual(['project_attachment']);
      });

      expect((await callProjects(h, 'DELETE', `/${project.id}/attachments/${attached.id}`)).statusCode).toBe(204);
      expect(await registry().findReferences(attached.assetId)).toEqual([]);
    });

    /**
     * The case above measures a deactivation **at runtime**: the scanner was
     * registered when the platform booted with Projects on. This one boots with
     * Projects already off — CRM's precedent, `integration/crm/attachments.test.ts`
     * "after booting with crm deactivated": the module is composed **while it is
     * off**, against a registry of its own, and the library is then asked to
     * delete a file a Project uses. A boot hook that probed presence would
     * register nothing here, and the delete would go through (T135).
     */
    describe('after booting with projects deactivated', () => {
      const libraryOver = (own: AssetReferenceRegistry): AssetsLibraryService =>
        new AssetsLibraryService({
          emFactory: () => h.em(),
          adapters: h.assetsLibrary.adapters,
          referenceRegistry: own,
          // Feature 166: the library's visibility rule over the same registry, for the
          // system actor — this test is about enumeration, which no reader narrows.
          visibility: new AssetVisibility({
            registry: own,
            isPresent: () => true,
            permissions: () => ({ listPermissions: async () => [] }),
            tenantContext: () => ({ actor: { kind: 'system' } }),
          }),
          loadUploadPolicy: async () => ({ allowedTypes: ['*'], maxFileSizeMb: 0 }),
        });

      async function bootProjectsInto(own: AssetReferenceRegistry): Promise<void> {
        // The published artefact, by bare specifier — the copy the composed
        // platform holds (`check:singleton-identity`).
        const { registerModule } = await import('@endora-commerce/mod-projects/backend');
        const container = createRootContainer();
        const inert = { register: () => undefined };
        registerValues(container, {
          emFactory: () => h.em(),
          assetReferenceRegistry: own,
          // The module's other contribution hooks push into registries their
          // owners keep; none is composed here.
          taskContextRegistry: inert,
          settingWriteValidatorRegistry: inert,
          adminSearchProviderRegistry: inert,
          emailDefaultsPort: inert,
          auditReferenceRegistry: { register: () => undefined, owners: () => [], resolve: async () => new Map() },
        });
        const composed = composeModules([{ id: 'projects', version: '1.0.0', registerModule }], {
          container,
          eventBus: new EventBus(),
          log: { info: () => {}, warn: () => {}, error: () => {} },
        });
        await composed.runBootHooks();
      }

      it('refuses the delete, naming the Project', async () => {
        const attached = await upload(project.id, { filename: 'booted-off.png', mime: 'image/png', value: TINY_PNG });
        const own = new AssetReferenceRegistry();

        await withModuleOff('projects', 'deactivated', async () => {
          await bootProjectsInto(own);
          expect(
            own.owners(),
            'a deployment that boots with `projects` off registered no projects scanner, so nothing ' +
              'stands between an operator and a file a deactivated Project still uses',
          ).toContain('projects');
          await expect(libraryOver(own).softDelete(attached.assetId)).rejects.toMatchObject({
            statusCode: 409,
            code: ERROR_CODES.ASSET_REFERENCED,
          });
          expect(await own.findReferences(attached.assetId)).toEqual([
            { kind: 'project_attachment', entityId: project.id, label: `Project ${project.number}`, assetId: attached.assetId },
          ]);
        });

        // The control: the same delete succeeds with no scanner registered.
        const deleted = await libraryOver(new AssetReferenceRegistry()).softDelete(attached.assetId);
        expect(deleted.deletedAt).toBeInstanceOf(Date);
      });
    });
  });

  describe('a Project the caller may not see', () => {
    it('answers every attachment route as for a Project that does not exist, and stores nothing', async () => {
      const attached = await upload(project.id, {
        filename: 'hidden.png',
        mime: 'image/png',
        value: TINY_PNG,
      });
      const missing = '00000000-0000-4000-8000-000000000000';
      for (const [method, path, payload] of [
        ['GET', '/:id/attachments', undefined],
        ['POST', '/:id/attachments', { assetId: attached.assetId }],
        ['DELETE', `/:id/attachments/${attached.id}`, undefined],
      ] as const) {
        const hidden = await callProjects(h, method, path.replace(':id', project.id), {
          cookies: outsider.cookies,
          ...(payload ? { payload } : {}),
        });
        const none = await callProjects(h, method, path.replace(':id', missing), {
          cookies: outsider.cookies,
          ...(payload ? { payload } : {}),
        });
        expect(hidden.statusCode, `${method} ${path}: ${hidden.body}`).toBe(404);
        expect(errorShape(hidden.body)).toEqual(errorShape(none.body));
      }
      const before = await h.em().count(Asset, { filename: 'not-stored.png' }, { filters: false });
      const refused = await uploadRaw(
        project.id,
        { filename: 'not-stored.png', mime: 'image/png', value: TINY_PNG },
        outsider,
      );
      expect(refused.statusCode, refused.body).toBe(404);
      expect(await h.em().count(Asset, { filename: 'not-stored.png' }, { filters: false })).toBe(before);
    });
  });

  /**
   * FR-006 (`specs/166-asset-reference-visibility/` research R-13, F-19): a file
   * the library hides from the caller is not there to attach. Here it is held
   * by **another** module's record — a private Task of somebody else, which a
   * reader holding `tasks:read` without `tasks:see_private` may not see — so
   * Projects' own holder check cannot see it; and one of the two is **public**,
   * so the refusal must come before the private-file one to give the
   * missing-file sentence.
   */
  describe('attaching a file the library hides from the caller (feature 166, FR-006)', () => {
    const privateTask = randomUUID();
    let reader: Person;

    beforeAll(async () => {
      reader = await seedCrmAdmin(h.em(), 'att-fr6', ['projects:read', 'projects:write', 'tasks:read', 'assets.read']);
      await h
        .em()
        .getConnection()
        .execute(
          `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_private") values (?, ?, 'Private', ?, true)`,
          [privateTask, `T-F6-${privateTask.slice(0, 8)}`, TEST_ADMIN_ID],
        );
    });

    afterAll(async () => {
      reader?.undo();
      await h.em().getConnection().execute(`delete from "tasks" where "id" = ?`, [privateTask]);
    });

    it.each(['private', 'public'] as const)(
      'refuses a %s file held only by a Task the caller may not see — the missing-file 422',
      async (visibility) => {
        const own = await createProject(h, {
          title: `Own ${visibility}`,
          members: [{ adminUserId: reader.adminUserId, roleIds: [] }],
        });
        created.push(own.id);
        const file = await asset({ visibility });
        await h
          .em()
          .getConnection()
          .execute(`insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`, [
            privateTask,
            file.id,
            TEST_ADMIN_ID,
          ]);

        const attach = (assetId: string, cookies?: Person['cookies']) =>
          callProjects(h, 'POST', `/${own.id}/attachments`, { payload: { assetId }, ...(cookies ? { cookies } : {}) });
        const hidden = await attach(file.id, reader.cookies);
        const missing = await attach(randomUUID(), reader.cookies);
        expect(missing.statusCode, missing.body).toBe(422);
        expect(hidden.statusCode, hidden.body).toBe(422);
        expect(errorShape(hidden.body)).toEqual(errorShape(missing.body));
        expect(errorShape(hidden.body)).toMatchObject({
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'The file does not exist in the media library.',
        });
        expect(await list(own.id, reader)).toEqual([]);

        // The control: the Platform administrator sees the Task, so the file is there to attach
        // — and is then refused for what it is (a public file), not for being missing.
        const forAdmin = await attach(file.id);
        if (visibility === 'private') {
          expect(forAdmin.statusCode, forAdmin.body).toBe(201);
        } else {
          expect(forAdmin.statusCode, forAdmin.body).toBe(422);
          expect(forAdmin.json().error.message).not.toBe('The file does not exist in the media library.');
        }
      },
    );
  });
});
