import { create } from 'zustand';
import {
  requestAiSettingsClearKey,
  requestAiSettingsGet,
  requestAiSettingsUpdate,
  requestPostDetail,
  requestPostListByAuthor,
} from '../lib/wsApi';
import {
  AiSettingsData,
  AuthorPostListItem,
  PostDetailData,
  PostListData,
  SuggestAuditData,
  SuggestContinueData,
  SuggestHooksData,
  SuggestionResult,
  SuggestionType,
  SuggestRewriteData,
  SuggestSpellcheckData,
  WSEnvelope,
} from '../lib/wsProtocol';

type ViewMode = 'desktop' | 'mobile';

type AuthorPostsState = {
  items: AuthorPostListItem[];
  total: number;
  limit: number;
  offset: number;
  isLoading: boolean;
  error?: string;
};

type CurrentPostState = {
  postId: string | null;
  contentJson: Record<string, unknown>;
  plainText: string;
  version: number;
  meta?: Record<string, unknown>;
};

type SuggestPayloadByType = {
  spellcheck: SuggestSpellcheckData;
  rewrite: SuggestRewriteData;
  continue: SuggestContinueData;
  hooks: SuggestHooksData;
  audit: SuggestAuditData;
};

type Toast = {
  id: string;
  message: string;
};

type AiSettingsState = {
  workspaceId: string;
  hasApiKey: boolean;
  model: string | null;
  loading: boolean;
  error: string | null;
};

type SpellcheckPopupAnchor = {
  suggestionId: string;
  rect: { top: number; bottom: number; left: number; right: number; width: number };
};

function getPreviewText(plainText?: string) {
  const normalized = plainText?.replace(/\s+/g, ' ').trim() || '';
  return normalized || undefined;
}

interface EditorState {
  viewMode: ViewMode;
  wsConnected: boolean;
  currentWorkspaceId: string | null;

  postId: string;
  currentVersion: number;
  content: Record<string, unknown> | string;
  plainText: string;

  isDirty: boolean;
  saveStatus: 'idle' | 'saving' | 'saved';

  authorPosts: AuthorPostsState;
  currentPost: CurrentPostState;
  currentPostLoading: boolean;
  currentPostError?: string;
  expectedDetailPostId: string | null;

  suggestions: Map<string, SuggestionResult>;
  activeSuggestionId: string | null;

  aiLoadingByType: Record<SuggestionType, 'idle' | 'loading' | 'error'>;
  lastErrorByType: Partial<Record<SuggestionType, string>>;
  lastSuggestPayloadByType: Partial<SuggestPayloadByType>;

  toasts: Toast[];
  spellcheckPopupAnchor: SpellcheckPopupAnchor | null;
  pendingDeletePostIds: Set<string>;
  aiSettings: AiSettingsState;
  aiSettingsModalOpen: boolean;

  setWsConnected: (connected: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  hydrateViewMode: () => void;

  setPostId: (id: string) => void;
  setCurrentWorkspaceId: (workspaceId: string | null) => void;
  setCurrentVersion: (version: number) => void;
  setContent: (content: Record<string, unknown> | string) => void;
  setPlainText: (plainText: string) => void;
  setIsDirty: (dirty: boolean) => void;
  setSaveStatus: (status: 'idle' | 'saving' | 'saved') => void;

  applyPostSnapshot: (payload: {
    postId: string;
    workspaceId: string;
    version: number;
    contentJson: Record<string, unknown>;
    plainText: string;
  }) => void;
  applyPostDetail: (detail: PostDetailData) => void;
  setExpectedDetailPostId: (postId: string | null) => void;

  setAuthorPosts: (data: PostListData) => void;
  setAuthorPostsLoading: (loading: boolean) => void;
  setAuthorPostsError: (message?: string) => void;
  loadAuthorPosts: (params: {
    authorUserId: string;
    workspaceId?: string;
    limit?: number;
    offset?: number;
  }) => Promise<void>;

  openPostById: (params: { postId: string; workspaceId?: string }) => Promise<void>;
  applyPostDeleted: (postId: string) => void;
  markDeleteRequested: (postId: string) => void;
  clearDeleteRequested: (postId: string) => void;

  addSuggestion: (suggestion: SuggestionResult) => void;
  removeSuggestion: (id: string) => void;
  clearAllSuggestions: () => void;
  clearStaleSuggestions: (version: number) => void;
  setActiveSuggestionId: (id: string | null) => void;
  setSelectedVariant: (id: string, index: number) => void;

  setAiLoadingState: (payload: {
    type: SuggestionType;
    status: 'start' | 'done' | 'error';
    message?: string;
  }) => void;
  rememberSuggestPayload: <T extends SuggestionType>(
    type: T,
    payload: SuggestPayloadByType[T],
  ) => void;

  addToast: (message: string) => void;
  dismissToast: (id: string) => void;

  setSpellcheckPopupAnchor: (anchor: SpellcheckPopupAnchor | null) => void;
  setAiSettingsModalOpen: (open: boolean) => void;
  applyAiSettings: (data: AiSettingsData) => void;
  loadAiSettings: (workspaceId: string) => Promise<void>;
  saveAiSettings: (payload: {
    workspaceId: string;
    apiKey?: string;
    model?: string;
  }) => Promise<boolean>;
  clearAiKey: (workspaceId: string) => Promise<boolean>;
  ensureAiReady: () => { ok: true } | { ok: false; reason: string };
}

const emptyDoc: Record<string, unknown> = { type: 'doc', content: [{ type: 'paragraph' }] };

export const useEditorStore = create<EditorState>((set, get) => ({
  viewMode: 'desktop',
  wsConnected: false,
  currentWorkspaceId: null,

  postId: '',
  currentVersion: 0,
  content: emptyDoc,
  plainText: '',

  isDirty: false,
  saveStatus: 'idle',

  authorPosts: {
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
    isLoading: false,
  },
  currentPost: {
    postId: null,
    contentJson: emptyDoc,
    plainText: '',
    version: 0,
  },
  currentPostLoading: false,
  currentPostError: undefined,
  expectedDetailPostId: null,

  suggestions: new Map(),
  activeSuggestionId: null,

  aiLoadingByType: {
    spellcheck: 'idle',
    rewrite: 'idle',
    continue: 'idle',
    hooks: 'idle',
    audit: 'idle',
  },
  lastErrorByType: {},
  lastSuggestPayloadByType: {},

  toasts: [],
  spellcheckPopupAnchor: null,
  pendingDeletePostIds: new Set<string>(),
  aiSettings: {
    workspaceId: '',
    hasApiKey: false,
    model: null,
    loading: false,
    error: null,
  },
  aiSettingsModalOpen: false,

  setViewMode: (mode) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('pero:viewMode', mode);
    }
    set({ viewMode: mode });
  },
  hydrateViewMode: () => {
    if (typeof window === 'undefined') {
      set({ viewMode: 'desktop' });
      return;
    }
    const savedMode = window.localStorage.getItem('pero:viewMode');
    set({ viewMode: savedMode === 'mobile' ? 'mobile' : 'desktop' });
  },
  setWsConnected: (connected) => set({ wsConnected: connected }),

  setPostId: (id) => set({ postId: id }),
  setCurrentWorkspaceId: (workspaceId) => set({ currentWorkspaceId: workspaceId }),
  setCurrentVersion: (version) => set({ currentVersion: version }),
  setContent: (content) => set({ content }),
  setPlainText: (plainText) => set({ plainText }),
  setIsDirty: (isDirty) => set({ isDirty }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),

  applyPostSnapshot: ({ postId, workspaceId, version, contentJson, plainText }) =>
    set((state) => {
      const previewText = getPreviewText(plainText);
      const existingIndex = state.authorPosts.items.findIndex((item) => item.postId === postId);
      const items =
        existingIndex >= 0
          ? state.authorPosts.items.map((item, index) =>
              index === existingIndex
                ? {
                    ...item,
                    previewText: previewText || item.previewText,
                    version,
                  }
                : item,
            )
          : [{ postId, previewText, version }, ...state.authorPosts.items];

      return {
        postId,
        currentWorkspaceId: workspaceId,
        currentVersion: version,
        content: contentJson,
        plainText,
        isDirty: false,
        saveStatus: 'idle',
        currentPost: {
          ...state.currentPost,
          postId,
          contentJson,
          plainText,
          version,
        },
        currentPostLoading: false,
        currentPostError: undefined,
        expectedDetailPostId: null,
        authorPosts: {
          ...state.authorPosts,
          items,
          total: existingIndex >= 0 ? state.authorPosts.total : state.authorPosts.total + 1,
        },
      };
    }),

  applyPostDetail: (detail) =>
    set((state) => {
      const previewText = getPreviewText(detail.plainText);
      const existingIndex = state.authorPosts.items.findIndex((item) => item.postId === detail.postId);
      const items =
        existingIndex >= 0
          ? state.authorPosts.items.map((item, index) =>
              index === existingIndex
                ? {
                    ...item,
                    previewText: previewText || item.previewText,
                    version: detail.version,
                  }
                : item,
            )
          : [{ postId: detail.postId, previewText, version: detail.version }, ...state.authorPosts.items];

      return {
        postId: detail.postId,
        currentVersion: detail.version,
        content: detail.contentJson,
        plainText: detail.plainText,
        currentPost: {
          postId: detail.postId,
          contentJson: detail.contentJson,
          plainText: detail.plainText,
          version: detail.version,
          meta: detail.meta,
        },
        currentPostLoading: false,
        currentPostError: undefined,
        expectedDetailPostId: null,
        authorPosts: {
          ...state.authorPosts,
          items,
          total: existingIndex >= 0 ? state.authorPosts.total : state.authorPosts.total + 1,
        },
      };
    }),

  setExpectedDetailPostId: (postId) => set({ expectedDetailPostId: postId }),

  setAuthorPosts: (data) =>
    set({
      authorPosts: {
        items: data.items,
        total: data.total,
        limit: data.limit,
        offset: data.offset,
        isLoading: false,
        error: undefined,
      },
    }),

  setAuthorPostsLoading: (loading) =>
    set((state) => ({
      authorPosts: {
        ...state.authorPosts,
        isLoading: loading,
        error: loading ? undefined : state.authorPosts.error,
      },
    })),

  setAuthorPostsError: (message) =>
    set((state) => ({
      authorPosts: {
        ...state.authorPosts,
        isLoading: false,
        error: message,
      },
    })),

  loadAuthorPosts: async ({ authorUserId, workspaceId, limit, offset }) => {
    set((state) => ({
      authorPosts: {
        ...state.authorPosts,
        isLoading: true,
        error: undefined,
      },
    }));

    try {
      const data = await requestPostListByAuthor({
        authorUserId,
        workspaceId,
        limit,
        offset,
      });

      get().setAuthorPosts(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки статей';
      get().setAuthorPostsError(message);
    }
  },

  openPostById: async ({ postId, workspaceId }) => {
    const requestedPostId = postId;

    set({
      postId: '',
      currentWorkspaceId: workspaceId ?? get().currentWorkspaceId,
      currentVersion: 0,
      content: emptyDoc,
      plainText: '',
      isDirty: false,
      saveStatus: 'idle',
      suggestions: new Map(),
      activeSuggestionId: null,
      spellcheckPopupAnchor: null,
      currentPost: {
        postId,
        contentJson: emptyDoc,
        plainText: '',
        version: 0,
      },
      currentPostLoading: true,
      currentPostError: undefined,
      expectedDetailPostId: postId,
    });

    try {
      const detail = await requestPostDetail({ postId, workspaceId });
      if (get().expectedDetailPostId !== requestedPostId) {
        return;
      }
      get().applyPostDetail(detail);
      get().clearStaleSuggestions(detail.version);
    } catch (err) {
      if (get().expectedDetailPostId !== requestedPostId) {
        return;
      }
      const message = err instanceof Error ? err.message : 'Ошибка загрузки статьи';
      set({
        currentPostLoading: false,
        currentPostError: message,
      });
    }
  },

  applyPostDeleted: (postId) =>
    set((state) => {
      const hadItem = state.authorPosts.items.some((item) => item.postId === postId);
      const wasCurrent = state.currentPost.postId === postId;
      const nextPendingDeleteIds = new Set(state.pendingDeletePostIds);
      nextPendingDeleteIds.delete(postId);

      const nextAuthorPosts: AuthorPostsState = {
        ...state.authorPosts,
        items: state.authorPosts.items.filter((item) => item.postId !== postId),
        total: hadItem ? Math.max(0, state.authorPosts.total - 1) : state.authorPosts.total,
      };

      if (!wasCurrent) {
        return {
          authorPosts: nextAuthorPosts,
          pendingDeletePostIds: nextPendingDeleteIds,
        };
      }

      return {
        postId: '',
        currentWorkspaceId: null,
        currentVersion: 0,
        content: emptyDoc,
        plainText: '',
        isDirty: false,
        saveStatus: 'idle',
        authorPosts: nextAuthorPosts,
        currentPost: {
          postId: null,
          contentJson: emptyDoc,
          plainText: '',
          version: 0,
        },
        currentPostLoading: false,
        currentPostError: undefined,
        expectedDetailPostId: null,
        suggestions: new Map(),
        activeSuggestionId: null,
        aiLoadingByType: {
          spellcheck: 'idle',
          rewrite: 'idle',
          continue: 'idle',
          hooks: 'idle',
          audit: 'idle',
        },
        lastErrorByType: {},
        lastSuggestPayloadByType: {},
        spellcheckPopupAnchor: null,
        pendingDeletePostIds: nextPendingDeleteIds,
      };
    }),

  markDeleteRequested: (postId) =>
    set((state) => {
      const next = new Set(state.pendingDeletePostIds);
      next.add(postId);
      return { pendingDeletePostIds: next };
    }),

  clearDeleteRequested: (postId) =>
    set((state) => {
      if (!state.pendingDeletePostIds.has(postId)) return {};
      const next = new Set(state.pendingDeletePostIds);
      next.delete(postId);
      return { pendingDeletePostIds: next };
    }),

  addSuggestion: (suggestion) =>
    set((state) => {
      const next = new Map(state.suggestions);
      next.set(suggestion.id, suggestion);
      return {
        suggestions: next,
        activeSuggestionId: state.activeSuggestionId || suggestion.id,
      };
    }),

  removeSuggestion: (id) =>
    set((state) => {
      const next = new Map(state.suggestions);
      next.delete(id);
      return {
        suggestions: next,
        activeSuggestionId:
          state.activeSuggestionId === id ? null : state.activeSuggestionId,
      };
    }),

  clearAllSuggestions: () => set({ suggestions: new Map(), activeSuggestionId: null }),

  clearStaleSuggestions: (version) =>
    set((state) => {
      const next = new Map(state.suggestions);
      for (const [id, suggestion] of next.entries()) {
        if (suggestion.version < version) {
          next.delete(id);
        }
      }
      return {
        suggestions: next,
        activeSuggestionId:
          state.activeSuggestionId && !next.has(state.activeSuggestionId)
            ? null
            : state.activeSuggestionId,
      };
    }),

  setActiveSuggestionId: (id) => set({ activeSuggestionId: id }),

  setSelectedVariant: (id, index) =>
    set((state) => {
      const suggestion = state.suggestions.get(id);
      if (!suggestion) return state;
      const next = new Map(state.suggestions);
      next.set(id, { ...suggestion, selectedVariantIndex: index });
      return { suggestions: next };
    }),

  setAiLoadingState: ({ type, status, message }) =>
    set((state) => {
      const nextStatus =
        status === 'start' ? 'loading' : status === 'done' ? 'idle' : 'error';

      const lastError = { ...state.lastErrorByType };
      if (status === 'error') {
        lastError[type] = message || 'Ошибка подсказки';
      }
      if (status === 'done') {
        delete lastError[type];
      }

      const nextToasts =
        status === 'error'
          ? [
              ...state.toasts,
              {
                id: `${Date.now()}-${type}`,
                message: message || `Ошибка: ${type}`,
              },
            ]
          : state.toasts;

      return {
        aiLoadingByType: {
          ...state.aiLoadingByType,
          [type]: nextStatus,
        },
        lastErrorByType: lastError,
        toasts: nextToasts,
      };
    }),

  rememberSuggestPayload: (type, payload) =>
    set((state) => ({
      lastSuggestPayloadByType: {
        ...state.lastSuggestPayloadByType,
        [type]: payload,
      },
    })),

  addToast: (message) =>
    set((state) => ({
      toasts: [...state.toasts, { id: `${Date.now()}-${Math.random()}`, message }],
    })),

  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),

  setSpellcheckPopupAnchor: (anchor) => set({ spellcheckPopupAnchor: anchor }),

  setAiSettingsModalOpen: (open) => set({ aiSettingsModalOpen: open }),

  applyAiSettings: (data) =>
    set(() => ({
      aiSettings: {
        workspaceId: data.workspaceId,
        hasApiKey: data.hasApiKey,
        model: data.model,
        loading: false,
        error: null,
      },
    })),

  loadAiSettings: async (workspaceId) => {
    set((state) => ({
      aiSettings: {
        ...state.aiSettings,
        workspaceId,
        loading: true,
        error: null,
      },
    }));

    try {
      const data = await requestAiSettingsGet({ workspaceId });
      get().applyAiSettings(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки AI настроек';
      set((state) => ({
        aiSettings: {
          ...state.aiSettings,
          workspaceId,
          loading: false,
          error: message,
        },
      }));
    }
  },

  saveAiSettings: async ({ workspaceId, apiKey, model }) => {
    set((state) => ({
      aiSettings: {
        ...state.aiSettings,
        workspaceId,
        loading: true,
        error: null,
      },
    }));

    try {
      const data = await requestAiSettingsUpdate({ workspaceId, apiKey, model });
      get().applyAiSettings(data);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка сохранения AI настроек';
      set((state) => ({
        aiSettings: {
          ...state.aiSettings,
          workspaceId,
          loading: false,
          error: message,
        },
      }));
      return false;
    }
  },

  clearAiKey: async (workspaceId) => {
    set((state) => ({
      aiSettings: {
        ...state.aiSettings,
        workspaceId,
        loading: true,
        error: null,
      },
    }));

    try {
      const data = await requestAiSettingsClearKey({ workspaceId });
      get().applyAiSettings(data);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка очистки AI ключа';
      set((state) => ({
        aiSettings: {
          ...state.aiSettings,
          workspaceId,
          loading: false,
          error: message,
        },
      }));
      return false;
    }
  },

  ensureAiReady: () => {
    const state = get();
    if (!state.currentWorkspaceId) {
      return { ok: false, reason: 'Не найдено рабочее пространство для текущей сессии.' };
    }
    if (state.aiSettings.workspaceId !== state.currentWorkspaceId) {
      return { ok: false, reason: 'Настройки ИИ еще загружаются для текущего рабочего пространства.' };
    }
    if (!state.aiSettings.hasApiKey) {
      set({ aiSettingsModalOpen: true });
      return { ok: false, reason: 'Добавьте OpenRouter API-ключ в настройки ИИ для этого рабочего пространства.' };
    }
    return { ok: true };
  },
}));

export function getRetryEnvelope(type: SuggestionType): WSEnvelope | null {
  const state = useEditorStore.getState();
  const payload = state.lastSuggestPayloadByType[type];
  if (!payload) return null;

  if (type === 'spellcheck') {
    return { event: 'suggest.spellcheck', data: payload };
  }
  if (type === 'rewrite') {
    return { event: 'suggest.rewrite', data: payload };
  }
  if (type === 'hooks') {
    return { event: 'suggest.hooks', data: payload };
  }
  if (type === 'audit') {
    return { event: 'suggest.audit', data: payload };
  }
  return { event: 'suggest.continue', data: payload };
}
