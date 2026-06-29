import { describe, expect, it } from 'vitest';
import { renderDirectives } from './directive-engine.js';

describe('renderDirectives', () => {
  it('substitutes nested var paths', () => {
    expect(renderDirectives('Hello {{var customer.firstName}}', { customer: { firstName: 'Anna' } })).toBe('Hello Anna');
  });

  it('resolves missing var to empty string and never throws', () => {
    expect(renderDirectives('X{{var a.b.c}}Y', {})).toBe('XY');
  });

  it('escapes var values in HTML mode but leaves raw in text mode', () => {
    const ctx = { name: '<b>&"' };
    expect(renderDirectives('{{var name}}', ctx, { escape: true })).toBe('&lt;b&gt;&amp;&quot;');
    expect(renderDirectives('{{var name}}', ctx)).toBe('<b>&"');
  });

  it('includes if block when truthy, skips when falsy', () => {
    expect(renderDirectives('{{if flag}}YES{{/if}}', { flag: true })).toBe('YES');
    expect(renderDirectives('{{if flag}}YES{{/if}}', { flag: false })).toBe('');
    expect(renderDirectives('{{if list}}has{{/if}}', { list: [] })).toBe('');
    expect(renderDirectives('{{if list}}has{{/if}}', { list: [1] })).toBe('has');
  });

  it('iterates for loops binding the alias', () => {
    const out = renderDirectives('{{for item in order.items}}[{{var item.sku}}]{{/for}}', {
      order: { items: [{ sku: 'A' }, { sku: 'B' }] },
    });
    expect(out).toBe('[A][B]');
  });

  it('handles nested if inside for', () => {
    const out = renderDirectives('{{for i in items}}{{if i.on}}{{var i.n}}{{/if}}{{/for}}', {
      items: [{ on: true, n: '1' }, { on: false, n: '2' }, { on: true, n: '3' }],
    });
    expect(out).toBe('13');
  });

  it('returns input unchanged when no directives present', () => {
    expect(renderDirectives('plain text', {})).toBe('plain text');
  });

  it('skips a for over a non-array', () => {
    expect(renderDirectives('{{for x in y}}Z{{/for}}', { y: 'nope' })).toBe('');
  });
});
