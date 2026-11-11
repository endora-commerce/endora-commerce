import { describe, expect, it } from 'vitest';
import {
  customerInputSurfacesOf,
  SUPPORTED_ENTITIES,
  SUPPORTED_ENTITY_TYPES,
} from './custom-field-registry.js';

/**
 * The registry markers of `specs/157-custom-fields-list-filters/` (data-model
 * §2): which entity types offer the list-filter option, and which follow an
 * owner module.
 */
describe('custom-field registry', () => {
  it('offers the list-filter option on exactly order, quote_request, opportunity, project and task', () => {
    const offering = SUPPORTED_ENTITY_TYPES.filter((type) => SUPPORTED_ENTITIES[type].listFilter === true);
    expect([...offering].sort()).toEqual(['opportunity', 'order', 'project', 'quote_request', 'task']);
  });

  it('names the owner of quote_request, opportunity, project and task, and of no other type', () => {
    expect(SUPPORTED_ENTITIES.quote_request.ownerModuleId).toBe('quote_requests');
    expect(SUPPORTED_ENTITIES.opportunity.ownerModuleId).toBe('crm');
    // `specs/163-projects-and-tasks/` research R-18.
    expect(SUPPORTED_ENTITIES.project.ownerModuleId).toBe('projects');
    expect(SUPPORTED_ENTITIES.project.orgOwned).toBe(true);
    const owned = SUPPORTED_ENTITY_TYPES.filter((type) => SUPPORTED_ENTITIES[type].ownerModuleId !== undefined);
    // `specs/165-task-management/` research R-8.
    expect(SUPPORTED_ENTITIES.task.ownerModuleId).toBe('tasks');
    expect(SUPPORTED_ENTITIES.task.orgOwned).toBe(false);
    expect([...owned].sort()).toEqual(['opportunity', 'project', 'quote_request', 'task']);
  });

  // `specs/162-custom-fields-value-carry/` data-model §1.1 — the carry pairs.
  it('offers carry targets on exactly quote_request, order and opportunity', () => {
    expect(SUPPORTED_ENTITIES.quote_request.carryTargets).toEqual(['order', 'opportunity']);
    expect(SUPPORTED_ENTITIES.order.carryTargets).toEqual(['opportunity']);
    expect(SUPPORTED_ENTITIES.opportunity.carryTargets).toEqual(['quote_request', 'order']);
    const carrying = SUPPORTED_ENTITY_TYPES.filter((type) => SUPPORTED_ENTITIES[type].carryTargets !== undefined);
    expect([...carrying].sort()).toEqual(['opportunity', 'order', 'quote_request']);
  });

  it('never offers a type as its own carry target', () => {
    for (const type of SUPPORTED_ENTITY_TYPES) {
      expect(SUPPORTED_ENTITIES[type].carryTargets ?? []).not.toContain(type);
    }
  });

  it('keeps product host-managed', () => {
    expect(SUPPORTED_ENTITIES.product.managedBy?.moduleId).toBe('catalog');
  });
  // `specs/175-buyer-input-custom-fields/` research R-2, FR-002.
  it('offers the organization.register input surface on organization and customer only', () => {
    expect(customerInputSurfacesOf('organization')).toEqual(['organization.register']);
    expect(customerInputSurfacesOf('customer')).toEqual(['organization.register']);
    for (const type of SUPPORTED_ENTITY_TYPES) {
      if (type === 'organization' || type === 'customer') continue;
      expect(customerInputSurfacesOf(type)).toEqual([]);
    }
  });

  it('answers no input surface for a type the registry does not hold', () => {
    expect(customerInputSurfacesOf('invoice')).toEqual([]);
  });
});
