// @b2b/email-components — shared transactional-email building blocks (feature 047).
//
// Root entry (admin/editor surface): re-exports the React Puck config plus the
// pure schema/render/directive/tree/defaults modules. The BACKEND must import
// the pure subpaths directly (e.g. `@b2b/email-components/render/render-email-html`)
// to avoid pulling React into the send path.

export * from './schema/component-types.js';
export * from './schema/envelope.js';
export * from './render/escape-html.js';
export * from './render/render-email-html.js';
export * from './render/render-email-text.js';
export * from './directives/directive-engine.js';
export * from './tree/walk-embeds.js';
export * from './defaults/default-header.js';
export * from './defaults/default-footer.js';
export * from './config.js';
