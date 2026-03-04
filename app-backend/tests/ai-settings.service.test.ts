import { ServiceBroker } from 'moleculer';

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    workspace: {
      findUnique: jest.fn(),
    },
    workspaceAiSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

import AiSettingsService from '../src/services/ai-settings.service';
import prisma from '../src/lib/prisma';

const db = prisma as unknown as {
  workspace: { findUnique: jest.Mock };
  workspaceAiSetting: { findUnique: jest.Mock; upsert: jest.Mock };
};

describe('ai-settings.service', () => {
  const originalEnv = process.env;
  let broker: ServiceBroker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(AiSettingsService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      AI_SECRETS_ENCRYPTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns empty settings when no row exists', async () => {
    db.workspace.findUnique.mockResolvedValueOnce({ id: 'ws-1' });
    db.workspaceAiSetting.findUnique.mockResolvedValueOnce(null);

    const result = await broker.call<{
      workspaceId: string;
      hasApiKey: boolean;
      model: string | null;
    }, { workspaceId: string }>('ai-settings.get', { workspaceId: 'ws-1' });

    expect(result).toEqual({
      workspaceId: 'ws-1',
      hasApiKey: false,
      model: null,
    });
  });

  it('updates apiKey/model and returns masked settings', async () => {
    db.workspace.findUnique.mockResolvedValue({ id: 'ws-1' });
    db.workspaceAiSetting.upsert.mockResolvedValueOnce({});
    db.workspaceAiSetting.findUnique.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      openrouterApiKeyEncrypted: 'v1:any:any:any',
      openrouterModel: 'anthropic/claude-sonnet-4-5',
    });

    const result = await broker.call<{
      hasApiKey: boolean;
      model: string | null;
    }, { workspaceId: string; apiKey: string; model: string }>('ai-settings.update', {
      workspaceId: 'ws-1',
      apiKey: 'sk-or-test',
      model: 'anthropic/claude-sonnet-4-5',
    });

    expect(db.workspaceAiSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws-1' },
        update: expect.objectContaining({
          openrouterApiKeyEncrypted: expect.any(String),
          openrouterModel: 'anthropic/claude-sonnet-4-5',
        }),
      }),
    );
    expect(result.hasApiKey).toBe(true);
    expect(result.model).toBe('anthropic/claude-sonnet-4-5');
  });

  it('clears apiKey and keeps model', async () => {
    db.workspace.findUnique.mockResolvedValue({ id: 'ws-1' });
    db.workspaceAiSetting.upsert.mockResolvedValueOnce({});
    db.workspaceAiSetting.findUnique.mockResolvedValueOnce({
      workspaceId: 'ws-1',
      openrouterApiKeyEncrypted: null,
      openrouterModel: 'google/gemini-2.0-flash-001',
    });

    const result = await broker.call<{
      hasApiKey: boolean;
      model: string | null;
    }, { workspaceId: string }>('ai-settings.clearApiKey', { workspaceId: 'ws-1' });

    expect(db.workspaceAiSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ openrouterApiKeyEncrypted: null }),
      }),
    );
    expect(result.hasApiKey).toBe(false);
    expect(result.model).toBe('google/gemini-2.0-flash-001');
  });
});
