import { z } from 'zod';

/**
 * A copy of a published schema that refuses every key it does not declare, at
 * every depth.
 *
 * The schemas in `@endora-commerce/contracts` are non-strict objects — a
 * consumer must go on parsing a reply after the API gains a field — so parsing a
 * real reply with one proves that every declared field is there and well-typed,
 * and nothing about the keys the route answers *beside* them: zod drops those
 * silently. A contract test that wants "the wire carries nothing the contract
 * does not promise" parses with this copy instead; the published schema itself
 * stays lenient.
 *
 * Records (`z.record`) are left as they are — their keys are data, not shape.
 */
export function deepStrict(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodType> = {};
    for (const [key, value] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
      shape[key] = deepStrict(value);
    }
    return z.strictObject(shape);
  }
  if (schema instanceof z.ZodOptional) return deepStrict(schema.unwrap() as z.ZodType).optional();
  if (schema instanceof z.ZodNullable) return deepStrict(schema.unwrap() as z.ZodType).nullable();
  if (schema instanceof z.ZodDefault) {
    // The default only fills an absent key in; what is being checked here is
    // the keys that are present, so the inner schema, made optional, is enough.
    return deepStrict(schema.unwrap() as z.ZodType).optional();
  }
  if (schema instanceof z.ZodArray) return z.array(deepStrict(schema.element as z.ZodType));
  if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion) {
    const options = (schema.options as z.ZodType[]).map(deepStrict);
    return z.union(options as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }
  return schema;
}

/**
 * Every disagreement between a value and a schema, as `path: message` lines.
 * Asserted against `[]` so a failure names all the fields that drifted at once
 * rather than the first one zod met.
 */
export function disagreements(schema: z.ZodType, value: unknown): string[] {
  const parsed = schema.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}
