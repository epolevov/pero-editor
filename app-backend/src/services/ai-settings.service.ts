import { Context, Errors, Service, ServiceBroker } from 'moleculer';
import prisma from '../lib/prisma';
import { encryptSecret } from '../lib/secrets';

interface AiSettingsGetParams {
  workspaceId: string;
}

interface AiSettingsUpdateParams {
  workspaceId: string;
  apiKey?: string;
  model?: string;
}

interface AiSettingsClearApiKeyParams {
  workspaceId: string;
}

interface AiSettingsResponse {
  workspaceId: string;
  hasApiKey: boolean;
  model: string | null;
}

export default class AiSettingsService extends Service {
  public constructor(broker: ServiceBroker) {
    super(broker);

    this.parseServiceSchema({
      name: 'ai-settings',

      actions: {
        get: {
          handler: (ctx: Context<AiSettingsGetParams>) => this.getSettings(ctx),
        },
        update: {
          handler: (ctx: Context<AiSettingsUpdateParams>) =>
            this.updateSettings(ctx),
        },
        clearApiKey: {
          handler: (ctx: Context<AiSettingsClearApiKeyParams>) =>
            this.clearApiKey(ctx),
        },
      },
    });
  }

  private async ensureWorkspaceExists(workspaceId: string): Promise<void> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });

    if (!workspace) {
      throw new Errors.MoleculerClientError(
        `Workspace ${workspaceId} not found`,
        404,
        'WORKSPACE_NOT_FOUND',
      );
    }
  }

  private normalizeModel(model: string | undefined): string | null | undefined {
    if (model === undefined) {
      return undefined;
    }
    const trimmed = model.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async getSettings(
    ctx: Context<AiSettingsGetParams>,
  ): Promise<AiSettingsResponse> {
    const { workspaceId } = ctx.params;
    return this.getSettingsByWorkspaceId(workspaceId);
  }

  private async getSettingsByWorkspaceId(
    workspaceId: string,
  ): Promise<AiSettingsResponse> {
    await this.ensureWorkspaceExists(workspaceId);

    const settings = await prisma.workspaceAiSetting.findUnique({
      where: { workspaceId },
      select: {
        workspaceId: true,
        openrouterApiKeyEncrypted: true,
        openrouterModel: true,
      },
    });

    return {
      workspaceId,
      hasApiKey: Boolean(settings?.openrouterApiKeyEncrypted),
      model: settings?.openrouterModel ?? null,
    };
  }

  private async updateSettings(
    ctx: Context<AiSettingsUpdateParams>,
  ): Promise<AiSettingsResponse> {
    const { workspaceId, apiKey, model } = ctx.params;

    if (apiKey === undefined && model === undefined) {
      throw new Errors.MoleculerClientError(
        'At least one field is required: apiKey or model',
        422,
        'VALIDATION_ERROR',
      );
    }

    await this.ensureWorkspaceExists(workspaceId);

    const updateData: {
      openrouterApiKeyEncrypted?: string | null;
      openrouterModel?: string | null;
    } = {};

    if (apiKey !== undefined) {
      const trimmed = apiKey.trim();
      if (!trimmed) {
        throw new Errors.MoleculerClientError(
          'apiKey cannot be empty',
          422,
          'VALIDATION_ERROR',
        );
      }

      try {
        updateData.openrouterApiKeyEncrypted = encryptSecret(trimmed);
      } catch (error) {
        throw new Errors.MoleculerError(
          error instanceof Error ? error.message : 'Failed to encrypt apiKey',
          500,
          'AI_CONFIG_ERROR',
        );
      }
    }

    const normalizedModel = this.normalizeModel(model);
    if (normalizedModel !== undefined) {
      updateData.openrouterModel = normalizedModel;
    }

    const createdData = {
      workspaceId,
      openrouterApiKeyEncrypted:
        updateData.openrouterApiKeyEncrypted ?? null,
      openrouterModel: updateData.openrouterModel ?? null,
    };

    await prisma.workspaceAiSetting.upsert({
      where: { workspaceId },
      create: createdData,
      update: updateData,
    });

    return this.getSettingsByWorkspaceId(workspaceId);
  }

  private async clearApiKey(
    ctx: Context<AiSettingsClearApiKeyParams>,
  ): Promise<AiSettingsResponse> {
    const { workspaceId } = ctx.params;
    await this.ensureWorkspaceExists(workspaceId);

    await prisma.workspaceAiSetting.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        openrouterApiKeyEncrypted: null,
        openrouterModel: null,
      },
      update: {
        openrouterApiKeyEncrypted: null,
      },
    });

    return this.getSettingsByWorkspaceId(workspaceId);
  }
}
