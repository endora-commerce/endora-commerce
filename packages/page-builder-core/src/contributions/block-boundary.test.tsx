import type { ComponentConfig } from '@puckeditor/core';
import { createElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { withBlockBoundary } from './index.js';

/**
 * `contracts/block-renderers.md` R8.1, as T01 measured it: `<Suspense>` is what
 * isolates a throw on the server, under `renderToString` — the storefront
 * harness's renderer — as under the streaming one.
 *
 * The assertions read what a block **rendered**, never the error's text: a
 * development build of React writes the message into a `<template>` beside the
 * fallback, and a production build writes a digest.
 */

const asComponent = (render: (props: Record<string, unknown>) => ReactNode): ComponentConfig =>
  ({ render }) as unknown as ComponentConfig;

const placeholder = asComponent(() => <i data-placeholder="crm.Badge">placeholder</i>);

function Deep({ explode }: { explode: boolean }): ReactNode {
  if (explode) throw new Error('boom-in-a-child');
  return <span>deep-ok</span>;
}

/** Puck mounts a block's `render` as a component; so does this page. */
function page(blocks: ReadonlyArray<[ComponentConfig, Record<string, unknown>]>): string {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return renderToString(
      <main>
        {blocks.map(([config, props], index) =>
          createElement(config.render as never, { key: index, ...props }),
        )}
      </main>,
    );
  } finally {
    consoleError.mockRestore();
  }
}

const sibling = asComponent(() => <p>sibling-block</p>);

describe('withBlockBoundary', () => {
  it('renders a block that does not throw, unchanged', () => {
    const badge = withBlockBoundary(
      asComponent((props) => <b>badge:{String(props['text'])}</b>),
      placeholder,
    );
    const html = page([[badge, { text: 'gold' }]]);
    expect(html).toContain('badge:<!-- -->gold');
    expect(html).not.toContain('data-placeholder');
  });

  it('degrades a block whose render throws synchronously, and only that block', () => {
    const broken = withBlockBoundary(
      asComponent(() => {
        throw new Error('boom-at-the-top');
      }),
      placeholder,
    );
    const html = page([
      [sibling, {}],
      [broken, {}],
      [sibling, {}],
    ]);
    expect(html.match(/sibling-block/g)).toHaveLength(2);
    expect(html).toContain('data-placeholder="crm.Badge"');
  });

  it('degrades a block whose child component throws, and only that block', () => {
    const broken = withBlockBoundary(
      asComponent(() => (
        <div>
          <span>rendered-before-the-throw</span>
          <Deep explode />
        </div>
      )),
      placeholder,
    );
    const healthy = withBlockBoundary(
      asComponent(() => <Deep explode={false} />),
      placeholder,
    );
    const html = page([
      [sibling, {}],
      [broken, {}],
      [healthy, {}],
      [sibling, {}],
    ]);
    expect(html.match(/sibling-block/g)).toHaveLength(2);
    expect(html).toContain('deep-ok');
    expect(html.match(/data-placeholder="crm\.Badge"/g)).toHaveLength(1);
    // Nothing the failed block drew before it threw reaches the page.
    expect(html).not.toContain('rendered-before-the-throw');
  });

  it('merges the block defaultProps under the stored props', () => {
    const seen: unknown[] = [];
    const block = withBlockBoundary(
      {
        defaultProps: { text: 'default', tone: 'neutral' },
        render: (props: Record<string, unknown>) => {
          seen.push({ text: props['text'], tone: props['tone'], id: props['id'] });
          return <b>ok</b>;
        },
      } as unknown as ComponentConfig,
      placeholder,
    );
    page([[block, { id: 'b1', text: 'stored' }]]);
    expect(seen).toEqual([{ id: 'b1', text: 'stored', tone: 'neutral' }]);
  });

  it('does not let a stored undefined shadow a default', () => {
    const seen: unknown[] = [];
    const block = withBlockBoundary(
      {
        defaultProps: { tone: 'neutral' },
        render: (props: Record<string, unknown>) => {
          seen.push(props['tone']);
          return null;
        },
      } as unknown as ComponentConfig,
      placeholder,
    );
    page([[block, { tone: undefined }]]);
    expect(seen).toEqual(['neutral']);
  });

  it('keeps every other key of the config', () => {
    const fields = { text: { type: 'text' } };
    const wrapped = withBlockBoundary(
      { label: 'Badge', fields, render: () => null } as unknown as ComponentConfig,
      placeholder,
    );
    expect(wrapped.label).toBe('Badge');
    expect(wrapped.fields).toBe(fields);
  });
});
