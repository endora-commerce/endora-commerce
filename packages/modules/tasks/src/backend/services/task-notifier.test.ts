import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { taskLinkPath, taskNotificationText } from './task-notifier.js';

/**
 * A bell entry of this module is translatable and says no more than the Task's
 * number (FR-032; the CRM rule — a bell is read outside any record's
 * visibility). The English template filled with the params **is** the finished
 * sentence, so the fallback and the translation cannot drift apart, and every
 * key exists in both bundles.
 */
const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<
    string,
    string
  >;

describe('taskNotificationText', () => {
  const text = taskNotificationText.assigned('TSK-000042');

  it('names the Task by its number only', () => {
    expect(text.title).toBe('Task TSK-000042 was assigned to you');
    expect(text.titleMessage).toEqual({
      scope: 'tasks',
      key: 'notifications.assigned.title',
      params: { number: 'TSK-000042' },
    });
  });

  it('addresses a key of this module’s bundle in both languages; the English template filled is the sentence', () => {
    for (const language of ['en', 'pl'] as const) {
      const template = bundle(language)[text.titleMessage.key];
      expect(template, `${language}: ${text.titleMessage.key}`).toBeTypeOf('string');
      expect([...template!.matchAll(/\{(\w+)\}/g)].map((m) => m[1])).toEqual(['number']);
    }
    expect(bundle('en')[text.titleMessage.key]!.replace('{number}', 'TSK-000042')).toBe(text.title);
  });

  it('a mention names the Task by its number only, from a key both bundles hold (FR-006)', () => {
    const mention = taskNotificationText.mentioned('TSK-000042');
    expect(mention.title).toBe('You were mentioned in task TSK-000042');
    expect(mention.titleMessage).toEqual({ scope: 'tasks', key: 'notifications.mention.title', params: { number: 'TSK-000042' } });
    for (const language of ['en', 'pl'] as const) {
      const template = bundle(language)[mention.titleMessage.key];
      expect(template, `${language}: ${mention.titleMessage.key}`).toBeTypeOf('string');
      expect([...template!.matchAll(/\{(\w+)\}/g)].map((m) => m[1])).toEqual(['number']);
    }
    expect(bundle('en')[mention.titleMessage.key]!.replace('{number}', 'TSK-000042')).toBe(mention.title);
  });

  it('a comment names the Task by its number only, never the text, from a key both bundles hold (FR-026)', () => {
    const comment = taskNotificationText.commented('TSK-000042');
    expect(comment.title).toBe('New comment on task TSK-000042');
    expect(comment.titleMessage).toEqual({ scope: 'tasks', key: 'notifications.comment.title', params: { number: 'TSK-000042' } });
    for (const language of ['en', 'pl'] as const) {
      const template = bundle(language)[comment.titleMessage.key];
      expect(template, `${language}: ${comment.titleMessage.key}`).toBeTypeOf('string');
      expect([...template!.matchAll(/\{(\w+)\}/g)].map((m) => m[1])).toEqual(['number']);
    }
    expect(bundle('en')[comment.titleMessage.key]!.replace('{number}', 'TSK-000042')).toBe(comment.title);
  });

  it('a reminder names the Task by its number only, from a key both bundles hold (FR-034)', () => {
    const reminder = taskNotificationText.reminder('TSK-000042');
    expect(reminder.title).toBe('Reminder: task TSK-000042');
    expect(reminder.titleMessage).toEqual({ scope: 'tasks', key: 'notifications.reminder.title', params: { number: 'TSK-000042' } });
    for (const language of ['en', 'pl'] as const) {
      const template = bundle(language)[reminder.titleMessage.key];
      expect(template, `${language}: ${reminder.titleMessage.key}`).toBeTypeOf('string');
      expect([...template!.matchAll(/\{(\w+)\}/g)].map((m) => m[1])).toEqual(['number']);
    }
    expect(bundle('en')[reminder.titleMessage.key]!.replace('{number}', 'TSK-000042')).toBe(reminder.title);
  });

  it('the daily digest says how many, and names no Task (FR-036)', () => {
    const digest = taskNotificationText.digest(3);
    expect(digest.title).toBe('Your daily task digest: 3 due today or overdue');
    expect(digest.titleMessage).toEqual({ scope: 'tasks', key: 'notifications.digest.title', params: { count: 3 } });
    for (const language of ['en', 'pl'] as const) {
      const template = bundle(language)[digest.titleMessage.key];
      expect(template, `${language}: ${digest.titleMessage.key}`).toBeTypeOf('string');
      expect([...template!.matchAll(/\{(\w+)\}/g)].map((m) => m[1])).toEqual(['count']);
    }
    expect(bundle('en')[digest.titleMessage.key]!.replace('{count}', '3')).toBe(digest.title);
  });

  it('links to the Task’s screen', () => {
    expect(taskLinkPath('7d3c8f1e-0000-4000-8000-000000000001')).toBe('/tasks/7d3c8f1e-0000-4000-8000-000000000001');
  });
});
