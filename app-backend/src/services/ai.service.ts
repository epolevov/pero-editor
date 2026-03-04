import { Context, Errors, Service, ServiceBroker } from 'moleculer';
import { ZodError } from 'zod';
import {
  createOpenRouterClient,
  OpenRouterClientConfig,
  OpenRouterConfigError,
  OpenRouterRequestError,
} from '../lib/openrouter';
import prisma from '../lib/prisma';
import { decryptSecret } from '../lib/secrets';
import {
  buildAuditUserInput,
  buildHooksUserInput,
  buildRewriteUserInput,
  buildSpellcheckUserInput,
  buildStyleAwareUserInput,
  defaultLegacyTone,
  FALLBACK_TEMPLATES,
  HOOKS_SYSTEM_PROMPT,
  AUDIT_SYSTEM_PROMPT,
  REWRITE_SYSTEM_PROMPT,
  SPELLCHECK_SYSTEM_PROMPT,
} from '../lib/prompts';
import { detectStorytelling } from '../lib/storytellingDetector';
import type {
  AuditRequest,
  AuditResponse,
  AuditSegment,
  ContinueRequest,
  ContinueResponse,
  HooksHook,
  HooksRequest,
  HooksResponse,
  RewriteRequest,
  RewriteResponse,
  RewriteVariant,
  SpellcheckRequest,
  SpellcheckResponse,
  SpellcheckIssue,
} from '../types';
import {
  ContinueStyleAwareRequestSchema,
  type AuthorStyleProfile,
  type ContinueIntent,
  type ContinueStyleAwareRequest,
  type ContinueStyleAwareResponse,
  type LegacyContinueRequest,
  type LegacyContinueResponse,
  type StorytellingProfile,
  formatZodError,
} from '../types/ai';

const DEFAULT_MAX_WORDS = 104;

const EN_FALLBACK_TEMPLATES: Record<ContinueIntent, string> = {
  summary:
    'Taken together, the point stays the same: the key idea is already stated, and the next lines should keep that direction without branching away.',
  example:
    'A concrete example makes it clear: the same approach works in a specific case because it relies on the logic already established above.',
  argument:
    'This position stands on the text\'s own logic: the claim has already been supported by the reasoning, and its strength comes from that consistency.',
  conclusion:
    'The thought closes naturally here: the essential points are already named, so the text can end in the same tone and direction.',
};

const CLICHE_PATTERNS = [
  /подводя\s+итог[аи]?/gi,
  /в\s+заключени[еи]/gi,
  /таким\s+образом/gi,
  /следует\s+отметить/gi,
  /необходимо\s+подчеркнуть/gi,
  /in\s+conclusion/gi,
  /to\s+sum\s+up/gi,
  /it\s+is\s+important\s+to\s+note/gi,
];
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.0-flash-001';

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default class AiService extends Service {
  public constructor(broker: ServiceBroker) {
    super(broker);

    this.parseServiceSchema({
      name: 'ai',

      actions: {
        // Legacy contract used by current WS pipeline.
        spellcheck: {
          handler: (ctx: Context<SpellcheckRequest>) => this.spellcheck(ctx),
        },
        rewrite: {
          handler: (ctx: Context<RewriteRequest>) => this.rewrite(ctx),
        },
        continue: {
          handler: (ctx: Context<LegacyContinueRequest>) => this.continueLegacy(ctx),
        },

        hooks: {
          handler: (ctx: Context<HooksRequest>) => this.generateHooks(ctx),
        },

        audit: {
          handler: (ctx: Context<AuditRequest>) => this.generateAudit(ctx),
        },

        // New style-aware actions.
        spellcheckHeuristic: {
          handler: (ctx: Context<SpellcheckRequest>) => this.spellcheck(ctx),
        },
        rewriteStyleAware: {
          handler: (ctx: Context<RewriteRequest>) => this.rewrite(ctx),
        },
        continueStyleAware: {
          handler: (ctx: Context<ContinueStyleAwareRequest>) =>
            this.continueStyleAware(ctx),
        },
      },
    });
  }

  private buildOpenRouterConfig(
    apiKey: string,
    model: string,
  ): OpenRouterClientConfig {
    return {
      apiKey,
      model,
      timeoutMs: Math.max(
        1000,
        parseIntegerEnv(process.env.OPENROUTER_TIMEOUT_MS, 20000),
      ),
      maxRetries: Math.max(
        0,
        parseIntegerEnv(process.env.OPENROUTER_MAX_RETRIES, 2),
      ),
      httpReferer: process.env.OPENROUTER_HTTP_REFERER?.trim() || undefined,
      xTitle: process.env.OPENROUTER_X_TITLE?.trim() || undefined,
    };
  }

  private async resolveOpenRouterConfig(
    workspaceId?: string,
  ): Promise<OpenRouterClientConfig> {
    if (!workspaceId) {
      throw new OpenRouterConfigError(
        'workspaceId is required for AI generation when using workspace OpenRouter settings.',
      );
    }

    const settings = await prisma.workspaceAiSetting.findUnique({
      where: { workspaceId },
      select: {
        openrouterApiKeyEncrypted: true,
        openrouterModel: true,
      },
    });

    let decryptedApiKey: string | undefined;
    if (settings?.openrouterApiKeyEncrypted) {
      try {
        decryptedApiKey = decryptSecret(settings.openrouterApiKeyEncrypted).trim();
      } catch (error) {
        throw new OpenRouterConfigError(
          error instanceof Error
            ? error.message
            : 'Failed to decrypt workspace OpenRouter API key.',
        );
      }
    }

    if (!decryptedApiKey) {
      throw new OpenRouterConfigError(
        'Missing OpenRouter API key in workspace AI settings.',
      );
    }

    const model = settings?.openrouterModel?.trim() || DEFAULT_OPENROUTER_MODEL;
    return this.buildOpenRouterConfig(decryptedApiKey, model);
  }

  private async spellcheck(ctx: Context<SpellcheckRequest>): Promise<SpellcheckResponse> {
    const { plainText, selectedText, selection, workspaceId } = ctx.params;
    const textToAnalyze = selectedText ?? plainText;
    const positionOffset = selection?.from ?? 0;

    try {
      const config = await this.resolveOpenRouterConfig(workspaceId);
      const client = createOpenRouterClient(config);

      const completion = await client.createChatCompletion({
        userContent: buildSpellcheckUserInput(textToAnalyze),
        temperature: 0.1,
        maxTokens: 1024,
        systemPrompt: SPELLCHECK_SYSTEM_PROMPT,
      });

      return { issues: parseSpellcheckIssues(completion.text, textToAnalyze, positionOffset) };
    } catch (error) {
      if (error instanceof OpenRouterConfigError) {
        throw new Errors.MoleculerError(error.message, 500, 'AI_CONFIG_ERROR');
      }
      this.logger.warn(
        `Spellcheck AI failed (${error instanceof Error ? error.message : 'unknown'}), using heuristic.`,
      );
      return this.spellcheckHeuristic(plainText);
    }
  }

  private spellcheckHeuristic(plainText: string): SpellcheckResponse {
    const issues: SpellcheckIssue[] = [];

    const doubleSpaceRe = /  +/g;
    let match: RegExpExecArray | null;
    while ((match = doubleSpaceRe.exec(plainText)) !== null) {
      issues.push({
        from: match.index,
        to: match.index + match[0].length,
        original: match[0],
        replacements: [' '],
        message: 'Лишние пробелы',
        confidence: 0.99,
      });
    }

    const exclamationRe = /!{3,}/g;
    while ((match = exclamationRe.exec(plainText)) !== null) {
      issues.push({
        from: match.index,
        to: match.index + match[0].length,
        original: match[0],
        replacements: ['!'],
        message: 'Много восклицательных знаков',
        confidence: 0.95,
      });
    }

    const hasCyrillic = /[а-яё]/i.test(plainText);
    if (hasCyrillic) {
      const latinWordRe = /\b[a-zA-Z]{2,}\b/g;
      while ((match = latinWordRe.exec(plainText)) !== null) {
        issues.push({
          from: match.index,
          to: match.index + match[0].length,
          original: match[0],
          replacements: [],
          message: `Латинское слово «${match[0]}» в кириллическом тексте`,
          confidence: 0.7,
        });
      }
    }

    return { issues };
  }

  private async rewrite(ctx: Context<RewriteRequest>): Promise<RewriteResponse> {
    const { selectedText, contextText, workspaceId } = ctx.params;

    try {
      const config = await this.resolveOpenRouterConfig(workspaceId);
      const client = createOpenRouterClient(config);

      const completion = await client.createChatCompletion({
        userContent: buildRewriteUserInput(selectedText, contextText),
        temperature: 0.7,
        maxTokens: 512,
        systemPrompt: REWRITE_SYSTEM_PROMPT,
      });

      const variants = parseRewriteVariants(completion.text, selectedText);
      if (variants.length > 0) {
        return { variants, confidence: 0.9 };
      }
    } catch (error) {
      if (error instanceof OpenRouterConfigError) {
        throw new Errors.MoleculerError(error.message, 500, 'AI_CONFIG_ERROR');
      }
      this.logger.warn(
        `Rewrite AI failed (${error instanceof Error ? error.message : 'unknown'}), using heuristic.`,
      );
    }

    return this.rewriteHeuristic(selectedText);
  }

  private async generateHooks(ctx: Context<HooksRequest>): Promise<HooksResponse> {
    const { plainText, workspaceId } = ctx.params;

    if (plainText.trim().length < 300) {
      throw new Errors.MoleculerClientError(
        'Text is too short for hook generation (minimum 300 characters).',
        422,
        'TEXT_TOO_SHORT',
      );
    }

    try {
      const config = await this.resolveOpenRouterConfig(workspaceId);
      const client = createOpenRouterClient({ ...config, timeoutMs: Math.max(config.timeoutMs, 55000) });

      const completion = await client.createChatCompletion({
        userContent: buildHooksUserInput(plainText),
        temperature: 0.8,
        maxTokens: 1024,
        systemPrompt: HOOKS_SYSTEM_PROMPT,
      });

      const result = parseHooksResult(completion.text);
      if (!result) {
        throw new Errors.MoleculerError('Failed to parse hooks result from AI', 500, 'AI_PARSE_ERROR');
      }

      return { ...result, confidence: 0.9 };
    } catch (error) {
      if (error instanceof OpenRouterConfigError) {
        throw new Errors.MoleculerError(error.message, 500, 'AI_CONFIG_ERROR');
      }
      throw error;
    }
  }

  private async generateAudit(ctx: Context<AuditRequest>): Promise<AuditResponse> {
    const { plainText, workspaceId } = ctx.params;

    if (plainText.trim().length < 500) {
      throw new Errors.MoleculerClientError(
        'Text is too short for engagement audit (minimum 500 characters).',
        422,
        'TEXT_TOO_SHORT',
      );
    }

    try {
      const config = await this.resolveOpenRouterConfig(workspaceId);
      const client = createOpenRouterClient({ ...config, timeoutMs: Math.max(config.timeoutMs, 60000) });

      const completion = await client.createChatCompletion({
        userContent: buildAuditUserInput(plainText),
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: AUDIT_SYSTEM_PROMPT,
      });

      const result = parseAuditResult(completion.text);
      if (!result) {
        throw new Errors.MoleculerError('Failed to parse audit result from AI', 500, 'AI_PARSE_ERROR');
      }

      return { ...result, confidence: 0.9 };
    } catch (error) {
      if (error instanceof OpenRouterConfigError) {
        throw new Errors.MoleculerError(error.message, 500, 'AI_CONFIG_ERROR');
      }
      throw error;
    }
  }

  private rewriteHeuristic(selectedText: string): RewriteResponse {
    const fillers = [
      /в\s+общем[\s,]*/gi,
      /таким\s+образом[\s,]*/gi,
      /по\s+сути[\s,]*/gi,
      /на\s+самом\s+деле[\s,]*/gi,
      /следует\s+отметить[\s,]*,?\s*/gi,
      /необходимо\s+учитывать[\s,]*,?\s*/gi,
    ];

    // сухой: first sentence only (most terse)
    const sentences = selectedText.match(/[^.!?]+[.!?]/g)?.map((s) => s.trim()) ?? [];
    const dry = sentences.length > 0
      ? sentences[0]
      : `${selectedText.split(' ').slice(0, 8).join(' ')}.`;

    // нейтральный: strip fillers, normalise whitespace
    let neutral = selectedText;
    for (const re of fillers) neutral = neutral.replace(re, '');
    neutral = neutral.replace(/\s{2,}/g, ' ').trim();
    if (!neutral || neutral === selectedText) {
      neutral = selectedText.charAt(0).toUpperCase() + selectedText.slice(1);
      if (!/[.!?…]$/.test(neutral)) neutral += '.';
    }

    // выразительный: original as-is (text is already expressive)
    const expressive = selectedText;

    // экстравагантный: reverse sentence order to create unexpected rhythm
    const extravagant = sentences.length > 1
      ? [...sentences].reverse().join(' ')
      : `${selectedText.split(' ').slice(-8).join(' ')}`;

    return {
      variants: [
        { style: 'сухой', text: dry, diff: buildDiff(selectedText, dry) },
        { style: 'нейтральный', text: neutral, diff: buildDiff(selectedText, neutral) },
        { style: 'выразительный', text: expressive, diff: buildDiff(selectedText, expressive) },
        { style: 'экстравагантный', text: extravagant, diff: buildDiff(selectedText, extravagant) },
      ],
      confidence: 0.5,
    };
  }

  private async continueLegacy(
    ctx: Context<LegacyContinueRequest>,
  ): Promise<LegacyContinueResponse> {
    const payload: ContinueStyleAwareRequest = {
      intent: defaultLegacyTone(ctx.params.intent),
      workspaceId: ctx.params.workspaceId,
      contextText: ctx.params.contextText,
      authorStyleProfile: buildDefaultAuthorProfile(ctx.params.contextText),
      constraints: {
        maxWords: DEFAULT_MAX_WORDS,
        preserveTone: true,
        noCliches: true,
        noNewFacts: true,
      },
      language: detectLanguage(ctx.params.contextText),
    };

    const result = await this.generateStyleAwareContinuation(payload);

    return {
      insertText: result.text,
      confidence: result.meta.provider === 'openrouter' ? 0.9 : 0.6,
    };
  }

  private async continueStyleAware(
    ctx: Context<ContinueStyleAwareRequest>,
  ): Promise<ContinueStyleAwareResponse> {
    let payload: ContinueStyleAwareRequest;

    try {
      payload = ContinueStyleAwareRequestSchema.parse(ctx.params);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Errors.MoleculerClientError(
          `Validation error: ${formatZodError(error)}`,
          422,
          'VALIDATION_ERROR',
        );
      }
      throw error;
    }

    return this.generateStyleAwareContinuation(payload);
  }

  private async generateStyleAwareContinuation(
    payload: ContinueStyleAwareRequest,
  ): Promise<ContinueStyleAwareResponse> {
    const effectivePayload = enrichStorytellingProfile(payload);
    const storytelling =
      effectivePayload.authorStyleProfile.storytelling ??
      detectStorytelling(effectivePayload.contextText);
    const storytellingAiReview = isFeatureEnabled(
      process.env.AI_STORYTELLING_AI_REVIEW,
    );
    const maxTokens = Math.ceil(payload.constraints.maxWords * 2.2 + 24);
    const temperature = 0.75;
    const storytellingDetected = storytelling.isNarrative;

    try {
      const config = await this.resolveOpenRouterConfig(payload.workspaceId);
      const client = createOpenRouterClient(config);

      const completion = await client.createChatCompletion({
        userContent: buildStyleAwareUserInput(effectivePayload, {
          storytellingAiReview,
        }),
        temperature,
        maxTokens,
      });

      const cleaned = sanitizeModelOutput(
        completion.text,
        effectivePayload.authorStyleProfile,
        effectivePayload.constraints.noCliches,
      );

      if (!cleaned || looksLikeGarbage(cleaned)) {
        return this.buildFallbackResponse(effectivePayload);
      }

      const truncated = truncateWithTolerance(
        cleaned,
        effectivePayload.constraints.maxWords,
        1.3,
      );

      return {
        text: truncated.text,
        meta: {
          provider: 'openrouter',
          model: completion.model,
          intent: effectivePayload.intent,
          truncated: truncated.truncated,
          storytellingDetected,
        },
      };
    } catch (error) {
      if (error instanceof OpenRouterConfigError) {
        throw new Errors.MoleculerError(
          error.message,
          500,
          'AI_CONFIG_ERROR',
        );
      }

      if (error instanceof OpenRouterRequestError) {
        this.logger.warn(
          `OpenRouter unavailable (${error.message}), using fallback template.`,
        );
        return this.buildFallbackResponse(effectivePayload);
      }

      if (error instanceof Error) {
        this.logger.warn(`AI generation failed (${error.message}), using fallback.`);
      } else {
        this.logger.warn('AI generation failed, using fallback.');
      }

      return this.buildFallbackResponse(effectivePayload);
    }
  }

  private buildFallbackResponse(
    payload: ContinueStyleAwareRequest,
  ): ContinueStyleAwareResponse {
    const baseTemplate = selectFallbackTemplate(payload.intent, payload.language);
    let fallback = adaptFallbackTone(
      baseTemplate,
      payload.authorStyleProfile,
      payload.language,
    );
    const storytelling = payload.authorStyleProfile.storytelling;
    const effectiveStorytelling = storytelling ?? detectStorytelling(payload.contextText);
    if (effectiveStorytelling.isNarrative) {
      fallback = adaptNarrativeFallback(
        fallback,
        payload.intent,
        payload.language,
        effectiveStorytelling,
      );
    }

    fallback = sanitizeModelOutput(
      fallback,
      payload.authorStyleProfile,
      payload.constraints.noCliches,
    );

    const truncated = truncateStrict(fallback, payload.constraints.maxWords);

    return {
      text: truncated.text,
      meta: {
        provider: 'fallback',
        intent: payload.intent,
        truncated: truncated.truncated,
        storytellingDetected: effectiveStorytelling.isNarrative,
      },
    };
  }
}

function parseHooksResult(rawText: string): {
  hooks: HooksHook[];
  styleAnalysis: string;
  recommendation: { hookIndex: number; reason: string };
} | null {
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;

  if (rec['error'] === 'TEXT_TOO_SHORT') return null;

  const hooksRaw = rec['hooks'];
  if (!Array.isArray(hooksRaw) || hooksRaw.length < 3) return null;

  const hooks: HooksHook[] = [];
  for (const h of hooksRaw.slice(0, 3)) {
    if (typeof h !== 'object' || h === null) return null;
    const item = h as Record<string, unknown>;
    if (typeof item['technique'] !== 'string' || typeof item['text'] !== 'string') return null;
    hooks.push({ technique: item['technique'] as string, text: item['text'] as string });
  }

  const styleAnalysis = typeof rec['styleAnalysis'] === 'string' ? rec['styleAnalysis'] as string : '';

  const recRaw = rec['recommendation'];
  const recommendation =
    typeof recRaw === 'object' && recRaw !== null
      ? {
          hookIndex: Math.max(
            0,
            Math.min(
              2,
              typeof (recRaw as Record<string, unknown>)['hookIndex'] === 'number'
                ? (recRaw as Record<string, unknown>)['hookIndex'] as number
                : 0,
            ),
          ),
          reason:
            typeof (recRaw as Record<string, unknown>)['reason'] === 'string'
              ? (recRaw as Record<string, unknown>)['reason'] as string
              : '',
        }
      : { hookIndex: 0, reason: '' };

  return { hooks, styleAnalysis, recommendation };
}

function parseAuditResult(rawText: string): {
  totalSegments: number;
  health: string;
  weakSegments: AuditSegment[];
  editorNote: string;
} | null {
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;

  if (rec['error'] === 'TEXT_TOO_SHORT') return null;

  const totalSegments = typeof rec['totalSegments'] === 'number' ? rec['totalSegments'] as number : 0;
  const health = typeof rec['health'] === 'string' ? rec['health'] as string : 'Fair';
  const editorNote = typeof rec['editorNote'] === 'string' ? rec['editorNote'] as string : '';

  const weakRaw = rec['weakSegments'];
  if (!Array.isArray(weakRaw)) return null;

  const weakSegments: AuditSegment[] = [];
  for (const item of weakRaw) {
    if (typeof item !== 'object' || item === null) continue;
    const s = item as Record<string, unknown>;
    if (
      typeof s['id'] !== 'string' ||
      typeof s['score'] !== 'number' ||
      typeof s['original'] !== 'string' ||
      typeof s['problem'] !== 'string' ||
      typeof s['technique'] !== 'string' ||
      typeof s['edit'] !== 'string'
    ) continue;
    weakSegments.push({
      id: s['id'] as string,
      score: s['score'] as number,
      original: s['original'] as string,
      problem: s['problem'] as string,
      technique: s['technique'] as string,
      edit: s['edit'] as string,
    });
  }

  return { totalSegments, health, weakSegments, editorNote };
}

function parseSpellcheckIssues(
  rawText: string,
  searchText: string,
  positionOffset: number,
): SpellcheckIssue[] {
  let cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const issues: SpellcheckIssue[] = [];
  for (const item of parsed) {
    if (
      typeof item !== 'object' || item === null ||
      typeof (item as Record<string, unknown>)['original'] !== 'string' ||
      !Array.isArray((item as Record<string, unknown>)['replacements']) ||
      typeof (item as Record<string, unknown>)['message'] !== 'string'
    ) {
      continue;
    }

    const original = (item as Record<string, unknown>)['original'] as string;
    const replacements = (item as Record<string, unknown>)['replacements'] as string[];
    const message = (item as Record<string, unknown>)['message'] as string;

    const pos = searchText.indexOf(original);
    if (pos === -1) continue;

    issues.push({
      from: pos + positionOffset,
      to: pos + positionOffset + original.length,
      original,
      replacements,
      message,
      confidence: 0.85,
    });
  }

  return issues;
}

function parseRewriteVariants(rawText: string, originalText: string): RewriteVariant[] {
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const variants: RewriteVariant[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const text = rec['text'];
    if (typeof text !== 'string' || !text.trim()) continue;
    const style = typeof rec['style'] === 'string' ? rec['style'] : undefined;
    variants.push({ text: text.trim(), style, diff: buildDiff(originalText, text.trim()) });
  }

  return variants;
}

function buildDiff(original: string, modified: string): string {
  if (original === modified) return '';
  return `- ${original}\n+ ${modified}`;
}

function detectLanguage(text: string): 'ru' | 'en' {
  return /[а-яё]/i.test(text) ? 'ru' : 'en';
}

function buildDefaultAuthorProfile(contextText: string): AuthorStyleProfile {
  const shortContext = contextText.trim().split(/\s+/).length <= 40;
  return {
    tone: 'neutral',
    sentenceLength: shortContext ? 'short' : 'medium',
    formality: 0.5,
    emojiUsage: 0,
    rhythm: shortContext ? 'choppy' : 'flowing',
    typicalPatterns: [],
    forbiddenPhrases: [],
    lexicalFeatures: [],
    storytelling: detectStorytelling(contextText),
  };
}

function enrichStorytellingProfile(
  payload: ContinueStyleAwareRequest,
): ContinueStyleAwareRequest {
  if (payload.authorStyleProfile.storytelling) {
    return payload;
  }

  return {
    ...payload,
    authorStyleProfile: {
      ...payload.authorStyleProfile,
      storytelling: detectStorytelling(payload.contextText),
    },
  };
}

function sanitizeModelOutput(
  text: string,
  profile: AuthorStyleProfile,
  removeCliches: boolean,
): string {
  let cleaned = text.trim();

  cleaned = cleaned
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  cleaned = cleaned
    .replace(/^(?:продолжение|continuation|continue|output|ответ)\s*:\s*/i, '')
    .trim();

  cleaned = cleaned.replace(/^(["'“”«»])+|(["'“”«»])+$/g, '').trim();
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();

  if (removeCliches) {
    for (const pattern of CLICHE_PATTERNS) {
      cleaned = cleaned.replace(pattern, '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  for (const phrase of profile.forbiddenPhrases) {
    const escaped = escapeRegExp(phrase.trim());
    if (!escaped) continue;
    cleaned = cleaned.replace(new RegExp(escaped, 'gi'), '').replace(/\s{2,}/g, ' ').trim();
  }

  return cleaned;
}

function looksLikeGarbage(text: string): boolean {
  if (!text) return true;
  if (/internal\s+evaluation/i.test(text)) return true;
  if (/^\{[\s\S]*\}$/.test(text)) return true;

  const words = splitWords(text);
  if (words.length === 0) return true;

  const alphaChars = text.replace(/[^\p{L}\p{N}]/gu, '').length;
  return alphaChars < Math.max(3, Math.floor(text.length * 0.3));
}

function truncateStrict(
  text: string,
  maxWords: number,
): { text: string; truncated: boolean } {
  const words = splitWords(text);
  if (words.length <= maxWords) {
    return { text, truncated: false };
  }

  const cut = words.slice(0, maxWords).join(' ');
  return { text: trimToSentenceBoundary(cut), truncated: true };
}

function truncateWithTolerance(
  text: string,
  maxWords: number,
  tolerance: number,
): { text: string; truncated: boolean } {
  const words = splitWords(text);
  if (words.length <= Math.floor(maxWords * tolerance)) {
    return { text, truncated: false };
  }

  const cut = words.slice(0, maxWords).join(' ');
  return { text: trimToSentenceBoundary(cut), truncated: true };
}

function trimToSentenceBoundary(text: string): string {
  const trimmed = text.trim();
  const lastPunctuation = Math.max(
    trimmed.lastIndexOf('.'),
    trimmed.lastIndexOf('!'),
    trimmed.lastIndexOf('?'),
    trimmed.lastIndexOf('…'),
  );

  if (lastPunctuation > Math.floor(trimmed.length * 0.6)) {
    return trimmed.slice(0, lastPunctuation + 1).trim();
  }

  return trimmed;
}

function splitWords(text: string): string[] {
  return text.trim().split(/\s+/).filter((word) => word.length > 0);
}

function adaptFallbackTone(
  baseText: string,
  profile: AuthorStyleProfile,
  language: 'ru' | 'en',
): string {
  let adapted = baseText;

  if (profile.formality < 0.4) {
    adapted = language === 'ru'
      ? adapted
          .replace(/необходимо/gi, 'нужно')
          .replace(/следует/gi, 'стоит')
          .replace(/данн(ый|ая|ое|ые)/gi, 'этот')
      : adapted
          .replace(/it is necessary/gi, 'it helps')
          .replace(/essential/gi, 'important');
  }

  if (profile.rhythm === 'choppy') {
    adapted = adapted
      .replace(/,\s+/g, '. ')
      .replace(/;\s+/g, '. ')
      .replace(/:\s+/g, '. ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  if (profile.emojiUsage > 0.6 && !containsEmoji(adapted)) {
    adapted = `${adapted} 🙂`;
  }

  return adapted;
}

function adaptNarrativeFallback(
  baseText: string,
  intent: ContinueIntent,
  language: 'ru' | 'en',
  storytelling: StorytellingProfile,
): string {
  const tense = storytelling.tense ?? 'mixed';
  const perspective = storytelling.perspective ?? 'mixed';

  if (language === 'en') {
    if (perspective === 'first_person') {
      return tense === 'past'
        ? narrativeLineByIntent(intent, 'I kept moving through the same line of thought, and each next step grew directly from what had already happened.', baseText)
        : narrativeLineByIntent(intent, 'I keep moving through the same line of thought, and each next step grows directly from what is already happening.', baseText);
    }

    return tense === 'past'
      ? narrativeLineByIntent(intent, 'They stayed inside the same chain of events, and every next move followed from what had already happened.', baseText)
      : narrativeLineByIntent(intent, 'They stay inside the same chain of events, and every next move follows from what is already happening.', baseText);
  }

  if (perspective === 'first_person') {
    return tense === 'past'
      ? narrativeLineByIntent(intent, 'Я продолжал эту же линию, и каждый следующий шаг рождался из того, что уже произошло.', baseText)
      : narrativeLineByIntent(intent, 'Я продолжаю эту же линию, и каждый следующий шаг рождается из того, что уже происходит.', baseText);
  }

  return tense === 'past'
    ? narrativeLineByIntent(intent, 'Он держался той же линии событий, и каждый следующий шаг вырастал из того, что уже произошло.', baseText)
    : narrativeLineByIntent(intent, 'Он держится той же линии событий, и каждый следующий шаг вырастает из того, что уже происходит.', baseText);
}

function narrativeLineByIntent(
  intent: ContinueIntent,
  defaultLine: string,
  baseText: string,
): string {
  if (intent === 'example') {
    return `${defaultLine} Один эпизод это подтверждает без лишних объяснений.`;
  }
  if (intent === 'argument') {
    return `${defaultLine} Внутренняя логика сцены сама удерживает эту позицию.`;
  }
  if (intent === 'conclusion') {
    return `${defaultLine} Мысль мягко замыкается на этом движении.`;
  }

  return `${defaultLine} ${baseText}`;
}

function containsEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text);
}

function selectFallbackTemplate(
  intent: ContinueIntent,
  language: 'ru' | 'en',
): string {
  if (language === 'en') {
    return EN_FALLBACK_TEMPLATES[intent];
  }

  return FALLBACK_TEMPLATES[intent];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isFeatureEnabled(value: string | undefined): boolean {
  if (!value) return false;
  return value.trim().toLowerCase() === 'true';
}
