import { z } from 'zod';

export const PostOpenSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required').optional(),
  userId: z.string().min(1, 'userId is required').optional(),
  postId: z.string().optional(),
}).superRefine((data, ctx) => {
  // Reconnect is allowed with postId only. New session requires workspaceId + userId.
  if (data.postId) return;

  if (!data.workspaceId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workspaceId'],
      message: 'Required',
    });
  }

  if (!data.userId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['userId'],
      message: 'Required',
    });
  }
});

export const PostUpdateSchema = z.object({
  postId: z.string().min(1, 'postId is required'),
  contentJson: z.record(z.unknown()),
  plainText: z.string(),
  version: z.number().int().positive('version must be a positive integer'),
});

export const PostListByAuthorSchema = z.object({
  authorUserId: z.string().min(1, 'authorUserId is required'),
  workspaceId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const PostGetSchema = z.object({
  postId: z.string().min(1, 'postId is required'),
  workspaceId: z.string().min(1).optional(),
});

export const PostDeleteSchema = z.object({
  postId: z.string().min(1, 'postId is required'),
});

export const SuggestSpellcheckSchema = z.object({
  postId: z.string().min(1),
  version: z.number().int().nonnegative(),
  plainText: z.string().min(1, 'plainText is required'),
  workspaceId: z.string().min(1).optional(),
  selectedText: z.string().min(1).optional(),
  selection: z.object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
  }).optional(),
});

export const SuggestRewriteSchema = z.object({
  postId: z.string().min(1),
  version: z.number().int().nonnegative(),
  workspaceId: z.string().min(1).optional(),
  selection: z.object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
  }),
  selectedText: z.string().min(1, 'selectedText is required'),
  contextText: z.string(),
});

export const SuggestContinueSchema = z.object({
  postId: z.string().min(1),
  version: z.number().int().nonnegative(),
  workspaceId: z.string().min(1).optional(),
  cursorPos: z.number().int().min(0),
  intent: z.string(),
  contextText: z.string(),
});

export const AiSettingsGetSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
});

export const AiSettingsUpdateSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  apiKey: z.string().min(1).optional(),
  model: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.apiKey === undefined && data.model === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['apiKey'],
      message: 'apiKey or model is required',
    });
  }
});

export const AiSettingsClearKeySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
});

export const SuggestApplySchema = z.object({
  postId: z.string().min(1),
  version: z.number().int().nonnegative(),
  suggestionId: z.string().min(1, 'suggestionId is required'),
  action: z.enum(['accept', 'reject']),
});

export type ValidatedPostOpen = z.infer<typeof PostOpenSchema>;
export type ValidatedPostUpdate = z.infer<typeof PostUpdateSchema>;
export type ValidatedPostListByAuthor = z.infer<typeof PostListByAuthorSchema>;
export type ValidatedPostGet = z.infer<typeof PostGetSchema>;
export type ValidatedPostDelete = z.infer<typeof PostDeleteSchema>;
export type ValidatedSuggestSpellcheck = z.infer<typeof SuggestSpellcheckSchema>;
export type ValidatedSuggestRewrite = z.infer<typeof SuggestRewriteSchema>;
export type ValidatedSuggestContinue = z.infer<typeof SuggestContinueSchema>;
export type ValidatedSuggestApply = z.infer<typeof SuggestApplySchema>;
export type ValidatedAiSettingsGet = z.infer<typeof AiSettingsGetSchema>;
export type ValidatedAiSettingsUpdate = z.infer<typeof AiSettingsUpdateSchema>;
export type ValidatedAiSettingsClearKey = z.infer<typeof AiSettingsClearKeySchema>;

/** Validate and throw a clean error on failure */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new Error(`Validation error: ${msg}`);
  }
  return result.data;
}
