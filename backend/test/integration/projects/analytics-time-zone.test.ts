import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectAnalyticsSummaryResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PROJECTS_ADMIN, callProjects, createProject, deleteProjects } from './helpers.js';
import { withModulesDeactivated } from '../../helpers/modules-deactivated.js';

/**
 * Project analytics count days in the reporting time zone (owner decisions
 * 2026-10-27, issue #465; `specs/163-projects-and-tasks/` T146).
 *
 * `analytics.reporting_time_zone` is the `analytics` module's, so CRM can count
 * in the same zone later (#474); it defaults to `UTC`, in which the figures are
 * those the module answered before the setting existed. `analytics` can be
 * switched off: Projects then counts in `UTC` and never fails (its
 * `degrades-without` edge). Three Projects are
 * dated in 2003 — a year no other file uses — around the midnights of
 * Europe/Warsaw (UTC+1 in winter):
 *
 * - A, created 2002-12-31 23:30 UTC — 1 January 00:30 in Warsaw;
 * - F, created 2003-01-15 12:00 UTC — mid-January everywhere;
 * - D, created 2003-01-31 23:30 UTC — 1 February 00:30 in Warsaw.
 */
describe('projects — analytics in the reporting time zone (T146)', () => {
  let h: BackendServerHandle;
  const created: string[] = [];
  const admin = { b2b_session: 'stub-admin-session' };

  const setZone = (value: unknown) =>
    h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/analytics.reporting_time_zone/value',
      cookies: admin,
      payload: { scope: 'all', value },
    });

  const opened = async (from: string, to: string): Promise<number> => {
    const response = await callProjects(h, 'GET', `/analytics/summary?from=${from}&to=${to}`, {
      cookies: PROJECTS_ADMIN,
    });
    expect(response.statusCode, response.body).toBe(200);
    return ProjectAnalyticsSummaryResponseSchema.parse(response.json()).data.opened;
  };

  /** The zone a figure says it was counted in (issue #475). */
  const countedIn = async (): Promise<string | undefined> => {
    const response = await callProjects(h, 'GET', '/analytics/summary?from=2003-01-01&to=2003-01-31', {
      cookies: PROJECTS_ADMIN,
    });
    expect(response.statusCode, response.body).toBe(200);
    return ProjectAnalyticsSummaryResponseSchema.parse(response.json()).timeZone;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    for (const [title, createdAt] of [
      ['Zone A', '2002-12-31T23:30:00.000Z'],
      ['Zone F', '2003-01-15T12:00:00.000Z'],
      ['Zone D', '2003-01-31T23:30:00.000Z'],
    ] as const) {
      const project = await createProject(h, { title });
      created.push(project.id);
      await h
        .em()
        .getConnection()
        .execute(`update "projects" set "created_at" = ? where "id" = ?`, [new Date(createdAt), project.id]);
    }
  });

  afterAll(async () => {
    await setZone('UTC');
    await deleteProjects(h, created);
    await teardownBackendServer(h);
  });

  it('defaults to UTC, counting as the module did before the setting', async () => {
    const setting = await h.app.inject({ method: 'GET', url: '/api/v1/admin/settings/analytics.reporting_time_zone', cookies: admin });
    expect(setting.statusCode, setting.body).toBe(200);
    expect(setting.body).toContain('"UTC"');
    expect(await countedIn()).toBe('UTC');
    expect(await opened('2003-01-01', '2003-01-01')).toBe(0);
    expect(await opened('2003-01-01', '2003-01-31')).toBe(2);
    expect(await opened('2003-01-31', '2003-01-31')).toBe(1);
    expect(await opened('2003-02-01', '2003-02-28')).toBe(0);
  });

  it('in Europe/Warsaw counts a Project made just after its midnight in that day, across a month boundary', async () => {
    const accepted = await setZone('Europe/Warsaw');
    expect(accepted.statusCode, accepted.body).toBeLessThan(400);
    expect(await countedIn()).toBe('Europe/Warsaw');
    expect(await opened('2003-01-01', '2003-01-01')).toBe(1);
    expect(await opened('2003-01-01', '2003-01-31')).toBe(2);
    expect(await opened('2003-01-31', '2003-01-31')).toBe(0);
    expect(await opened('2003-02-01', '2003-02-28')).toBe(1);
  });

  it('with analytics off counts in UTC whatever the setting says — degraded, never failing', async () => {
    const accepted = await setZone('Europe/Warsaw');
    expect(accepted.statusCode, accepted.body).toBeLessThan(400);
    await withModulesDeactivated(['analytics'], async () => {
      expect(await countedIn()).toBe('UTC');
      expect(await opened('2003-01-01', '2003-01-01')).toBe(0);
      expect(await opened('2003-01-31', '2003-01-31')).toBe(1);
      expect(await opened('2003-02-01', '2003-02-28')).toBe(0);
    });
    // On again, the zone is back.
    expect(await opened('2003-02-01', '2003-02-28')).toBe(1);
  });

  it('refuses a zone that does not exist', async () => {
    const refused = await setZone('Mars/Olympus_Mons');
    expect(refused.statusCode, refused.body).toBe(422);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });
});
