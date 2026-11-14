import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_STAGES_MAX } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import { removeCrmAssets, seedCrmAsset } from '../../helpers/seed-crm.js';
import { callProjects, createProject, deleteProjects } from './helpers.js';

/**
 * Issue #634 (#86) — three refusals of `projects` were `422 VALIDATION_FAILED`
 * with an English literal: a Stage added past the maximum, a public file
 * attached, and an archived Role added to a Template. Each is a well-formed
 * request the Project's or the Role's state refuses. The envelope never
 * replaces the message of `VALIDATION_FAILED`, so an operator working in
 * Polish read English, and the maximum was baked into the text. Each now has
 * its own code, a sentence in English and Polish, and the values that
 * sentence names in `details`.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const STAGE_LIMIT = {
  en: (maximum: number) =>
    `A project has at most ${maximum} stages, so no stage can be added. Remove a stage first.`,
  pl: (maximum: number) =>
    `Projekt może mieć najwyżej ${maximum} etapów, więc nie można dodać kolejnego. Najpierw usuń któryś etap.`,
};
const ATTACHMENT_NOT_PRIVATE = {
  en: 'An attachment must be a private file. Upload it to the media library as private.',
  pl: 'Załącznik musi być plikiem prywatnym. Prześlij go do biblioteki mediów jako prywatny.',
};
const TEMPLATE_ROLE_ARCHIVED = {
  en: 'This role is archived, so it cannot be added to a template. Restore the role or choose another one.',
  pl: 'Ta rola jest zarchiwizowana, więc nie można dodać jej do szablonu. Przywróć tę rolę albo wybierz inną.',
};

describe('projects refusals carry their own code and sentence (issue #634)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  let archivedRole: string;
  const projects: string[] = [];
  const assets: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
    archivedRole = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "project_roles" ("id", "code", "name", "default_name", "position", "archived_at")
         values (?, ?, ?, ?, 902, now())`,
        [
          archivedRole,
          `retired_${archivedRole.slice(0, 8)}`,
          JSON.stringify({ en: 'Retired', pl: 'Wycofana' }),
          'Retired',
        ],
      );
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      await deleteProjects(h, projects);
      await removeCrmAssets(h.em(), assets);
      await h.em().getConnection().execute(`delete from "project_roles" where "id" = ?`, [archivedRole]);
    }
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  function refusal(response: { statusCode: number; body: string }, code: string): ErrorBody['error'] {
    expect(response.statusCode, response.body).toBe(422);
    const error = (JSON.parse(response.body) as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  it.each(['en', 'pl'] as const)(
    'PROJECT_STAGE_LIMIT when a Stage is added to a project at the maximum (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const project = await createProject(h, {
        title: 'Full of stages',
        stages: Array.from({ length: PROJECT_STAGES_MAX }, (_, i) => ({
          name: `Stage ${i + 1}`,
          color: '#3b82f6',
        })),
      });
      projects.push(project.id);

      const error = refusal(
        await callProjects(h, 'POST', `/${project.id}/stages`, {
          payload: { name: 'One too many', color: '#000000' },
        }),
        'PROJECT_STAGE_LIMIT',
      );

      expect(error.details).toEqual({ projectId: project.id, maximum: PROJECT_STAGES_MAX });
      expect(error.message).toBe(STAGE_LIMIT[language](PROJECT_STAGES_MAX));
      if (language === 'pl') expect(error.message).not.toBe(STAGE_LIMIT.en(PROJECT_STAGES_MAX));
      expect(error.message).toContain(String(PROJECT_STAGES_MAX));
    },
  );

  it.each(['en', 'pl'] as const)(
    'PROJECT_ATTACHMENT_NOT_PRIVATE when a public file is attached (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const project = await createProject(h, { title: 'Attachments' });
      projects.push(project.id);
      const file = await seedCrmAsset(h.em(), { visibility: 'public' });
      assets.push(file.id);

      const error = refusal(
        await callProjects(h, 'POST', `/${project.id}/attachments`, { payload: { assetId: file.id } }),
        'PROJECT_ATTACHMENT_NOT_PRIVATE',
      );

      expect(error.details).toEqual({ assetId: file.id, visibility: 'public' });
      expect(error.message).toBe(ATTACHMENT_NOT_PRIVATE[language]);
      if (language === 'pl') expect(error.message).not.toBe(ATTACHMENT_NOT_PRIVATE.en);
    },
  );

  it.each(['en', 'pl'] as const)(
    'PROJECT_TEMPLATE_ROLE_ARCHIVED when an archived Role is added to a template (%s)',
    async (language) => {
      await setAdminLanguage(language);

      const error = refusal(
        await callProjects(h, 'POST', '/templates', {
          payload: {
            name: `With a retired role ${randomUUID().slice(0, 8)}`,
            roleIds: [archivedRole],
            stages: [{ key: 'only', name: 'Only', color: '#000000' }],
            moves: [],
          },
        }),
        'PROJECT_TEMPLATE_ROLE_ARCHIVED',
      );

      expect(error.details).toEqual({ roleId: archivedRole });
      expect(error.message).toBe(TEMPLATE_ROLE_ARCHIVED[language]);
      if (language === 'pl') expect(error.message).not.toBe(TEMPLATE_ROLE_ARCHIVED.en);
    },
  );

  it('routes the three codes to projects, the module that raises them', () => {
    for (const code of [
      'PROJECT_STAGE_LIMIT',
      'PROJECT_ATTACHMENT_NOT_PRIVATE',
      'PROJECT_TEMPLATE_ROLE_ARCHIVED',
    ]) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('projects');
    }
  });
});
