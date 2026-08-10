import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  GroupCreateRequestSchema,
  GroupUpdateRequestSchema,
  ResetValueQuerySchema,
  SetValueRequestSchema,
  SettingsListQuerySchema,
} from '@b2b/contracts';
import type { SettingsAdminService, AdminAuditContext } from './services/settings-admin.service.js';
import type { Setting } from '../../kernel/settings/setting.entity.js';
import type { SettingGroup } from '../../kernel/settings/setting-group.entity.js';
import type { SettingValue } from '../../kernel/settings/setting-value.entity.js';
import { secretValueIsSet } from '../../kernel/settings/secret-value-codec.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Admin HTTP surface — feature 004 / US2 (T035).
 *
 * Mounts under `/api/v1/admin/settings/*` with:
 *   - GET    /                    — list groups + settings (settings.read)
 *   - GET    /:code               — single setting detail (settings.read)
 *   - PUT    /:code/value         — set value (settings.write)
 *   - DELETE /:code/values        — reset values (settings.write)
 *   - GET    /groups              — list groups only (settings.read)
 *   - POST   /groups              — create manual group (settings.write)
 *   - PATCH  /groups/:code        — rename / rescope (settings.write)
 *   - DELETE /groups/:code        — delete + reassign (settings.write)
 *
 * `If-Match` is parsed via the request body's `expectedVersion` field for
 * mutations that warrant optimistic concurrency (matching feature 003's
 * pattern; see services/settings-admin.service.ts). Stale → 409
 * VERSION_CONFLICT.
 */

export interface SettingsAdminDeps {
  adminService: SettingsAdminService;
  requireAdmin: RequireAdminFactory;
  resolveAdminAuditContext?: (req: FastifyRequest) => AdminAuditContext;
}

interface SetValueWithVersion {
  expectedVersion?: string;
}

export async function registerSettingsAdminRoutes(
  app: FastifyInstance,
  deps: SettingsAdminDeps,
): Promise<void> {
  const { adminService, requireAdmin, resolveAdminAuditContext } = deps;

  const auditContext = (request: FastifyRequest): AdminAuditContext => {
    const ctx = resolveAdminAuditContext?.(request) ?? {
      actorAdminUserId: null,
    };
    const rid = request.headers['x-request-id'];
    return {
      ...ctx,
      requestId: typeof rid === 'string' ? rid : null,
    };
  };

  function setEtag(reply: FastifyReply, version: string): void {
    reply.header('etag', `"${version}"`);
  }

  /**
   * Feature 073 — the presence classification the service computed. Passed
   * through rather than recomputed: `present` is decided in exactly one place
   * so two implementations cannot disagree. Defaults to editable for the two
   * call sites that have no classification (group CRUD echoes).
   */
  interface SettingClassification {
    editable: boolean;
    activationControl: boolean;
  }

  function serializeSetting(
    setting: Setting,
    values: SettingValue[],
    classification: SettingClassification = { editable: true, activationControl: false },
  ): Record<string, unknown> {
    // Secret settings are write-only (feature 043, FR-021): every read
    // replaces stored values with null + isSet indicators. The plaintext (or
    // its ciphertext envelope) never leaves the backend through this API.
    const isSecret = setting.valueType === 'secret';
    return {
      id: setting.id,
      code: setting.code,
      name: setting.name,
      description: setting.description ?? null,
      valueType: setting.valueType,
      ownerModule: setting.ownerModule,
      salesChannelCodes: setting.salesChannels.getItems().map((c) => c.code),
      enumOptions: setting.enumOptions ?? null,
      configurationType: setting.configurationType ?? null,
      defaultValue: isSecret ? null : setting.defaultValue,
      globalValue: isSecret ? null : setting.globalValue ?? null,
      ...(isSecret ? { globalValueIsSet: secretValueIsSet(setting.globalValue) } : {}),
      valuesByChannel: values.map((v) => ({
        salesChannelId: v.salesChannel.id,
        salesChannelCode: v.salesChannel.code,
        value: isSecret ? null : v.value,
        ...(isSecret ? { isSet: secretValueIsSet(v.value) } : {}),
        updatedAt: v.updatedAt.toISOString(),
      })),
      version: adminService.computeSettingVersion(setting, values),
      editable: classification.editable,
      activationControl: classification.activationControl,
    };
  }

  function serializeGroup(
    group: SettingGroup,
    settings: Array<{
      setting: Setting;
      values: SettingValue[];
      editable: boolean;
      activationControl: boolean;
    }>,
  ): Record<string, unknown> {
    return {
      id: group.id,
      code: group.code,
      name: group.name,
      isSystemProtected: group.isSystemProtected,
      ownerModule: group.ownerModule,
      salesChannelCodes: group.salesChannels.getItems().map((c) => c.code),
      settings: settings.map((s) =>
        serializeSetting(s.setting, s.values, {
          editable: s.editable,
          activationControl: s.activationControl,
        }),
      ),
    };
  }

  // --------------------------------------------------------------------
  // List + detail
  // --------------------------------------------------------------------

  app.get(
    '/api/v1/admin/settings',
    { preHandler: requireAdmin('settings:read') },
    async (request) => {
      const q = SettingsListQuerySchema.parse(request.query ?? {});
      const filter = q.groupCode ? { groupCode: q.groupCode } : undefined;
      const result = await adminService.listGroups(filter);
      return { groups: result.groups.map((g) => serializeGroup(g.group, g.settings)) };
    },
  );

  app.get<{ Params: { code: string } }>(
    '/api/v1/admin/settings/:code',
    { preHandler: requireAdmin('settings:read') },
    async (request, reply) => {
      const { setting, values, version, editable, activationControl } =
        await adminService.getSettingByCode(request.params.code);
      setEtag(reply, version);
      return serializeSetting(setting, values, { editable, activationControl });
    },
  );

  // --------------------------------------------------------------------
  // Value writes
  // --------------------------------------------------------------------

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/settings/:code/value',
    { preHandler: requireAdmin('settings:write') },
    async (request, reply) => {
      const body = SetValueRequestSchema.parse(request.body);
      const expectedVersion =
        ((request.body ?? {}) as SetValueWithVersion).expectedVersion ??
        parseIfMatch(request);
      const ctx = auditContext(request);
      let result;
      if (body.scope === 'all') {
        result = await adminService.setValueForAllChannels(
          request.params.code,
          body.value,
          expectedVersion,
          ctx,
        );
      } else {
        result = await adminService.setValueForSubset(
          request.params.code,
          body.salesChannelCodes,
          body.value,
          expectedVersion,
          ctx,
        );
      }
      setEtag(reply, result.newVersion);
      // Refresh full detail for the response.
      const detail = await adminService.getSettingByCode(request.params.code);
      return serializeSetting(detail.setting, detail.values, {
        editable: detail.editable,
        activationControl: detail.activationControl,
      });
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/settings/:code/values',
    { preHandler: requireAdmin('settings:write') },
    async (request, reply) => {
      const q = ResetValueQuerySchema.parse(request.query ?? {});
      const channelCodes = q.salesChannelCodes
        ? q.salesChannelCodes.split(',').map((c) => c.trim()).filter(Boolean)
        : undefined;
      const ctx = auditContext(request);
      const result = await adminService.resetValues(
        request.params.code,
        channelCodes,
        ctx,
      );
      setEtag(reply, result.newVersion);
      const detail = await adminService.getSettingByCode(request.params.code);
      return serializeSetting(detail.setting, detail.values, {
        editable: detail.editable,
        activationControl: detail.activationControl,
      });
    },
  );

  // --------------------------------------------------------------------
  // Group CRUD
  // --------------------------------------------------------------------

  app.get(
    '/api/v1/admin/settings/groups',
    { preHandler: requireAdmin('settings:read') },
    async () => {
      const result = await adminService.listGroups();
      return {
        groups: result.groups.map((g) => ({
          id: g.group.id,
          code: g.group.code,
          name: g.group.name,
          isSystemProtected: g.group.isSystemProtected,
          ownerModule: g.group.ownerModule,
          salesChannelCodes: g.group.salesChannels.getItems().map((c) => c.code),
          settingCount: g.settings.length,
          updatedAt: g.group.updatedAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/api/v1/admin/settings/groups',
    { preHandler: requireAdmin('settings:write') },
    async (request, reply) => {
      const body = GroupCreateRequestSchema.parse(request.body);
      const ctx = auditContext(request);
      const created = await adminService.createGroup(
        {
          code: body.code,
          name: body.name,
          ...(body.salesChannelCodes !== undefined
            ? { salesChannelCodes: body.salesChannelCodes }
            : {}),
        },
        ctx,
      );
      reply.code(201);
      setEtag(reply, created.updatedAt.toISOString());
      return {
        id: created.id,
        code: created.code,
        name: created.name,
        isSystemProtected: created.isSystemProtected,
        ownerModule: created.ownerModule,
        salesChannelCodes: created.salesChannels.getItems().map((c) => c.code),
      };
    },
  );

  app.patch<{ Params: { code: string } }>(
    '/api/v1/admin/settings/groups/:code',
    { preHandler: requireAdmin('settings:write') },
    async (request, reply) => {
      const body = GroupUpdateRequestSchema.parse(request.body);
      const expectedVersion =
        ((request.body ?? {}) as { expectedVersion?: string }).expectedVersion ??
        parseIfMatch(request);
      const ctx = auditContext(request);
      const patch: { name?: string; salesChannelCodes?: string[] } = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.salesChannelCodes !== undefined) {
        patch.salesChannelCodes = body.salesChannelCodes;
      }
      const updated = await adminService.updateGroup(
        request.params.code,
        patch,
        expectedVersion,
        ctx,
      );
      setEtag(reply, updated.updatedAt.toISOString());
      return {
        id: updated.id,
        code: updated.code,
        name: updated.name,
        isSystemProtected: updated.isSystemProtected,
        ownerModule: updated.ownerModule,
        salesChannelCodes: updated.salesChannels.getItems().map((c) => c.code),
      };
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/settings/groups/:code',
    { preHandler: requireAdmin('settings:write') },
    async (request, reply) => {
      const ctx = auditContext(request);
      await adminService.deleteGroup(request.params.code, ctx);
      reply.code(204);
    },
  );
}

function parseIfMatch(request: FastifyRequest): string | null {
  const header = request.headers['if-match'];
  if (!header || typeof header !== 'string') return null;
  return header.replace(/^"|"$/g, '');
}

// Export a typed error helper so other modules can import the shape if needed.
export const _settingsRoutesErrors = ERROR_CODES;
