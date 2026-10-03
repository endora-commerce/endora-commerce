/**
 * The CMS editor renderer of the badge: the storefront's own component, so the
 * canvas shows exactly what the storefront will draw. The fields, the label and
 * the default props come from the manifest declaration, not from here.
 */
import type { PageBuilderBlockEditorConfig } from '@endora-commerce/page-builder-core/contributions';

import { Badge } from '../storefront/Badge.js';

const editor: PageBuilderBlockEditorConfig = { render: Badge };

export default editor;
