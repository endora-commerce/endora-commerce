import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AdminNotificationMessage } from '@endora-commerce/contracts';
import { projectLinkPath, projectNotificationText, type ProjectNotificationText } from './project-notifier.js';
import { PROJECT_MERGE_NOTIFICATION_KEYS } from '../merge/project-merge-notifier.js';

/**
 * A bell entry of this module is translatable and says no more than the
 * Project's number and the author's name (FR-025, FR-026; the CRM rule — a
 * bell is read outside the Project's visibility). The English template filled
 * with the params **is** the finished sentence, so the fallback and the
 * translation cannot drift apart and the params carry nothing the sentence did
 * not; every key exists in both bundles, and the bundles ship no
 * `notifications.` key this module does not record.
 */
const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<
    string,
    string
  >;

const fill = (template: string, message: AdminNotificationMessage): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    message.params && name in message.params ? String(message.params[name]) : whole,
  );

const placeholders = (template: string): string[] =>
  [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string).sort();

const SENTENCES: Record<string, ProjectNotificationText> = {
  message: projectNotificationText.message('PRJ-000042'),
  'mention, the author known': projectNotificationText.mention('PRJ-000042', 'Ada Author'),
  'mention, the author unknown': projectNotificationText.mention('PRJ-000042', null),
  'stage deadline': projectNotificationText.stageDeadline('PRJ-000042', 'Design', '2026-10-30', 3),
};

describe('projectNotificationText', () => {
  it('names the Project by its number and the author by name, nothing else', () => {
    expect(SENTENCES.message!.title).toBe('New message on project PRJ-000042');
    expect(SENTENCES['mention, the author known']!.title).toBe('Ada Author mentioned you in project PRJ-000042');
    expect(SENTENCES['mention, the author unknown']!.title).toBe('You were mentioned in project PRJ-000042');
  });

  it('a deadline alert names the Stage, its deadline and the days left as well — and nothing else', () => {
    expect(SENTENCES['stage deadline']!.title).toBe(
      'Stage "Design" of project PRJ-000042 is due on 2026-10-30 (days left: 3)',
    );
  });

  for (const [label, text] of Object.entries(SENTENCES)) {
    it(`${label}: a key of both bundles whose English template, filled, is the sentence`, () => {
      expect(text.titleMessage.scope).toBe('projects');
      for (const language of ['en', 'pl'] as const) {
        const template = bundle(language)[text.titleMessage.key];
        expect(template, `${language}: ${text.titleMessage.key}`).toBeTypeOf('string');
        expect(placeholders(template!)).toEqual(Object.keys(text.titleMessage.params ?? {}).sort());
      }
      expect(fill(bundle('en')[text.titleMessage.key]!, text.titleMessage)).toBe(text.title);
    });
  }

  it('the bundles hold no notification key the module does not record', () => {
    const recorded = new Set([
      ...Object.values(SENTENCES).map((text) => text.titleMessage.key),
      // `specs/192-organization-merge/` US6 — the Project merge's two, recorded by `merge/project-merge-notifier.ts`.
      ...PROJECT_MERGE_NOTIFICATION_KEYS,
    ]);
    for (const language of ['en', 'pl'] as const) {
      const shipped = Object.keys(bundle(language)).filter((key) => key.startsWith('notifications.'));
      expect(new Set(shipped)).toEqual(recorded);
    }
  });

  it('links a message to the Messages tab, a deadline alert to the Stages tab and a mention to the Project', () => {
    const id = '7d3c8f1e-0000-4000-8000-000000000001';
    expect(projectLinkPath(id, 'projects.project.message')).toBe(`/projects/${id}?tab=messages`);
    expect(projectLinkPath(id, 'projects.project.mention')).toBe(`/projects/${id}`);
    expect(projectLinkPath(id, 'projects.project.stage_deadline')).toBe(`/projects/${id}?tab=stages`);
  });
});
