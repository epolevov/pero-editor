/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Menu, Settings, Wifi, WifiOff, X } from 'lucide-react';
import { Editor, EditorHandle } from './components/Editor';
import { SuggestionsPanel } from './components/SuggestionsPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { ViewModeToggle } from './components/ViewModeToggle';
import { HotkeysHelp } from './components/HotkeysHelp';
import { useEditorStore } from './store/editorStore';
import { useWebSocket } from './hooks/useWebSocket';
import { AuthorPostsSidebar } from './components/AuthorPostsSidebar';
import { SuggestionPanelSkeleton } from './components/LoadingSkeletons';
import { ToastStack } from './components/ToastStack';
import { ConfirmDeleteModal } from './components/ConfirmDeleteModal';
import { UnsavedChangesModal } from './components/UnsavedChangesModal';
import { AiSettingsModal } from './components/AiSettingsModal';
import { AuthorPostListItem } from './lib/wsProtocol';

const defaultWorkspaceId = import.meta.env.VITE_WORKSPACE_ID || 'default-workspace';
const defaultAuthorUserId = import.meta.env.VITE_AUTHOR_USER_ID || 'default-user';

function getPostDisplayName(post: AuthorPostListItem | null) {
  if (!post) return 'Без названия';
  return post.name?.trim() || post.title?.trim() || 'Без названия';
}

type PendingNavigationAction =
  | { type: 'openPost'; post: AuthorPostListItem }
  | { type: 'createPost' };

export default function App() {
  const {
    wsConnected,
    viewMode,
    hydrateViewMode,
    currentPost,
    currentPostLoading,
    currentPostError,
    isDirty,
    saveStatus,
    aiSettingsModalOpen,
    setAiSettingsModalOpen,
    setSaveStatus,
  } = useEditorStore();
  const { send } = useWebSocket();
  const showSaveSlot = saveStatus === 'saving' || saveStatus === 'saved' || (isDirty && saveStatus === 'idle');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<AuthorPostListItem | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigationAction | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const editorRef = useRef<EditorHandle>(null);

  useEffect(() => {
    hydrateViewMode();
  }, [hydrateViewMode]);

  useEffect(() => {
    window.electronAPI?.onFullscreenChange?.(setIsFullscreen);
  }, []);

  const doSave = useCallback(() => {
    const s = useEditorStore.getState();
    if (!s.postId || s.saveStatus === 'saving') return;
    s.setSaveStatus('saving');
    send({
      event: 'post.update',
      data: {
        postId: s.postId,
        version: s.currentVersion + 1,
        contentJson: s.content as Record<string, unknown>,
        plainText: s.plainText,
      },
    });
  }, [send]);

  // Cmd+S / Ctrl+S
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        doSave();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [doSave]);

  // Reset 'saved' status back to 'idle' after 2s
  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const timer = setTimeout(() => setSaveStatus('idle'), 2000);
    return () => clearTimeout(timer);
  }, [saveStatus, setSaveStatus]);

  const requestDeletePost = useCallback((post: AuthorPostListItem) => {
    setDeleteCandidate(post);
  }, []);

  const cancelDeletePost = useCallback(() => {
    setDeleteCandidate(null);
  }, []);

  const confirmDeletePost = useCallback(() => {
    if (!deleteCandidate) return;

    const state = useEditorStore.getState();
    state.markDeleteRequested(deleteCandidate.postId);
    send({
      event: 'post.delete',
      data: {
        postId: deleteCandidate.postId,
      },
    });
    setDeleteCandidate(null);
  }, [deleteCandidate, send]);

  const runNavigation = useCallback((action: PendingNavigationAction) => {
    if (action.type === 'openPost') {
      void useEditorStore.getState().openPostById({
        postId: action.post.postId,
        workspaceId: defaultWorkspaceId,
      });
      setMobileSidebarOpen(false);
      return;
    }

    send({
      event: 'post.open',
      data: { workspaceId: defaultWorkspaceId, userId: defaultAuthorUserId },
    });
    setMobileSidebarOpen(false);
  }, [send]);

  const requestNavigation = useCallback((action: PendingNavigationAction) => {
    const state = useEditorStore.getState();
    if (state.isDirty) {
      setPendingNavigation(action);
      return;
    }
    runNavigation(action);
  }, [runNavigation]);

  const requestOpenPost = useCallback((post: AuthorPostListItem) => {
    if (post.postId === currentPost.postId) {
      setMobileSidebarOpen(false);
      return;
    }
    requestNavigation({ type: 'openPost', post });
  }, [currentPost.postId, requestNavigation]);

  const requestCreatePost = useCallback(() => {
    requestNavigation({ type: 'createPost' });
  }, [requestNavigation]);

  const cancelPendingNavigation = useCallback(() => {
    setPendingNavigation(null);
  }, []);

  const discardAndNavigate = useCallback(() => {
    if (!pendingNavigation) return;
    const nextAction = pendingNavigation;
    setPendingNavigation(null);
    runNavigation(nextAction);
  }, [pendingNavigation, runNavigation]);

  const saveAndNavigate = useCallback(() => {
    if (!pendingNavigation) return;

    const nextAction = pendingNavigation;
    setPendingNavigation(null);

    const state = useEditorStore.getState();
    if (state.isDirty && state.postId && state.saveStatus !== 'saving') {
      doSave();
    }
    runNavigation(nextAction);
  }, [doSave, pendingNavigation, runNavigation]);

  const pendingNavigationTitle = pendingNavigation?.type === 'openPost'
    ? getPostDisplayName(pendingNavigation.post)
    : 'Новая статья';

  return (
    <div
      data-view={viewMode}
      className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30"
    >
      <header className={`drag h-14 border-b border-white/[0.06] flex items-center justify-between pr-4 md:pr-6 ${isFullscreen ? 'pl-4 md:pl-6' : 'pl-[80px]'}`}>
        <div className="no-drag flex items-center gap-3">
          {viewMode === 'mobile' && (
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] bg-zinc-900 text-zinc-300"
            >
              <Menu className="h-4 w-4" />
            </button>
          )}
          <img src="./logo.png" alt="Pero Editor" className="w-6 h-6 rounded-lg" />
          <h1 className="text-sm font-medium text-zinc-100 tracking-wide">Pero Editor</h1>
          <span className="hidden md:flex items-center gap-1.5 text-xs text-zinc-500">
            {wsConnected ? (
              <><Wifi className="w-3.5 h-3.5 text-emerald-500" /> Подключено</>
            ) : (
              <><WifiOff className="w-3.5 h-3.5 text-red-500" /> Отключено</>
            )}
          </span>
        </div>

        <div className="no-drag flex items-center gap-1 md:gap-2">
          <button
            type="button"
            onClick={saveStatus === 'idle' && isDirty ? doSave : undefined}
            disabled={saveStatus !== 'idle' || !isDirty}
            tabIndex={showSaveSlot ? 0 : -1}
            aria-hidden={!showSaveSlot}
            className={`hidden md:inline-flex h-10 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-lg border bg-zinc-900 text-xs transition-all duration-300 ${
              showSaveSlot
                ? `max-w-36 px-3 py-1 opacity-100 translate-y-0 ${
                    saveStatus === 'idle' && isDirty
                      ? 'border-white/[0.06] bg-zinc-900 hover:border-white/[0.12]'
                      : saveStatus === 'saved'
                        ? 'border-emerald-400/30 bg-emerald-500/10'
                        : 'border-white/[0.06]'
                  }`
                : 'pointer-events-none h-10 max-w-0 border-transparent px-0 py-0 opacity-0 -translate-y-1'
            }`}
          >
            {saveStatus === 'saving' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-300" />
                <span className="text-zinc-300">Сохранение...</span>
              </>
            ) : saveStatus === 'saved' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-300" />
                <span className="text-emerald-200">Сохранено</span>
              </>
            ) : (
              <span className="text-zinc-300">Сохранить</span>
            )}
          </button>
          <ViewModeToggle />
          <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 p-1">
            <HotkeysHelp grouped />
            <button
              type="button"
              onClick={() => setAiSettingsModalOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] text-zinc-300 transition-colors hover:border-white/[0.12] hover:text-zinc-100"
              aria-label="Открыть настройки ИИ"
              title="Настройки ИИ"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="h-[calc(100vh-3.5rem)] p-4 md:p-6">
        <div className="h-full flex gap-4 md:gap-6">
          {viewMode !== 'mobile' && (
            <AuthorPostsSidebar
              onCreatePost={requestCreatePost}
              onSelectPost={requestOpenPost}
              onRequestDelete={requestDeletePost}
            />
          )}

          <div className="flex-1 min-w-0 h-full">
            {currentPostLoading ? (
              <div className="h-full rounded-xl border border-white/[0.06] bg-zinc-900/40 flex items-center justify-center px-6">
                <p className="text-sm text-zinc-400 text-center">Загрузка статьи...</p>
              </div>
            ) : currentPost.postId ? (
              <Editor ref={editorRef} viewMode={viewMode} send={send} />
            ) : (
              <div className="h-full rounded-xl border border-white/[0.06] bg-zinc-900/40 flex items-center justify-center px-6">
                <p className="text-sm text-zinc-400 text-center">
                  {currentPostError || 'Статья недоступна. Выберите другую статью в списке слева.'}
                </p>
              </div>
            )}
          </div>

          <div className="hidden lg:flex w-[360px] h-full flex-col gap-4">
            <div className="flex-1 min-h-0">
              {currentPostLoading ? <SuggestionPanelSkeleton /> : (
                <SuggestionsPanel
                  onAccept={(id) => editorRef.current?.acceptSuggestion(id)}
                  onReject={(id) => editorRef.current?.rejectSuggestion(id)}
                  onSpellcheck={() => editorRef.current?.triggerSpellcheck()}
                  onRewrite={() => editorRef.current?.triggerRewrite()}
                  onContinue={() => editorRef.current?.triggerContinue()}
                  onOpenAiSettings={() => setAiSettingsModalOpen(true)}
                />
              )}
            </div>
            <PreviewPanel />
          </div>
        </div>
      </main>

      {viewMode === 'mobile' && mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 bg-zinc-950/90 p-4">
          <div className="h-full flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm text-zinc-100">Статьи</h2>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] bg-zinc-900 text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <AuthorPostsSidebar
                mobile
                onCreatePost={requestCreatePost}
                onSelectPost={requestOpenPost}
                onRequestDelete={requestDeletePost}
              />
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteCandidate)}
        title={getPostDisplayName(deleteCandidate)}
        onCancel={cancelDeletePost}
        onConfirm={confirmDeletePost}
      />
      <UnsavedChangesModal
        open={Boolean(pendingNavigation)}
        title={pendingNavigationTitle}
        onCancel={cancelPendingNavigation}
        onDiscard={discardAndNavigate}
        onSaveAndContinue={saveAndNavigate}
      />
      <AiSettingsModal
        open={aiSettingsModalOpen}
        onClose={() => setAiSettingsModalOpen(false)}
      />

      <ToastStack />
    </div>
  );
}
