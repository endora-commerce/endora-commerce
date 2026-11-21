/**
 * The CRM configuration — one place since issue #1557 (UX audit WORK-06): the
 * sidebar's *Configuration* row opens {@link CRM_CONFIGURATION_PATH}, the
 * workflow, its first tab; `CrmConfigurationTabs` switches to the tag list.
 *
 * The tag list sits under the row's address so the row lights up and the
 * breadcrumb names it there too: both match a row by prefix. Its address
 * before #1557, {@link LEGACY_CRM_TAGS_PATH}, redirects to it.
 */
export const CRM_CONFIGURATION_PATH = '/crm/workflow';
export const CRM_TAGS_PATH = `${CRM_CONFIGURATION_PATH}/tags`;
/** The tag list's address before issue #1557, a redirect now. */
export const LEGACY_CRM_TAGS_PATH = '/crm/tags';
