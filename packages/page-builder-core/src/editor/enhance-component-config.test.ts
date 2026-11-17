import { createElement } from 'react';
import type { ComponentConfig, Fields } from '@puckeditor/core';
import { describe, expect, it } from 'vitest';
import { enhancePageBuilderComponent } from './enhance-component-config.js';
import { EDITOR_NAME_FIELD_KEY } from '../types/editor-chrome.js';

const title: Fields = { title: { type: 'text', label: 'Title' } };

function resolve(config: ComponentConfig): ReturnType<NonNullable<ComponentConfig['resolveFields']>> {
  const enhanced = enhancePageBuilderComponent(config);
  return enhanced.resolveFields!({ props: {} } as never, {} as never);
}

describe('enhancePageBuilderComponent — resolveFields', () => {
  it('adds the editor name field to synchronously resolved fields', () => {
    const fields = resolve({ fields: title, render: () => createElement('div'), resolveFields: () => title }) as Fields;
    expect(Object.keys(fields)).toEqual([EDITOR_NAME_FIELD_KEY, 'title']);
  });

  // Puck allows `resolveFields` to return a Promise. Spreading the Promise
  // itself used to yield the editor name field alone, dropping every field the
  // component resolved (issue #1027, found by `no-misused-promises`).
  it('awaits asynchronously resolved fields instead of spreading the Promise', async () => {
    const resolved = resolve({ fields: title, render: () => createElement('div'), resolveFields: async () => title });
    expect(resolved).toBeInstanceOf(Promise);
    expect(Object.keys(await resolved)).toEqual([EDITOR_NAME_FIELD_KEY, 'title']);
  });
});
