import { ServiceBroker, Errors } from 'moleculer';

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    workspaceAiSetting: {
      findUnique: jest.fn(),
    },
  },
}));

import AiService from '../src/services/ai.service';
import prisma from '../src/lib/prisma';
import { encryptSecret } from '../src/lib/secrets';
import { ContinueStyleAwareRequestSchema } from '../src/types/ai';

type MockFetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

describe('ai.service continueStyleAware', () => {
  let broker: ServiceBroker;
  const db = prisma as unknown as {
    workspaceAiSetting: { findUnique: jest.Mock };
  };
  const originalEnv = process.env;
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;

  const validPayload = {
    intent: 'summary' as const,
    workspaceId: 'ws-1',
    contextText: 'Автор уже сформулировал ключевую мысль и развивает её дальше.',
    authorStyleProfile: {
      tone: 'calm',
      sentenceLength: 'medium' as const,
      formality: 0.45,
      emojiUsage: 0,
      rhythm: 'flowing' as const,
      typicalPatterns: ['коротко говоря'],
      forbiddenPhrases: ['подводя итог'],
      lexicalFeatures: ['точность', 'ясность'],
    },
    constraints: {
      maxWords: 20,
      preserveTone: true as const,
      noCliches: true as const,
      noNewFacts: true as const,
    },
    language: 'ru' as const,
  };

  function setMockFetch(fn: (url: string, init: unknown) => Promise<MockFetchResponse>): void {
    (globalThis as { fetch?: unknown }).fetch = fn as unknown;
  }

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();

    process.env = {
      ...originalEnv,
      AI_SECRETS_ENCRYPTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      OPENROUTER_TIMEOUT_MS: '20000',
      OPENROUTER_MAX_RETRIES: '1',
    };
    db.workspaceAiSetting.findUnique.mockResolvedValue({
      openrouterApiKeyEncrypted: encryptSecret('test-api-key'),
      openrouterModel: 'google/gemini-2.0-flash-001',
    });

    broker = new ServiceBroker({ logger: false });
    broker.createService(AiService);
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    process.env = originalEnv;
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
  });

  it('returns cleaned OpenRouter response on success', async () => {
    setMockFetch(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Продолжение:   "Тут уже сказано главное, поэтому стоит держаться той же линии."   ',
              },
            },
          ],
        }),
    }));

    const result = await broker.call('ai.continueStyleAware', validPayload) as {
      text: string;
      meta: { provider: string; model?: string; truncated: boolean; intent: string };
    };

    expect(result.meta.provider).toBe('openrouter');
    expect(result.meta.model).toBe('google/gemini-2.0-flash-001');
    expect(result.text.startsWith('Тут уже сказано главное')).toBe(true);
    expect(result.text.includes('Продолжение:')).toBe(false);
    expect(result.text.includes('"')).toBe(false);
    expect(result.meta.intent).toBe('summary');
  });

  it('uses fallback template on timeout/error', async () => {
    setMockFetch(async () => {
      throw new Error('socket hang up');
    });

    const result = await broker.call('ai.continueStyleAware', {
      ...validPayload,
      authorStyleProfile: {
        ...validPayload.authorStyleProfile,
        rhythm: 'choppy',
        emojiUsage: 0.8,
        formality: 0.2,
      },
      constraints: {
        ...validPayload.constraints,
        maxWords: 60,
      },
    }) as { text: string; meta: { provider: string; truncated: boolean } };

    expect(result.meta.provider).toBe('fallback');
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toContain('🙂');
  });

  it('truncates output when it exceeds maxWords tolerance', async () => {
    const veryLongText = Array.from({ length: 40 }, (_, idx) => `слово${idx + 1}`).join(' ');

    setMockFetch(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: veryLongText } }],
        }),
    }));

    const result = await broker.call('ai.continueStyleAware', {
      ...validPayload,
      constraints: {
        ...validPayload.constraints,
        maxWords: 20,
      },
    }) as { text: string; meta: { truncated: boolean } };

    const wordCount = result.text.trim().split(/\s+/).filter(Boolean).length;

    expect(result.meta.truncated).toBe(true);
    expect(wordCount).toBeLessThanOrEqual(20);
  });

  it('throws clear configuration error when workspace apiKey is missing', async () => {
    db.workspaceAiSetting.findUnique.mockResolvedValueOnce({
      openrouterApiKeyEncrypted: null,
      openrouterModel: 'google/gemini-2.0-flash-001',
    });

    setMockFetch(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'text' } }],
        }),
    }));

    await expect(
      broker.call('ai.continueStyleAware', validPayload),
    ).rejects.toMatchObject({
      code: 500,
      type: 'AI_CONFIG_ERROR',
      message: expect.stringContaining('workspace AI settings'),
    });
  });

  it('validates input schema constraints', () => {
    const parsed = ContinueStyleAwareRequestSchema.safeParse({
      ...validPayload,
      contextText: '',
      constraints: { ...validPayload.constraints, maxWords: 10 },
      authorStyleProfile: {
        ...validPayload.authorStyleProfile,
        formality: 1.4,
      },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error('Expected validation failure');
    }

    const messages = parsed.error.errors.map((issue) => issue.message).join(' | ');
    expect(messages).toContain('at least 1 character');
    expect(messages).toContain('Number must be less than or equal to 1');
  });

  it('returns validation error from action on invalid payload', async () => {
    await expect(
      broker.call('ai.continueStyleAware', {
        ...validPayload,
        constraints: {
          ...validPayload.constraints,
          maxWords: 401,
        },
      }),
    ).rejects.toBeInstanceOf(Errors.MoleculerClientError);
  });
});
