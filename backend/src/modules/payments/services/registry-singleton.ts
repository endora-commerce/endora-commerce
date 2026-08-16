import { effectiveState } from '../../../kernel/lifecycle/effective-state.js';
import { GatewayRefundRegistry } from './gateway-refund-registry.js';

/**
 * Process-wide GatewayRefundRegistry (feature 049).
 *
 * The four gateway modules import this instance directly and push their refund
 * handlers into it from their `ctx.onBoot` hook, so the platform has exactly
 * one table of handlers however many times it is composed. A module contributes
 * only the handler it owns, and names itself when it does.
 *
 * The presence probe is wired here rather than in the class, for the reason its
 * twin in `payment_methods` gives: this is the one instance that participates
 * in the platform's lifecycle, and a registry a test builds for itself should
 * keep answering about the handlers that test registered.
 */
export const gatewayRefundRegistry = new GatewayRefundRegistry(undefined, (moduleId) =>
  effectiveState.isPresent(moduleId),
);
