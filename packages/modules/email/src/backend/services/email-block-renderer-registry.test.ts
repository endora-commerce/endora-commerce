import { describe, expect, it, vi } from 'vitest';

import { EmailBlockRendererRegistry } from './email-block-renderer-registry.js';

/**
 * `specs/141-module-block-renderers/contracts/block-renderers.md` §5.3, §7 —
 * the push-at-boot table of composed modules' e-mail block renderers.
 */

const renderer = (marker: string): { html: () => string } => ({ html: () => marker });

/** `crm` present, `loyalty` switched off, anything else not a module at all. */
const presenceOf = (moduleId: string): boolean | undefined =>
  moduleId === 'crm' ? true : moduleId === 'loyalty' ? false : undefined;

describe('EmailBlockRendererRegistry', () => {
  it('registers a block under its owner and serves it', () => {
    const registry = new EmailBlockRendererRegistry(presenceOf);
    const badge = renderer('badge');
    const result = registry.register('crm', { 'crm.Badge': badge });

    expect(result).toEqual({ registered: ['crm.Badge'], refused: [] });
    expect(registry.renderers()).toEqual({ 'crm.Badge': badge });
    expect(registry.listAll()).toEqual([{ name: 'crm.Badge', ownerModuleId: 'crm' }]);
  });

  it('refuses a name whose owner segment is not the registering module', () => {
    const warn = vi.fn();
    const registry = new EmailBlockRendererRegistry(presenceOf, { warn });
    const result = registry.register('crm', {
      'loyalty.Points': renderer('foreign'),
      'transactional_emails.EmailText': renderer('hijack'),
      NotNamespaced: renderer('bare'),
      'crm.Badge': renderer('own'),
    });

    expect(result.registered).toEqual(['crm.Badge']);
    expect(result.refused.map((entry) => entry.name)).toEqual([
      'loyalty.Points',
      'transactional_emails.EmailText',
      'NotNamespaced',
    ]);
    expect(Object.keys(registry.renderers())).toEqual(['crm.Badge']);
    // Refused and said so, naming the module — never thrown: a boot hook that
    // throws stops the platform, and one wrong name must not.
    expect(warn).toHaveBeenCalledTimes(3);
    expect(String(warn.mock.calls[0]?.[1])).toContain('crm');
  });

  it('refuses an entry that is not a renderer', () => {
    const registry = new EmailBlockRendererRegistry(presenceOf);
    const result = registry.register('crm', {
      'crm.Broken': { html: 'not a function' } as never,
      'crm.Null': null as never,
    });
    expect(result.registered).toEqual([]);
    expect(result.refused).toHaveLength(2);
    expect(registry.renderers()).toEqual({});
  });

  it('skips the renderers of an owner that is switched off, and reads presence on every call', () => {
    let loyaltyPresent = false;
    const registry = new EmailBlockRendererRegistry((moduleId) =>
      moduleId === 'loyalty' ? loyaltyPresent : true,
    );
    registry.register('crm', { 'crm.Badge': renderer('badge') });
    registry.register('loyalty', { 'loyalty.Points': renderer('points') });

    expect(Object.keys(registry.renderers())).toEqual(['crm.Badge']);
    // Switched back on: the next render sees it, with no restart and no
    // re-registration.
    loyaltyPresent = true;
    expect(Object.keys(registry.renderers())).toEqual(['crm.Badge', 'loyalty.Points']);
  });

  it('honours an owner no manifest declares', () => {
    // An overlay module's id is not in the manifest index, so the probe answers
    // `undefined`. Collapsing that into "absent" would delete the extension
    // point for exactly the modules that have no other one.
    const registry = new EmailBlockRendererRegistry(presenceOf);
    registry.register('overlay_crm', { 'overlay_crm.Banner': renderer('banner') });
    expect(Object.keys(registry.renderers())).toEqual(['overlay_crm.Banner']);
  });

  it('keeps listAll presence-blind', () => {
    const registry = new EmailBlockRendererRegistry(presenceOf);
    registry.register('loyalty', { 'loyalty.Points': renderer('points') });
    expect(registry.renderers()).toEqual({});
    expect(registry.listAll()).toEqual([{ name: 'loyalty.Points', ownerModuleId: 'loyalty' }]);
  });

  it('defaults to always-present, so a registry a test builds answers about what it registered', () => {
    const registry = new EmailBlockRendererRegistry();
    registry.register('loyalty', { 'loyalty.Points': renderer('points') });
    expect(Object.keys(registry.renderers())).toEqual(['loyalty.Points']);
  });

  it('lets a module register again without duplicating its entry', () => {
    const registry = new EmailBlockRendererRegistry(presenceOf);
    const second = renderer('second');
    registry.register('crm', { 'crm.Badge': renderer('first') });
    registry.register('crm', { 'crm.Badge': second });
    expect(registry.renderers()).toEqual({ 'crm.Badge': second });
    expect(registry.listAll()).toHaveLength(1);
  });

  it('does not answer for an inherited property name', () => {
    const registry = new EmailBlockRendererRegistry(presenceOf);
    expect(Object.hasOwn(registry.renderers(), 'constructor')).toBe(false);
    expect(Object.getPrototypeOf(registry.renderers())).toBeNull();
  });
});
