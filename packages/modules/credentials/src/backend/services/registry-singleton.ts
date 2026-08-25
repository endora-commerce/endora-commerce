import { effectiveState } from '@endora-commerce/platform/kernel';
import { ConfigurationTypeRegistry } from './configuration-type-registry.js';

/**
 * Process-wide ConfigurationTypeRegistry (feature 058).
 *
 * The module lifecycle install-hook context is fixed (`{ em, redis, log,
 * module }`) and cannot carry services, so an external / overlay module cannot
 * receive the registry through dependency injection. This shared singleton is
 * the explicit cross-module seam a module imports to contribute a configuration
 * type on enable (mirrors `delivery_methods/services/registry-singleton.ts`):
 *
 *   import { configurationTypeRegistry } from '.../credentials/services/registry-singleton.js';
 *   configurationTypeRegistry.register(myConfigurationType);
 *
 * `composition.ts` populates this same instance with the core types (LLM, email
 * adapter) at boot and passes it to the credentials plugin, so a type registered
 * from an install hook is immediately recognised by the live admin + resolve
 * paths. Registering without editing the shared core registry satisfies
 * Principle XV.
 *
 * The presence probe is wired here rather than in the class: this is the one
 * instance that participates in the platform's lifecycle, and a registry a test
 * builds for itself should keep answering about the types that test registered
 * (issue #129). `presenceOf` rather than `isPresent`, because a type contributed
 * through this seam may name an owner no manifest declares, and collapsing
 * "unknown id" into "absent" would filter the extension point away.
 */
export const configurationTypeRegistry = new ConfigurationTypeRegistry(undefined, (moduleId) =>
  effectiveState.presenceOf(moduleId),
);
