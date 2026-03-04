import { z } from 'zod';

export const ContinueIntentSchema = z.enum([
  'summary',
  'example',
  'argument',
  'conclusion',
]);

export const SentenceLengthSchema = z.enum(['short', 'medium', 'long']);
export const RhythmSchema = z.enum(['choppy', 'flowing']);
export const LanguageSchema = z.enum(['ru', 'en']);
export const StorytellingPerspectiveSchema = z.enum([
  'first_person',
  'third_person',
  'mixed',
]);
export const StorytellingTenseSchema = z.enum(['past', 'present', 'mixed']);
export const StorytellingPacingSchema = z.enum(['slow', 'medium', 'fast']);

const StringArraySchema = z.array(z.string()).default([]);

export const StorytellingProfileSchema = z.object({
  isNarrative: z.boolean(),
  perspective: StorytellingPerspectiveSchema.optional(),
  tense: StorytellingTenseSchema.optional(),
  characterDensity: z.number().min(0).max(1),
  dialogueUsage: z.number().min(0).max(1),
  pacing: StorytellingPacingSchema,
});

export const AuthorStyleProfileSchema = z.object({
  tone: z.string().min(1, 'authorStyleProfile.tone is required'),
  sentenceLength: SentenceLengthSchema,
  formality: z.number().min(0).max(1),
  emojiUsage: z.number().min(0).max(1),
  rhythm: RhythmSchema,
  typicalPatterns: StringArraySchema,
  forbiddenPhrases: StringArraySchema,
  lexicalFeatures: StringArraySchema,
  storytelling: StorytellingProfileSchema.optional(),
});

export const ContinueConstraintsSchema = z.object({
  maxWords: z.number().int().min(20).max(400),
  preserveTone: z.literal(true),
  noCliches: z.literal(true),
  noNewFacts: z.literal(true),
});

export const ContinueStyleAwareRequestSchema = z.object({
  intent: ContinueIntentSchema,
  workspaceId: z.string().min(1).optional(),
  contextText: z.string().min(1, 'contextText must contain at least 1 character'),
  authorStyleProfile: AuthorStyleProfileSchema,
  constraints: ContinueConstraintsSchema,
  language: LanguageSchema.default('ru'),
});

export type ContinueIntent = z.infer<typeof ContinueIntentSchema>;
export type SentenceLength = z.infer<typeof SentenceLengthSchema>;
export type Rhythm = z.infer<typeof RhythmSchema>;
export type Language = z.infer<typeof LanguageSchema>;
export type StorytellingPerspective = z.infer<typeof StorytellingPerspectiveSchema>;
export type StorytellingTense = z.infer<typeof StorytellingTenseSchema>;
export type StorytellingPacing = z.infer<typeof StorytellingPacingSchema>;
export type StorytellingProfile = z.infer<typeof StorytellingProfileSchema>;

export type AuthorStyleProfile = z.infer<typeof AuthorStyleProfileSchema>;
export type ContinueConstraints = z.infer<typeof ContinueConstraintsSchema>;
export type ContinueStyleAwareRequest = z.infer<
  typeof ContinueStyleAwareRequestSchema
>;

export interface ContinueStyleAwareResponse {
  text: string;
  meta: {
    provider: 'openrouter' | 'fallback';
    model?: string;
    intent: ContinueIntent;
    truncated: boolean;
    storytellingDetected: boolean;
  };
}

export interface LegacyContinueRequest {
  contextText: string;
  cursorPos?: number;
  intent: string;
  workspaceId?: string;
}

export interface LegacyContinueResponse {
  insertText: string;
  confidence: number;
}

export function parseContinueStyleAwareRequest(
  input: unknown,
): ContinueStyleAwareRequest {
  return ContinueStyleAwareRequestSchema.parse(input);
}

export function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
