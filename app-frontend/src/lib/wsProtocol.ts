export type SuggestionType = 'spellcheck' | 'rewrite' | 'continue' | 'hooks' | 'audit';
export type AiLoadingState = 'idle' | 'loading' | 'error';

export interface AuditSegment {
  id: string;
  score: number;
  original: string;
  problem: string;
  technique: string;
  edit: string;
}

export interface SuggestionResult {
  id: string;
  type: SuggestionType;
  version: number;
  range: { from: number; to: number };
  title: string;
  message: string;
  replacements?: string[];
  styles?: string[];
  selectedVariantIndex?: number;
  insertText?: string;
  confidence?: number;
  diff?: string;
  originalText?: string;
  // audit-specific
  segments?: AuditSegment[];
  editorNote?: string;
  health?: string;
  totalSegments?: number;
}

export interface WSEnvelope<T = unknown> {
  event: string;
  data: T;
}

export interface PostOpenData {
  postId?: string;
  workspaceId?: string;
  userId?: string;
}

export interface PostSnapshotData {
  postId: string;
  workspaceId: string;
  version: number;
  contentJson: Record<string, unknown>;
}

export interface PostUpdateData {
  postId: string;
  version: number;
  contentJson: Record<string, unknown>;
  plainText: string;
}

export interface PostAckData {
  postId: string;
  version: number;
}

export interface VersionConflictData {
  postId: string;
  expectedVersion: number;
  actualVersion: number;
}

export interface SuggestSpellcheckData {
  postId: string;
  workspaceId: string;
  version: number;
  plainText: string;
}

export interface SuggestRewriteData {
  postId: string;
  workspaceId: string;
  version: number;
  selection: { from: number; to: number };
  selectedText: string;
  contextText: string;
}

export interface SuggestContinueData {
  postId: string;
  workspaceId: string;
  version: number;
  cursorPos: number;
  intent: 'summary' | 'example' | 'argument' | 'conclusion';
  contextText: string;
}

export interface SuggestResultData {
  postId: string;
  suggestion: SuggestionResult;
}

export interface SuggestRemovedData {
  postId: string;
  suggestionId: string;
}

export interface PostListByAuthorRequestData {
  authorUserId: string;
  workspaceId?: string;
  limit?: number;
  offset?: number;
}

export interface PostGetRequestData {
  postId: string;
  workspaceId?: string;
}

export interface PostDeleteData {
  postId: string;
}

export interface PostDeletedData {
  postId: string;
}

export interface AuthorPostListItem {
  postId: string;
  name?: string;
  title?: string;
  updatedAt?: string;
  previewText?: string;
  version?: number;
}

export interface PostListData {
  authorUserId: string;
  items: AuthorPostListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface PostDetailData {
  postId: string;
  contentJson: Record<string, unknown>;
  plainText: string;
  version: number;
  meta?: Record<string, unknown>;
}

export interface SuggestHooksData {
  postId: string;
  workspaceId: string;
  version: number;
  plainText: string;
}

export interface SuggestAuditData {
  postId: string;
  workspaceId: string;
  version: number;
  plainText: string;
}

export interface SuggestLoadingData {
  postId: string;
  version: number;
  type: SuggestionType;
  status: 'start' | 'done' | 'error';
  message?: string;
}

export interface AiSettingsGetData {
  workspaceId: string;
}

export interface AiSettingsUpdateData {
  workspaceId: string;
  apiKey?: string;
  model?: string;
}

export interface AiSettingsClearKeyData {
  workspaceId: string;
}

export interface AiSettingsData {
  workspaceId: string;
  hasApiKey: boolean;
  model: string | null;
}
