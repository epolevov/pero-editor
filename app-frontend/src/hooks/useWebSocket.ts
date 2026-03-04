import { useEffect, useRef, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import {
  AiSettingsData,
  PostAckData,
  PostDeletedData,
  PostDetailData,
  PostListData,
  PostSnapshotData,
  SuggestLoadingData,
  SuggestRemovedData,
  SuggestResultData,
  VersionConflictData,
  WSEnvelope,
  SuggestionType,
} from '../lib/wsProtocol';
import {
  rejectAllPending,
  resolveWsEvent,
  setWsApiTransport,
} from '../lib/wsApi';

const defaultWsUrl =
  (window as any).electronAPI?.wsUrl ??
  import.meta.env.VITE_WS_URL ??
  'ws://localhost:8080';
const defaultWorkspaceId = import.meta.env.VITE_WORKSPACE_ID || 'default-workspace';
const defaultAuthorUserId = import.meta.env.VITE_AUTHOR_USER_ID || 'default-user';
const defaultPostsLimit = Number(import.meta.env.VITE_POST_LIST_LIMIT || 20);

export function useWebSocket(url: string = defaultWsUrl) {
  const ws = useRef<WebSocket | null>(null);
  const requestedInitialOpenRef = useRef(false);

  const send = useCallback((msg: WSEnvelope) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  const sendOpen = useCallback((existingPostId?: string) => {
    const reconnectPostId = existingPostId || useEditorStore.getState().postId;
    if (reconnectPostId) {
      send({ event: 'post.open', data: { postId: reconnectPostId } });
      return;
    }

    send({
      event: 'post.open',
      data: { workspaceId: defaultWorkspaceId, userId: defaultAuthorUserId },
    });
  }, [send]);

  const extractText = useCallback((node: unknown): string => {
    if (!node || typeof node !== 'object') return '';
    const textNode = node as { text?: string; content?: unknown[] };
    const ownText = typeof textNode.text === 'string' ? textNode.text : '';
    const children = Array.isArray(textNode.content)
      ? textNode.content.map((child) => extractText(child)).join(' ')
      : '';
    return `${ownText} ${children}`.trim();
  }, []);

  const handleMessage = useCallback((msg: WSEnvelope) => {
    const state = useEditorStore.getState();

    resolveWsEvent(msg);

    switch (msg.event) {
      case 'post.snapshot': {
        const data = msg.data as PostSnapshotData;
        state.applyPostSnapshot({
          postId: data.postId,
          workspaceId: data.workspaceId,
          version: data.version,
          contentJson: data.contentJson,
          plainText: extractText(data.contentJson),
        });
        void state.loadAiSettings(data.workspaceId);
        break;
      }

      case 'post.ack': {
        const data = msg.data as PostAckData;
        state.setCurrentVersion(data.version);
        state.setIsDirty(false);
        state.setSaveStatus('saved');
        break;
      }

      case 'post.list': {
        const data = msg.data as PostListData;
        state.setAuthorPosts(data);
        if (!requestedInitialOpenRef.current) {
          requestedInitialOpenRef.current = true;
          if (data.items.length > 0) {
            sendOpen(data.items[0].postId);
          } else {
            sendOpen();
          }
        }
        break;
      }

      case 'post.detail': {
        const data = msg.data as PostDetailData;
        const expectedPostId = state.expectedDetailPostId;
        if (expectedPostId && data.postId !== expectedPostId) {
          break;
        }
        state.applyPostDetail(data);
        state.clearStaleSuggestions(data.version);
        if (state.currentWorkspaceId) {
          void state.loadAiSettings(state.currentWorkspaceId);
        }
        break;
      }

      case 'post.deleted': {
        const data = msg.data as PostDeletedData;
        const wasCurrentPost = state.currentPost.postId === data.postId;
        const wasInAuthorList = state.authorPosts.items.some((item) => item.postId === data.postId);
        const deletedByMe = state.pendingDeletePostIds.has(data.postId);

        state.applyPostDeleted(data.postId);

        if (deletedByMe) {
          state.addToast('Статья удалена');
        } else if (wasCurrentPost || wasInAuthorList) {
          state.addToast('Статья удалена другим участником');
        }
        break;
      }

      case 'suggest.loading': {
        const data = msg.data as SuggestLoadingData;
        state.setAiLoadingState({ type: data.type, status: data.status, message: data.message });
        break;
      }

      case 'suggest.result': {
        const data = msg.data as SuggestResultData;
        const suggestion = data.suggestion;
        const rewriteOriginal =
          suggestion.type === 'rewrite'
            ? state.lastSuggestPayloadByType.rewrite?.selectedText
            : undefined;
        state.addSuggestion(
          rewriteOriginal ? { ...suggestion, originalText: rewriteOriginal } : suggestion,
        );
        break;
      }

      case 'suggest.removed': {
        const data = msg.data as SuggestRemovedData;
        state.removeSuggestion(data.suggestionId);
        break;
      }

      case 'ai.settings': {
        const data = msg.data as AiSettingsData;
        state.applyAiSettings(data);
        break;
      }

      case 'error': {
        const errorData = msg.data as {
          event?: string;
          message?: string;
          code?: string;
        };
        const errorEvent = errorData.event;
        const errorMessage = errorData.message;

        if (errorEvent === 'post.open' && errorMessage?.includes('not found')) {
          state.setPostId('');
          sendOpen();
          break;
        }

        if (errorEvent === 'post.delete') {
          const deleteErrorData = msg.data as {
            postId?: string;
            message?: string;
          };
          if (deleteErrorData.postId) {
            state.clearDeleteRequested(deleteErrorData.postId);
          }
          state.addToast(deleteErrorData.message || 'Не удалось удалить статью');
          break;
        }

        if (errorData.code === 'VERSION_CONFLICT') {
          const data = msg.data as VersionConflictData;
          console.warn('Version conflict detected. Re-syncing...', data);
          sendOpen(state.postId);
        }

        if (errorEvent?.startsWith('suggest.')) {
          const type = errorEvent.split('.')[1] as SuggestionType | undefined;
          if (type && (type === 'spellcheck' || type === 'rewrite' || type === 'continue' || type === 'hooks')) {
            state.setAiLoadingState({
              type,
              status: 'error',
              message: errorMessage || 'Ошибка AI запроса',
            });
          }
        }
        break;
      }

      default:
        break;
    }
  }, [extractText, sendOpen]);

  const connect = useCallback(() => {
    ws.current = new WebSocket(url);

    ws.current.onopen = () => {
      const state = useEditorStore.getState();
      state.setWsConnected(true);
      setWsApiTransport((envelope) => send(envelope));
      requestedInitialOpenRef.current = false;
      send({
        event: 'post.listByAuthor',
        data: {
          authorUserId: defaultAuthorUserId,
          workspaceId: defaultWorkspaceId,
          limit: defaultPostsLimit,
          offset: 0,
        },
      });
    };

    ws.current.onmessage = (event) => {
      try {
        const msg: WSEnvelope = JSON.parse(event.data);
        handleMessage(msg);
      } catch (err) {
        console.error('Failed to parse WS message', err);
      }
    };

    ws.current.onclose = () => {
      useEditorStore.getState().setWsConnected(false);
      setWsApiTransport(null);
      rejectAllPending('WebSocket closed');
      setTimeout(connect, 3000);
    };

    ws.current.onerror = (err) => {
      console.error('WS Error', err);
    };
  }, [url, sendOpen, send, handleMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (ws.current) {
        ws.current.close();
      }
      setWsApiTransport(null);
      rejectAllPending('WebSocket disposed');
    };
  }, [connect]);

  return { send };
}
