// ─── WS Client → Server ────────────────────────────────────────────────────

export interface PostOpenPayload {
  workspaceId?: string;
  userId?: string;
  /** Optional: supplied on reconnect so server returns the existing snapshot */
  postId?: string;
}

export interface PostUpdatePayload {
  postId: string;
  contentJson: Record<string, unknown>;
  plainText: string;
  /** The version the client proposes (must equal currentVersion + 1) */
  version: number;
}

export interface SuggestSpellcheckPayload {
  postId: string;
  version: number;
  plainText: string;
  workspaceId?: string;
}

export interface SuggestRewritePayload {
  postId: string;
  version: number;
  selection: { from: number; to: number };
  selectedText: string;
  contextText: string;
  workspaceId?: string;
}

export interface SuggestContinuePayload {
  postId: string;
  version: number;
  cursorPos: number;
  intent: string;
  contextText: string;
  workspaceId?: string;
}

export interface AiSettingsGetPayload {
  workspaceId: string;
}

export interface AiSettingsUpdatePayload {
  workspaceId: string;
  apiKey?: string;
  model?: string;
}

export interface AiSettingsClearKeyPayload {
  workspaceId: string;
}

export interface SuggestApplyPayload {
  postId: string;
  version: number;
  suggestionId: string;
  action: 'accept' | 'reject';
}

export interface PostListByAuthorPayload {
  authorUserId: string;
  workspaceId?: string;
  limit?: number;
  offset?: number;
}

export interface PostGetPayload {
  postId: string;
  workspaceId?: string;
}

export interface PostDeletePayload {
  postId: string;
}

// ─── WS Server → Client ────────────────────────────────────────────────────

export interface PostSnapshotMessage {
  postId: string;
  contentJson: Record<string, unknown>;
  version: number;
  workspaceId: string;
}

export interface PostAckMessage {
  postId: string;
  version: number;
}

export interface SuggestionResult {
  id: string;
  type: string;
  range: { from: number; to: number };
  title: string;
  message: string;
  replacements: string[];
  styles?: string[];
  diff?: string;
  insertText?: string;
  confidence: number;
}

export interface SuggestResultMessage {
  postId: string;
  version: number;
  suggestion: SuggestionResult;
}

export interface SuggestRemovedMessage {
  postId: string;
  suggestionId: string;
}

export interface SuggestLoadingMessage {
  postId: string;
  version: number;
  type: 'spellcheck' | 'rewrite' | 'continue' | 'hooks';
  status: 'start' | 'done' | 'error';
  message?: string;
}

export interface PostListItem {
  name: string;
  version: number;
  postId: string;
  workspaceId: string;
  authorUserId: string;
  /** Backward-compatible alias of version. */
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PostListMessage {
  items: PostListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface PostDetailMessage {
  postId: string;
  workspaceId: string;
  authorUserId: string;
  contentJson: Record<string, unknown>;
  plainText: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PostDeletedMessage {
  type: 'post.deleted';
  postId: string;
}

// ─── WS Envelope ───────────────────────────────────────────────────────────

export interface WsEnvelope<T = unknown> {
  event: string;
  data: T;
}

// ─── Moleculer Action Params ───────────────────────────────────────────────

export interface PostOpenParams {
  workspaceId?: string;
  userId?: string;
  postId?: string;
}

export interface PostUpdateParams {
  postId: string;
  contentJson: Record<string, unknown>;
  plainText: string;
  version: number;
}

export interface PostSnapshotParams {
  postId: string;
}

export interface PostListByAuthorParams {
  authorUserId: string;
  workspaceId?: string;
  limit?: number;
  offset?: number;
}

export interface PostGetParams {
  postId: string;
  workspaceId?: string;
}

export interface PostDeleteParams {
  postId: string;
}

export interface SuggestionCreateParams {
  postId: string;
  version: number;
  type: string;
  rangeFrom: number;
  rangeTo: number;
  payload: Record<string, unknown>;
}

export interface SuggestionApplyParams {
  postId: string;
  version: number;
  suggestionId: string;
  action: 'accept' | 'reject';
}

export interface SuggestionMarkStaleParams {
  postId: string;
  beforeVersion: number;
}

// ─── AI Service Interfaces ─────────────────────────────────────────────────
// Designed so that the stub can be replaced by a real LLM without changing callers.

export interface SpellcheckRequest {
  plainText: string;
  /** If provided, AI focuses on this fragment; positions are still relative to plainText */
  selectedText?: string;
  selection?: { from: number; to: number };
  workspaceId?: string;
}

export interface SpellcheckIssue {
  from: number;
  to: number;
  original: string;
  replacements: string[];
  message: string;
  confidence: number;
}

export interface SpellcheckResponse {
  issues: SpellcheckIssue[];
}

export interface RewriteRequest {
  selectedText: string;
  contextText: string;
  selection: { from: number; to: number };
  workspaceId?: string;
}

export interface RewriteVariant {
  text: string;
  style?: string;
  diff?: string;
}

export interface RewriteResponse {
  variants: RewriteVariant[];
  confidence: number;
}

export interface ContinueRequest {
  contextText: string;
  cursorPos: number;
  intent: string;
  workspaceId?: string;
}

export interface ContinueResponse {
  insertText: string;
  confidence: number;
}

export interface HooksRequest {
  plainText: string;
  workspaceId?: string;
}

export interface HooksHook {
  technique: string;
  text: string;
}

export interface HooksResponse {
  hooks: HooksHook[];
  styleAnalysis: string;
  recommendation: { hookIndex: number; reason: string };
  confidence: number;
}

export interface AiSettingsMessage {
  workspaceId: string;
  hasApiKey: boolean;
  model: string | null;
}

// ─── Internal Events ───────────────────────────────────────────────────────

export interface PostUpdatedEvent {
  postId: string;
  version: number;
  staleSuggestionIds: string[];
}

export interface PostDeletedEvent {
  postId: string;
}

export interface SuggestionReadyEvent {
  postId: string;
  version: number;
  suggestion: SuggestionResult;
}

export interface SuggestionRemovedEvent {
  postId: string;
  suggestionId: string;
}
