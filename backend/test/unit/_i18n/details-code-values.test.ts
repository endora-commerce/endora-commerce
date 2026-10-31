import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { type SettingWriteValidationInput } from '@endora-commerce/contracts';
import { registerErrorEnvelope } from '@endora-commerce/platform/composition';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';
import { createMinOrderValueValidator } from '../../../../packages/modules/orders/src/backend/services/min-order-value-write-validator.js';
import { priorityUnknown } from '../../../../packages/modules/tasks/src/backend/services/priority-service.js';
import { assertEmailActivationWritable } from '../../../../packages/modules/transactional_emails/src/backend/commands/email-activation.commands.js';
import type { EmailDefaultsRegistry } from '../../../../packages/modules/transactional_emails/src/backend/services/email-defaults-registry.js';

/**
 * Issue #569 — `details.code` carries a refusal token or nothing, never a value.
 *
 * The envelope reads `details.code` as the token that picks the sentence:
 * `errors.<CODE>.<token>`. Three raise sites put a **value** there — a setting
 * code, a priority code the caller sent, an e-mail's registry code — so the
 * envelope asked for a key no bundle can hold, the translator answered the
 * thrower's English, and the Polish sentence each code already had (or, for the
 * e-mail, could have) was never shown.
 *
 * Each case below raises the error through the module's own raise site, sends
 * it through the real envelope with the routing the platform composes, and a
 * translator that behaves as both roots' do (`_i18n`'s substitution, the
 * written message for a missing key). The rendered Polish message must be the
 * bundle's sentence — not the English one, which is what a missing key or an
 * unfilled placeholder silently falls back to — and must name the value where
 * the sentence is about one.
 */

const layout = await requireModuleLayout('[details-code-values]');

function bundle(moduleId: string, language: 'en' | 'pl'): Record<string, string> {
  const directory = layout.moduleDirectoryOf(moduleId);
  if (directory === null) throw new Error(`[details-code-values] no such module: ${moduleId}`);
  return JSON.parse(readFileSync(join(directory, 'i18n', `${language}.json`), 'utf8')) as Record<
    string,
    string
  >;
}

/** `_i18n`'s own substitution, and both roots' missing-key fallback. */
async function translate(args: {
  moduleId: string;
  key: string;
  language: string;
  originalMessage: string;
  params?: Record<string, string | number>;
}): Promise<string> {
  const sentence = bundle(args.moduleId, args.language === 'pl' ? 'pl' : 'en')[args.key];
  if (sentence === undefined) return args.originalMessage;
  return sentence.replace(/\{(\w+)\}/g, (_match, name: string) =>
    args.params?.[name] != null ? String(args.params[name]) : `{${name}}`,
  );
}

async function render(raise: () => unknown, language: 'en' | 'pl') {
  const app = Fastify();
  registerErrorEnvelope(app, {
    errorTranslationTargets: DECLARED_ERROR_TRANSLATION_TARGETS,
    translateErrorMessage: translate,
    resolvePreferredLanguage: async () => language,
  });
  app.get('/raise', async () => {
    await raise();
    return { ok: true };
  });
  await app.ready();
  const response = await app.inject({ method: 'GET', url: '/raise' });
  await app.close();
  return response.json() as {
    error: { code: string; message: string; details?: Record<string, unknown> };
  };
}

const minOrderValue = (): Promise<void> =>
  createMinOrderValueValidator().validate({
    code: 'orders.min_order_value',
    ownerModuleId: 'orders',
    proposedValue: 100.005,
  } as unknown as SettingWriteValidationInput);

const unknownPriority = (): never => {
  throw priorityUnknown('whenever');
};

const protectedEmail = (): void =>
  assertEmailActivationWritable('account_activation', {
    nonDeactivatableReasonOf: () => 'Required to create an account.',
  } as unknown as EmailDefaultsRegistry);

const CASES = [
  {
    code: 'AMOUNT_PRECISION_EXCEEDED',
    raise: minOrderValue,
    // The sentence is shared with every money field the envelope refuses from a
    // Zod issue, whose details carry no value — so it names none, and the
    // setting travels as a member of its own.
    member: ['setting', 'orders.min_order_value'],
    named: null,
  },
  {
    code: 'TASK_PRIORITY_UNKNOWN',
    raise: unknownPriority,
    member: ['priorityCode', 'whenever'],
    named: 'whenever',
  },
  {
    code: 'TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE',
    raise: protectedEmail,
    member: ['emailCode', 'account_activation'],
    named: 'account_activation',
  },
] as const;

describe('a value carried by a refusal (issue #569)', () => {
  for (const { code, raise, member, named } of CASES) {
    describe(code, () => {
      const target = DECLARED_ERROR_TRANSLATION_TARGETS[code]!;

      it('carries no value in details.code, and the value in a member of its own', async () => {
        const { error } = await render(raise, 'en');
        expect(error.code).toBe(code);
        expect(error.details).toBeDefined();
        expect(error.details!['code']).toBeUndefined();
        expect(error.details![member[0]]).toBe(member[1]);
      });

      it('renders the bundle’s Polish sentence, not the English fallback', async () => {
        const { error } = await render(raise, 'pl');
        const polish = bundle(target.moduleId, 'pl')[target.key];
        const english = bundle(target.moduleId, 'en')[target.key];
        expect(polish, `${target.key} missing from ${target.moduleId}/pl.json`).toBeTypeOf('string');
        expect(english, `${target.key} missing from ${target.moduleId}/en.json`).toBeTypeOf('string');
        expect(error.message).not.toMatch(/\{\w+\}/);
        expect(error.message).toBe(await translate({
          moduleId: target.moduleId,
          key: target.key,
          language: 'pl',
          originalMessage: '',
          params: { [member[0]]: member[1] },
        }));
        expect(error.message).not.toBe(
          await translate({
            moduleId: target.moduleId,
            key: target.key,
            language: 'en',
            originalMessage: '',
            params: { [member[0]]: member[1] },
          }),
        );
        if (named !== null) expect(error.message).toContain(named);
      });

      it('renders the English sentence with the value filled in', async () => {
        const { error } = await render(raise, 'en');
        expect(error.message).not.toMatch(/\{\w+\}/);
        if (named !== null) expect(error.message).toContain(named);
        expect(error.message).toBe(await translate({
          moduleId: target.moduleId,
          key: target.key,
          language: 'en',
          originalMessage: '',
          params: { [member[0]]: member[1] },
        }));
      });
    });
  }
});
