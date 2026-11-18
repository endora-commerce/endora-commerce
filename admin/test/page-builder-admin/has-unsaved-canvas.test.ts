import { describe, expect, it } from 'vitest';
import type { Data } from '@puckeditor/core';
import { hasUnsavedCanvas } from '../../../packages/page-builder-admin/src/chrome/page-builder-data';

/** Issue #1461 (CONTENT-02) — the canvas half of a Page Builder editor's `dirty`. */
const hero = (title: string): Data => ({
  root: { props: {} },
  content: [{ type: 'Hero', props: { id: 'h1', title } }],
});

const savedByLanguage: Record<string, Data> = { 'en-US': hero('Hello'), 'pl-PL': hero('Cześć') };
const saved = (language: string | null): Data | null => (language ? (savedByLanguage[language] ?? null) : null);

describe('hasUnsavedCanvas', () => {
  it('is clean with no draft, and with a draft equal to what is saved (a reseed is not an edit)', () => {
    expect(hasUnsavedCanvas({ draft: null, activeLanguage: 'en-US', overrides: {}, saved })).toBe(false);
    expect(hasUnsavedCanvas({ draft: structuredClone(hero('Hello')), activeLanguage: 'en-US', overrides: {}, saved })).toBe(false);
  });

  it('sees an edited active canvas', () => {
    expect(hasUnsavedCanvas({ draft: hero('Hi'), activeLanguage: 'en-US', overrides: {}, saved })).toBe(true);
  });

  it('sees an edit stashed under another language tab', () => {
    expect(hasUnsavedCanvas({ draft: null, activeLanguage: 'en-US', overrides: { 'pl-PL': hero('Hej') }, saved })).toBe(true);
  });

  it('compares a never-saved language with the empty canvas', () => {
    const empty: Data = { root: { props: {} }, content: [] };
    expect(hasUnsavedCanvas({ draft: empty, activeLanguage: 'de-DE', overrides: {}, saved })).toBe(false);
    expect(hasUnsavedCanvas({ draft: hero('Hallo'), activeLanguage: 'de-DE', overrides: {}, saved })).toBe(true);
  });
});
