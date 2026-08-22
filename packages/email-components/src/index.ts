// @endora-commerce/email-components — shared transactional-email building blocks (feature 047).
//
// Root entry (admin/editor surface): re-exports the React Puck config plus the
// pure schema/render/directive/tree/defaults modules. The BACKEND must import
// the pure subpaths directly (e.g. `@endora-commerce/email-components/render/render-email-html`)
// to avoid pulling React into the send path.

export * from './schema/component-types.js';
export * from './schema/envelope.js';
export * from './render/escape-html.js';
export * from './render/render-email-html.js';
export * from './render/render-email-text.js';
export * from './render/sanitize-email-html.js';
export * from './render/sample-variables.js';
export * from './render/order-labels.js';
export * from './directives/directive-engine.js';
export * from './tree/walk-embeds.js';
export * from './defaults/default-header.js';
export * from './defaults/default-footer.js';
export * from './defaults/simple-email-body.js';
export * from './components/email-embeds-context.js';
export * from './components/email-branding-preview-context.js';
export * from './editor/email-row-layout-presets.js';
export * from './config.js';
