import {
  ANTI_SLOP_INTERNAL_LAYER,
  STYLE_AWARE_SYSTEM_PROMPT,
} from './prompts';

interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<FetchResponseLike>;

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterCompletionRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature: number;
  max_tokens: number;
}

interface OpenRouterChoice {
  message?: {
    content?: unknown;
  };
}

interface OpenRouterCompletionResponse {
  choices?: OpenRouterChoice[];
}

export interface OpenRouterClientConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  httpReferer?: string;
  xTitle?: string;
}

export interface OpenRouterResult {
  text: string;
  model: string;
}

export class OpenRouterConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'OpenRouterConfigError';
  }
}

export class OpenRouterRequestError extends Error {
  public readonly status?: number;
  public readonly retryable: boolean;

  public constructor(message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = 'OpenRouterRequestError';
    this.status = status;
    this.retryable = retryable;
  }
}

function resolveFetch(): FetchLike {
  const fetchRef = (globalThis as { fetch?: FetchLike }).fetch;
  if (!fetchRef) {
    throw new OpenRouterConfigError(
      'Global fetch is unavailable. Use Node.js 18+ or provide a fetch polyfill.',
    );
  }
  return fetchRef;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function extractTextContent(rawBody: string): string {
  let parsed: OpenRouterCompletionResponse;
  try {
    parsed = JSON.parse(rawBody) as OpenRouterCompletionResponse;
  } catch {
    throw new OpenRouterRequestError(
      'OpenRouter returned non-JSON response body.',
      false,
    );
  }

  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new OpenRouterRequestError(
      'OpenRouter response missing choices[0].message.content.',
      false,
    );
  }

  return content;
}

export function createOpenRouterClient(config: OpenRouterClientConfig) {
  const fetchImpl = resolveFetch();

  return {
    async createChatCompletion(args: {
      userContent: string;
      temperature: number;
      maxTokens: number;
      systemPrompt?: string;
    }): Promise<OpenRouterResult> {
      const systemContent =
        args.systemPrompt ?? `${STYLE_AWARE_SYSTEM_PROMPT}\n\n${ANTI_SLOP_INTERNAL_LAYER}`;
      const payload: OpenRouterCompletionRequest = {
        model: config.model,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: args.userContent },
        ],
        temperature: args.temperature,
        max_tokens: args.maxTokens,
      };

      const headers: Record<string, string> = {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      };

      if (config.httpReferer) headers['HTTP-Referer'] = config.httpReferer;
      if (config.xTitle) headers['X-Title'] = config.xTitle;

      let lastError: OpenRouterRequestError | null = null;
      const attempts = config.maxRetries + 1;

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

        try {
          const response = await fetchImpl(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              method: 'POST',
              headers,
              body: JSON.stringify(payload),
              signal: controller.signal,
            },
          );

          const rawBody = await response.text();

          if (!response.ok) {
            const retryable = shouldRetryStatus(response.status);
            throw new OpenRouterRequestError(
              `OpenRouter request failed with status ${response.status}.`,
              retryable,
              response.status,
            );
          }

          return {
            text: extractTextContent(rawBody),
            model: config.model,
          };
        } catch (error) {
          if (error instanceof OpenRouterRequestError) {
            lastError = error;
            if (!error.retryable || attempt === attempts - 1) break;
            await delay(200 * (attempt + 1));
            continue;
          }

          const isAbort =
            error instanceof Error &&
            (error.name === 'AbortError' || error.message.includes('aborted'));

          const wrapped = new OpenRouterRequestError(
            isAbort
              ? `OpenRouter request timed out after ${config.timeoutMs}ms.`
              : 'OpenRouter network request failed.',
            true,
          );
          lastError = wrapped;

          if (attempt === attempts - 1) break;
          await delay(200 * (attempt + 1));
        } finally {
          clearTimeout(timeoutId);
        }
      }

      throw lastError ??
        new OpenRouterRequestError('OpenRouter request failed unexpectedly.', true);
    },
  };
}
