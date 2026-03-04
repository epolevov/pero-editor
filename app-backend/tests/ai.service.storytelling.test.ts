import { ServiceBroker } from 'moleculer';

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
import { STYLE_AWARE_SYSTEM_PROMPT } from '../src/lib/prompts';

type MockFetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type FetchInitLike = {
  body: string;
};

describe('ai.service storytelling integration', () => {
  let broker: ServiceBroker;
  const db = prisma as unknown as {
    workspaceAiSetting: { findUnique: jest.Mock };
  };
  const originalEnv = process.env;
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;

  const basePayload = {
    intent: 'conclusion' as const,
    workspaceId: 'ws-1',
    contextText: 'Сначала я вошел в дом. Потом Анна прошептала: "Тише". Я медленно закрыл дверь.',
    authorStyleProfile: {
      tone: 'calm',
      sentenceLength: 'medium' as const,
      formality: 0.4,
      emojiUsage: 0,
      rhythm: 'flowing' as const,
      typicalPatterns: [],
      forbiddenPhrases: [],
      lexicalFeatures: [],
    },
    constraints: {
      maxWords: 40,
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
      OPENROUTER_MAX_RETRIES: '0',
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

  it('sets storytellingDetected=true for narrative context', async () => {
    setMockFetch(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'Я сделал шаг и остановился у окна.' } }],
        }),
    }));

    const result = await broker.call('ai.continueStyleAware', basePayload) as {
      meta: { storytellingDetected: boolean };
    };

    expect(result.meta.storytellingDetected).toBe(true);
  });

  it('sets storytellingDetected=false for essay context', async () => {
    setMockFetch(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'Следующий тезис поддерживает исходную аргументацию.' } }],
        }),
    }));

    const result = await broker.call('ai.continueStyleAware', {
      ...basePayload,
      contextText:
        'Аргументация строится на критериях эффективности и прогнозируемой стоимости. Далее уместно оценить риски внедрения по измеримым метрикам.',
    }) as { meta: { storytellingDetected: boolean } };

    expect(result.meta.storytellingDetected).toBe(false);
  });

  it('adapts fallback template to narrative mode', async () => {
    setMockFetch(async () => {
      throw new Error('socket hang up');
    });

    const result = await broker.call('ai.continueStyleAware', {
      ...basePayload,
      intent: 'summary',
    }) as { text: string; meta: { provider: string; storytellingDetected: boolean } };

    expect(result.meta.provider).toBe('fallback');
    expect(result.meta.storytellingDetected).toBe(true);
    expect(result.text.toLowerCase()).not.toContain('подводя итог');
    expect(result.text).toMatch(/[Яя]/u);
  });

  it('includes narrative instructions in system prompt and storytelling block in user prompt', async () => {
    let capturedBody = '';

    setMockFetch(async (_url, init) => {
      capturedBody = (init as FetchInitLike).body;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: 'Я продолжаю движение в том же ритме.' } }],
          }),
      };
    });

    await broker.call('ai.continueStyleAware', basePayload);

    const parsed = JSON.parse(capturedBody) as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemMessage = parsed.messages.find((msg) => msg.role === 'system');
    const userMessage = parsed.messages.find((msg) => msg.role === 'user');

    expect(systemMessage?.content.includes('If storytelling.isNarrative == true:')).toBe(true);
    expect(systemMessage?.content.includes('Never convert a narrative into an essay.')).toBe(true);
    expect(STYLE_AWARE_SYSTEM_PROMPT.includes('If storytelling.isNarrative == false:')).toBe(true);
    expect(userMessage?.content.includes('"storytelling"')).toBe(true);
  });
});
