/**
 * `@endora-commerce/demo-composition` — the demo shop's cross-module wiring.
 *
 * The platform loads this package's root export when it finds the package in
 * an instance's `node_modules` carrying `"endora": { "type": "demo-composition" }`
 * in its `package.json`, and calls {@link createDemoComposition} once per
 * `demo seed` or `demo reset`. See `composition.ts` for what the steps are and
 * why they live here.
 *
 * The attribute helpers are exported for the host repository's own test
 * fixtures, which create attributes the same way the demo does: one copy of
 * that helper, not two (feature 113 FR-019).
 */
export {
  createDemoComposition,
  DEMO_BUYER_EMAIL,
  DEMO_BUYER_PASSWORD,
  DEMO_COMPOSITION_STEP_NAMES,
  DEMO_FOUNDATION_STEP_NAMES,
  type DemoCompositionDeps,
} from './composition.js';
export {
  createAttributeFixture,
  findAttributeDefinitionByKey,
  findAttributeExtensionByKey,
  type AttributeFixture,
  type AttributeFixtureInput,
  type CustomFieldDefinitionRow,
  type CustomFieldOptionRow,
  type ProductAttributeRow,
} from './attribute-fixtures.js';
