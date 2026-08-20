import { effectiveState } from '../../../kernel/lifecycle/effective-state.js';
import { PaymentAdapterRegistry } from './payment-adapter-registry.js';

/**
 * Process-wide PaymentAdapterRegistry (feature 034).
 *
 * The four gateway modules and `payments` import this instance directly and
 * push their adapters into it from their `ctx.onBoot` hook, so the platform has
 * exactly one table of adapters however many times it is composed. A module
 * contributes only adapters it owns, and names itself when it does.
 *
 * The presence probe is wired here rather than in the class: this is the one
 * instance that participates in the platform's lifecycle, and a registry a
 * test builds for itself should keep answering about the adapters that test
 * registered (issue #96).
 */
export const paymentAdapterRegistry = new PaymentAdapterRegistry(undefined, (moduleId) =>
  effectiveState.isPresent(moduleId),
);
