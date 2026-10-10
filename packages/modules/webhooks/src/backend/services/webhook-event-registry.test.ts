import { describe, expect, it, vi } from 'vitest';
import { WebhookEventRegistry } from './webhook-event-registry.js';

const BUILT_IN = ['order.created.v1', 'order.status_changed.v1'] as const;

function registry(present: (moduleId: string) => boolean = () => true) {
  const bridge = vi.fn<(eventType: string) => void>();
  return { bridge, subject: new WebhookEventRegistry({ isPresent: present, bridge, alreadyBridged: BUILT_IN }) };
}

describe('WebhookEventRegistry — an absent contributor’s event types are not offered', () => {
  it('records the owner of every type and bridges each contributed type once', () => {
    const { bridge, subject } = registry();
    subject.register({ ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' });
    subject.register({ ownerModuleId: 'crm', eventType: 'crm.opportunity.closed.v1' });
    subject.register({ ownerModuleId: 'loyalty', eventType: 'loyalty.points_granted.v1' });

    expect(subject.list()).toEqual([
      { ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' },
      { ownerModuleId: 'crm', eventType: 'crm.opportunity.closed.v1' },
      { ownerModuleId: 'loyalty', eventType: 'loyalty.points_granted.v1' },
    ]);
    expect(subject.owners()).toEqual(['crm', 'loyalty']);
    expect(bridge.mock.calls.map(([eventType]) => eventType)).toEqual([
      'crm.opportunity.created.v1',
      'crm.opportunity.closed.v1',
      'loyalty.points_granted.v1',
    ]);
  });

  it('is idempotent per event type: the same type pushed again is neither listed nor bridged twice', () => {
    const { bridge, subject } = registry();
    subject.register({ ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' });
    subject.register({ ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' });
    // The first contributor of a type stays its owner.
    subject.register({ ownerModuleId: 'other', eventType: 'crm.opportunity.created.v1' });

    expect(subject.list()).toEqual([{ ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' }]);
    expect(bridge).toHaveBeenCalledTimes(1);
  });

  it('does not bridge a type the module bridges of its own accord', () => {
    const { bridge, subject } = registry();
    subject.register({ ownerModuleId: 'orders', eventType: 'order.created.v1' });
    expect(bridge).not.toHaveBeenCalled();
    expect(subject.list()).toEqual([{ ownerModuleId: 'orders', eventType: 'order.created.v1' }]);
  });

  it('leaves out the types of an owner that is not present, asked on every read', () => {
    let crmPresent = true;
    const { subject } = registry((moduleId) => moduleId !== 'crm' || crmPresent);
    subject.register({ ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' });
    subject.register({ ownerModuleId: 'loyalty', eventType: 'loyalty.points_granted.v1' });

    crmPresent = false;
    expect(subject.list()).toEqual([{ ownerModuleId: 'loyalty', eventType: 'loyalty.points_granted.v1' }]);
    // Presence-blind, for diagnostics: the contribution is not forgotten.
    expect(subject.owners()).toEqual(['crm', 'loyalty']);

    crmPresent = true;
    expect(subject.list().map((descriptor) => descriptor.eventType)).toEqual([
      'crm.opportunity.created.v1',
      'loyalty.points_granted.v1',
    ]);
  });

  it('bridges a type whose owner is absent when it is pushed — the bridge has its own gate', () => {
    // Whether an event is *delivered* is the bridge's question, answered by
    // this module's effective state; whether it is *offered* is the owner's.
    const { bridge, subject } = registry(() => false);
    subject.register({ ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' });
    expect(bridge).toHaveBeenCalledWith('crm.opportunity.created.v1');
    expect(subject.list()).toEqual([]);
  });

  it('hands out copies: a caller cannot change what is registered', () => {
    const { subject } = registry();
    const descriptor = { ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' };
    subject.register(descriptor);
    descriptor.ownerModuleId = 'tampered';
    expect(subject.list()).toEqual([{ ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' }]);
  });

  it('a contributed type is deliverable only while its owner is present — asked per event, so a flip needs no restart', () => {
    let present = true;
    const { subject } = registry((moduleId) => moduleId !== 'crm' || present);
    subject.register({ ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' });

    expect(subject.isDeliverable('crm.opportunity.created.v1')).toBe(true);
    present = false;
    expect(subject.isDeliverable('crm.opportunity.created.v1')).toBe(false);
    present = true;
    expect(subject.isDeliverable('crm.opportunity.created.v1')).toBe(true);
  });

  it('a built-in type is deliverable whoever names it, and so is a type nobody contributed', () => {
    const { subject } = registry(() => false);
    // A contributor naming a built-in type does not become its gate.
    subject.register({ ownerModuleId: 'orders', eventType: 'order.created.v1' });
    expect(subject.isDeliverable('order.created.v1')).toBe(true);
    expect(subject.isDeliverable('order.status_changed.v1')).toBe(true);
  });
});
