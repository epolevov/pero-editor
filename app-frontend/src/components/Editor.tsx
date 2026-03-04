import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorStore, getRetryEnvelope } from '../store/editorStore';
import { WSEnvelope } from '../lib/wsProtocol';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { SpellcheckHighlight } from '../lib/spellcheckExtension';
import { GhostText } from '../lib/ghostTextExtension';
import { RewriteLoading } from '../lib/rewriteLoadingExtension';
import { EditorAreaSkeleton } from './LoadingSkeletons';
import { AnimatePresence, motion } from 'motion/react';

interface EditorProps {
  viewMode?: 'desktop' | 'mobile';
  send: (msg: WSEnvelope) => void;
}

export interface EditorHandle {
  acceptSuggestion: (id: string) => void;
  rejectSuggestion: (id: string) => void;
  triggerSpellcheck: () => void;
  triggerRewrite: () => void;
  triggerContinue: () => void;
  triggerHooks: () => void;
}

function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
  );
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({ viewMode = 'desktop', send }, ref) {
  const {
    content,
    suggestions,
    activeSuggestionId,
    currentPostLoading,
    aiLoadingByType,
    lastSuggestPayloadByType,
    rememberSuggestPayload,
    spellcheckPopupAnchor,
    setSpellcheckPopupAnchor,
    ensureAiReady,
  } = useEditorStore();

  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [intentMenuOpen, setIntentMenuOpen] = useState(false);
  const [cursorUiPos, setCursorUiPos] = useState({ x: 24, y: 24 });
  const [commandNote, setCommandNote] = useState('');
  const [isMac, setIsMac] = useState(false);
  const modifierKeyLabel = isMac ? 'Cmd' : 'Ctrl';

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Начните писать...',
      }),
      SpellcheckHighlight,
      GhostText,
      RewriteLoading,
    ],
    content,
    editorProps: {
      attributes: {
        class: 'tiptap-content focus:outline-none min-h-[500px] text-zinc-300 tracking-normal',
      },
      handleKeyDown: (_, event) => {
        const mod = event.metaKey || event.ctrlKey;

        if (event.code === 'Tab') {
          const state = useEditorStore.getState();
          const active = state.activeSuggestionId
            ? state.suggestions.get(state.activeSuggestionId)
            : null;
          if (active?.type === 'continue') {
            event.preventDefault();
            acceptActiveSuggestion();
            return true;
          }
          event.preventDefault();
          updateCursorUiPosition();
          setIntentMenuOpen(false);
          setActionMenuOpen((prev) => !prev);
          return true;
        }

        if (mod && event.shiftKey && event.code === 'KeyE') {
          event.preventDefault();
          requestSpellcheck();
          return true;
        }
        if (mod && event.shiftKey && event.code === 'KeyR') {
          event.preventDefault();
          requestRewrite();
          return true;
        }
        if (mod && event.shiftKey && event.code === 'ArrowRight') {
          event.preventDefault();
          openContinueIntentMenu();
          return true;
        }
        if (mod && event.code === 'Enter') {
          event.preventDefault();
          acceptActiveSuggestion();
          return true;
        }
        if (event.code === 'Escape') {
          event.preventDefault();
          if (intentMenuOpen) setIntentMenuOpen(false);
          if (actionMenuOpen) setActionMenuOpen(false);
          const state = useEditorStore.getState();
          if (state.activeSuggestionId && state.suggestions.has(state.activeSuggestionId)) {
            rejectActiveSuggestion();
          }
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      const contentJson = nextEditor.getJSON();
      const plainText = nextEditor.getText();

      const state = useEditorStore.getState();
      state.setContent(contentJson as Record<string, unknown>);
      state.setPlainText(plainText);
      state.setIsDirty(true);
    },
  });

  function showCommandNote(message: string) {
    setCommandNote(message);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setCommandNote(''), 2400);
  }

  function getActionState() {
    const state = useEditorStore.getState();
    if (!editor) {
      return {
        canSpellcheck: false,
        canRewrite: false,
        canContinue: false,
        canAccept: false,
        canReject: false,
      };
    }

    const hasSession = Boolean(state.postId);
    const plainText = editor.getText().trim();
    const hasPlainText = plainText.length > 0;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim();
    const hasSelection = selectedText.length > 0;
    const hasActiveSuggestion = Boolean(
      state.activeSuggestionId && state.suggestions.has(state.activeSuggestionId),
    );

    return {
      canSpellcheck: hasSession && hasPlainText,
      canRewrite: hasSession && hasSelection,
      canContinue: hasSession,
      canAccept: hasSession && hasActiveSuggestion,
      canReject: hasSession && hasActiveSuggestion,
    };
  }

  function updateCursorUiPosition() {
    if (!editor || !editorScrollRef.current) return;

    const selectionPos = editor.state.selection.from;
    const caretCoords = editor.view.coordsAtPos(selectionPos);
    const editorRect = editorScrollRef.current.getBoundingClientRect();

    setCursorUiPos({
      x: caretCoords.right + 6,
      y: Math.round((caretCoords.top + caretCoords.bottom) / 2),
    });
  }

  function requestSpellcheck() {
    if (!editor) return;
    const actionState = getActionState();
    if (!actionState.canSpellcheck) {
      showCommandNote('Spellcheck доступен только для непустого текста после подключения к документу.');
      return;
    }

    const state = useEditorStore.getState();
    const aiReady = ensureAiReady();
    if ('reason' in aiReady) {
      showCommandNote(aiReady.reason);
      return;
    }
    const plainText = editor.getText().trim();
    const payload = {
      postId: state.postId,
      workspaceId: state.currentWorkspaceId as string,
      version: state.currentVersion,
      plainText,
    };

    rememberSuggestPayload('spellcheck', payload);
    send({ event: 'suggest.spellcheck', data: payload });
    setActionMenuOpen(false);
  }

  function requestRewrite() {
    if (!editor) return;
    const actionState = getActionState();
    if (!actionState.canRewrite) {
      showCommandNote('Rewrite работает только при выделенном тексте.');
      return;
    }

    const state = useEditorStore.getState();
    const aiReady = ensureAiReady();
    if ('reason' in aiReady) {
      showCommandNote(aiReady.reason);
      return;
    }
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim();
    if (!selectedText) return;

    const payload = {
      postId: state.postId,
      workspaceId: state.currentWorkspaceId as string,
      version: state.currentVersion,
      selection: { from, to },
      selectedText,
      contextText: editor.getText(),
    };

    rememberSuggestPayload('rewrite', payload);
    send({ event: 'suggest.rewrite', data: payload });
    setActionMenuOpen(false);
  }

  function requestHooks() {
    if (!editor) return;
    const actionState = getActionState();
    if (!actionState.canSpellcheck) {
      showCommandNote('Зацепки доступны только для непустого текста после подключения к документу.');
      return;
    }

    const state = useEditorStore.getState();
    const aiReady = ensureAiReady();
    if ('reason' in aiReady) {
      showCommandNote(aiReady.reason);
      return;
    }

    const plainText = editor.getText().trim();
    if (plainText.length < 300) {
      showCommandNote('Текст слишком короткий для генерации зацепок (минимум 300 символов).');
      return;
    }

    const payload = {
      postId: state.postId,
      workspaceId: state.currentWorkspaceId as string,
      version: state.currentVersion,
      plainText,
    };

    rememberSuggestPayload('hooks', payload);
    send({ event: 'suggest.hooks', data: payload });
    setActionMenuOpen(false);
  }

  function openContinueIntentMenu() {
    const actionState = getActionState();
    if (!actionState.canContinue) {
      showCommandNote('Continue станет доступен после открытия документа.');
      return;
    }
    const aiReady = ensureAiReady();
    if ('reason' in aiReady) {
      showCommandNote(aiReady.reason);
      return;
    }
    updateCursorUiPosition();
    setActionMenuOpen(false);
    setIntentMenuOpen(true);
  }

  // Converts a 0-based character offset in editor.getText() to a ProseMirror document position.
  // Mirrors Tiptap 3.x getTextBetween logic: block nodes (except the first) contribute "\n\n"
  // to the plain-text offset, matching the blockSeparator used by editor.getText().
  // Spellcheck ranges from server are positions in plainText; rewrite/continue ranges are
  // already ProseMirror positions (they originate from editor.state.selection).
  function textOffsetToDocPos(textPos: number): number {
    const BLOCK_SEP = '\n\n'; // Tiptap 3.x default blockSeparator in getText()
    const doc = editor!.state.doc;
    let charCount = 0;
    let result = doc.content.size;
    let found = false;
    doc.descendants((node, pos) => {
      if (found) return false;
      // Add separator for every block after the first (mirrors getTextBetween behaviour)
      if (node.isBlock && pos > 0) {
        if (charCount + BLOCK_SEP.length > textPos) {
          result = pos + 1; // map into the start of this block's content
          found = true;
          return false;
        }
        charCount += BLOCK_SEP.length;
      }
      if (node.isText) {
        const len = node.text!.length;
        if (charCount + len > textPos) {
          result = pos + (textPos - charCount);
          found = true;
          return false;
        }
        charCount += len;
      }
      return true;
    });
    return result;
  }

  function acceptSuggestionById(id: string) {
    const state = useEditorStore.getState();
    const suggestion = state.suggestions.get(id);
    if (!suggestion || !editor) return;

    if ((suggestion.type === 'spellcheck' || suggestion.type === 'rewrite') && suggestion.replacements?.length) {
      const variantIndex = suggestion.selectedVariantIndex ?? 0;
      const replacement = suggestion.replacements[variantIndex] ?? suggestion.replacements[0];
      const from = suggestion.type === 'spellcheck'
        ? textOffsetToDocPos(suggestion.range.from)
        : suggestion.range.from;
      const to = suggestion.type === 'spellcheck'
        ? textOffsetToDocPos(suggestion.range.to)
        : suggestion.range.to;
      editor.view.dispatch(
        editor.state.tr.insertText(replacement, from, to),
      );
    }

    if (suggestion.type === 'hooks' && suggestion.replacements?.length) {
      const variantIndex = suggestion.selectedVariantIndex ?? 0;
      const hookText = suggestion.replacements[variantIndex] ?? suggestion.replacements[0];
      const { schema, tr } = editor.state;
      const hookParagraph = schema.nodes.paragraph.create(null, schema.text(hookText));
      editor.view.dispatch(tr.insert(0, hookParagraph));
    }

    if (suggestion.type === 'continue' && suggestion.insertText) {
      const insertPos = suggestion.range.from;
      const charBefore = editor.state.doc.textBetween(Math.max(0, insertPos - 1), insertPos, '');
      const needsSpace = charBefore.length > 0 && !/\s/.test(charBefore);
      editor
        .chain()
        .focus()
        .setTextSelection(insertPos)
        .insertContent(needsSpace ? ' ' + suggestion.insertText : suggestion.insertText)
        .run();
    }

    send({
      event: 'suggest.apply',
      data: {
        postId: state.postId,
        version: state.currentVersion,
        suggestionId: id,
        action: 'accept',
      },
    });

    state.removeSuggestion(id);
    setSpellcheckPopupAnchor(null);
    setActionMenuOpen(false);
  }

  function rejectSuggestionById(id: string) {
    const state = useEditorStore.getState();

    send({
      event: 'suggest.apply',
      data: {
        postId: state.postId,
        version: state.currentVersion,
        suggestionId: id,
        action: 'reject',
      },
    });

    state.removeSuggestion(id);
    setSpellcheckPopupAnchor(null);
    setActionMenuOpen(false);
  }

  function acceptActiveSuggestion() {
    const state = useEditorStore.getState();
    const actionState = getActionState();
    if (!actionState.canAccept) {
      showCommandNote('Нужна активная подсказка от backend, чтобы принять её.');
      return;
    }
    if (!state.activeSuggestionId) return;
    acceptSuggestionById(state.activeSuggestionId);
  }

  function rejectActiveSuggestion() {
    const state = useEditorStore.getState();
    const actionState = getActionState();
    if (!actionState.canReject) {
      showCommandNote('Нужна активная подсказка от backend, чтобы отклонить её.');
      return;
    }
    if (!state.activeSuggestionId) return;
    rejectSuggestionById(state.activeSuggestionId);
  }

  useImperativeHandle(ref, () => ({
    acceptSuggestion: acceptSuggestionById,
    rejectSuggestion: rejectSuggestionById,
    triggerSpellcheck: requestSpellcheck,
    triggerRewrite: requestRewrite,
    triggerContinue: openContinueIntentMenu,
    triggerHooks: requestHooks,
  }), [editor, send]);

  function handleIntentSelect(intent: 'summary' | 'example' | 'argument' | 'conclusion') {
    if (!editor) return;
    const state = useEditorStore.getState();
    if (!state.postId) {
      showCommandNote('Continue станет доступен после открытия документа.');
      return;
    }
    const aiReady = ensureAiReady();
    if ('reason' in aiReady) {
      showCommandNote(aiReady.reason);
      return;
    }

    const { from, to } = editor.state.selection;
    const cursorPos = from !== to ? to : from;
    const payload = {
      postId: state.postId,
      workspaceId: state.currentWorkspaceId as string,
      version: state.currentVersion,
      cursorPos,
      intent,
      contextText: editor.getText(),
    };

    rememberSuggestPayload('continue', payload);
    send({ event: 'suggest.continue', data: payload });

    setIntentMenuOpen(false);
  }

  function handleRetry(type: 'spellcheck' | 'rewrite' | 'continue' | 'hooks') {
    const aiReady = ensureAiReady();
    if ('reason' in aiReady) {
      showCommandNote(aiReady.reason);
      return;
    }
    const envelope = getRetryEnvelope(type);
    if (!envelope) {
      showCommandNote(`Нет данных для повтора ${type}.`);
      return;
    }
    send(envelope);
  }

  useEffect(() => {
    if (!editor) return;

    const local = JSON.stringify(editor.getJSON());
    const incoming = JSON.stringify(content);
    if (local !== incoming) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  useEffect(() => {
    if (!editor) return;

    const sync = () => updateCursorUiPosition();
    const handleScroll = () => updateCursorUiPosition();

    editor.on('selectionUpdate', sync);
    editor.on('focus', sync);
    editor.on('transaction', sync);

    const scrollEl = editorScrollRef.current;
    scrollEl?.addEventListener('scroll', handleScroll);

    sync();

    return () => {
      editor.off('selectionUpdate', sync);
      editor.off('focus', sync);
      editor.off('transaction', sync);
      scrollEl?.removeEventListener('scroll', handleScroll);
    };
  }, [editor]);

  useEffect(() => {
    if (editor) {
      editor.view.dispatch(editor.view.state.tr);
    }
  }, [suggestions, activeSuggestionId, aiLoadingByType, editor]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const platform = window.navigator.platform || '';
    const userAgent = window.navigator.userAgent || '';
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS/i.test(userAgent));
  }, []);

  useEffect(() => {
    return () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!spellcheckPopupAnchor) return;

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (popupRef.current?.contains(target)) return;
      if (target.getAttribute('data-suggestion-id')) return;
      setSpellcheckPopupAnchor(null);
    }

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [spellcheckPopupAnchor, setSpellcheckPopupAnchor]);

  useEffect(() => {
    if (!actionMenuOpen && !intentMenuOpen) return;

    function handleMouseDown(e: MouseEvent) {
      if (actionMenuRef.current?.contains(e.target as Node)) return;
      setActionMenuOpen(false);
      setIntentMenuOpen(false);
    }

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [actionMenuOpen, intentMenuOpen]);

  const actionState = getActionState();

  if (currentPostLoading) {
    return <EditorAreaSkeleton />;
  }

  return (
    <div className="relative h-full flex flex-col">
      <div className={`flex-1 min-h-0 flex ${viewMode === 'mobile' ? 'justify-center' : 'flex-col'}`}>
        <div
          ref={editorScrollRef}
          className={`w-full border border-white/[0.06] bg-zinc-950 rounded-xl p-6 ${
            viewMode === 'mobile'
              ? 'overflow-y-auto max-w-[390px] max-h-[820px]'
              : 'flex-1 min-h-0 overflow-y-auto'
          }`}
        >
          <div
            ref={editorSurfaceRef}
            data-view={viewMode}
            className="editor-shell relative min-h-[500px] tracking-normal"
          >
            <EditorContent editor={editor} />

            {createPortal(
              <AnimatePresence>
                {(editor?.isFocused || actionMenuOpen || intentMenuOpen) && (
                  <motion.div
                    ref={actionMenuRef}
                    initial={{ opacity: 0, top: cursorUiPos.y }}
                    animate={{ opacity: 1, top: cursorUiPos.y }}
                    exit={{ opacity: 0 }}
                    transition={{
                      opacity: { duration: 0.15 },
                      top: { duration: 0.12, ease: 'easeOut' },
                    }}
                    className="fixed z-40"
                    style={{ left: `${cursorUiPos.x}px`, transform: 'translateY(-50%)' }}
                >
                  {actionMenuOpen && (
                    <div className="mt-2 w-60 bg-zinc-900 border border-white/[0.08] rounded-xl p-2 flex flex-col gap-1">
                      {actionState.canSpellcheck && (
                        <button
                          className="px-3 py-2 text-sm rounded-lg text-zinc-200 hover:bg-zinc-800 flex items-center justify-between gap-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={requestSpellcheck}
                        >
                          <span>Орфография</span>
                          <span className="flex items-center gap-1.5">
                            {aiLoadingByType.spellcheck === 'loading' && <Spinner />}
                            <kbd className="text-xs text-zinc-500">{modifierKeyLabel}+Shift+E</kbd>
                          </span>
                        </button>
                      )}
                      {actionState.canRewrite && (
                        <button
                          className="px-3 py-2 text-sm rounded-lg text-zinc-200 hover:bg-zinc-800 flex items-center justify-between gap-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={requestRewrite}
                        >
                          <span>Переписать</span>
                          <span className="flex items-center gap-1.5">
                            {aiLoadingByType.rewrite === 'loading' && <Spinner />}
                            <kbd className="text-xs text-zinc-500">{modifierKeyLabel}+Shift+R</kbd>
                          </span>
                        </button>
                      )}
                      {actionState.canContinue && (
                        <button
                          className="px-3 py-2 text-sm rounded-lg text-zinc-200 hover:bg-zinc-800 flex items-center justify-between gap-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={openContinueIntentMenu}
                        >
                          <span>Продолжить</span>
                          <span className="flex items-center gap-1.5">
                            {aiLoadingByType.continue === 'loading' && <Spinner />}
                            <kbd className="text-xs text-zinc-500">{modifierKeyLabel}+Shift+→</kbd>
                          </span>
                        </button>
                      )}
                      {actionState.canSpellcheck && (
                        <button
                          className="px-3 py-2 text-sm rounded-lg text-zinc-200 hover:bg-zinc-800 flex items-center justify-between gap-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={requestHooks}
                        >
                          <span>Зацепки</span>
                          <span className="flex items-center gap-1.5">
                            {aiLoadingByType.hooks === 'loading' && <Spinner />}
                          </span>
                        </button>
                      )}
                      {(lastSuggestPayloadByType.spellcheck || lastSuggestPayloadByType.rewrite || lastSuggestPayloadByType.continue || lastSuggestPayloadByType.hooks) && (
                        <div className="h-px bg-white/[0.08] my-1" />
                      )}
                      {lastSuggestPayloadByType.spellcheck && (
                        <button
                          className="px-3 py-2 text-sm rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 flex items-center justify-between gap-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleRetry('spellcheck')}
                        >
                          <span>Повторить орфографию</span>
                        </button>
                      )}
                      {lastSuggestPayloadByType.rewrite && (
                        <button
                          className="px-3 py-2 text-sm rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 flex items-center justify-between gap-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleRetry('rewrite')}
                        >
                          <span>Повторить переписывание</span>
                        </button>
                      )}
                      {lastSuggestPayloadByType.continue && (
                        <button
                          className="px-3 py-2 text-sm rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 flex items-center justify-between gap-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleRetry('continue')}
                        >
                          <span>Повторить продолжение</span>
                        </button>
                      )}
                      {lastSuggestPayloadByType.hooks && (
                        <button
                          className="px-3 py-2 text-sm rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 flex items-center justify-between gap-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleRetry('hooks')}
                        >
                          <span>Повторить зацепки</span>
                        </button>
                      )}
                      {(actionState.canAccept || actionState.canReject) && <div className="h-px bg-white/[0.08] my-1" />}
                      {actionState.canAccept && (
                        <button
                          className="px-3 py-2 text-sm rounded-lg text-zinc-200 hover:bg-zinc-800 flex items-center justify-between gap-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={acceptActiveSuggestion}
                        >
                          <span>Принять подсказку</span>
                          <kbd className="text-xs text-zinc-500">{modifierKeyLabel}+Enter</kbd>
                        </button>
                      )}
                      {actionState.canReject && (
                        <button
                          className="px-3 py-2 text-sm rounded-lg text-zinc-200 hover:bg-zinc-800 flex items-center justify-between gap-2"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={rejectActiveSuggestion}
                        >
                          <span>Отклонить подсказку</span>
                          <kbd className="text-xs text-zinc-500">Esc</kbd>
                        </button>
                      )}
                    </div>
                  )}

                  {intentMenuOpen && (
                    <div className="mt-2 w-56 bg-zinc-900 border border-white/[0.08] rounded-xl p-2 z-50 flex flex-col gap-1">
                      <div className="text-xs text-zinc-500 px-2 py-1 uppercase tracking-wider font-semibold">Продолжить:</div>
                      {([
                        { value: 'summary', label: 'Резюме' },
                        { value: 'example', label: 'Пример' },
                        { value: 'argument', label: 'Аргумент' },
                        { value: 'conclusion', label: 'Заключение' },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          className="text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 rounded-lg transition-colors"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleIntentSelect(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  </motion.div>
                )}
              </AnimatePresence>,
              document.body,
            )}
          </div>
        </div>
      </div>

      {commandNote && <div className="mt-2 px-2 text-xs text-amber-300">{commandNote}</div>}

      {spellcheckPopupAnchor && (() => {
        const suggestion = suggestions.get(spellcheckPopupAnchor.suggestionId);
        if (!suggestion?.replacements?.length) return null;

        const { rect } = spellcheckPopupAnchor;
        const POPUP_WIDTH = 216;
        const rawLeft = rect.left + rect.width / 2;
        const clampedLeft = Math.max(
          POPUP_WIDTH / 2 + 8,
          Math.min(rawLeft, window.innerWidth - POPUP_WIDTH / 2 - 8),
        );

        return createPortal(
          <div
            ref={popupRef}
            className="fixed z-50 bg-zinc-900 border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden"
            style={{ width: POPUP_WIDTH, left: clampedLeft, top: rect.bottom + 6, transform: 'translateX(-50%)' }}
          >
            <div className="px-3 pt-3 pb-2 space-y-1">
              {suggestion.replacements.map((r, i) => (
                <p key={i} className="text-sm text-zinc-100">{r}</p>
              ))}
            </div>
            <div className="px-2 pb-2 flex gap-1.5">
              <button
                onClick={() => acceptSuggestionById(suggestion.id)}
                className="flex-1 py-1.5 text-xs rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
              >
                Принять
              </button>
              <button
                onClick={() => rejectSuggestionById(suggestion.id)}
                className="flex-1 py-1.5 text-xs rounded-lg bg-white/[0.04] text-zinc-400 border border-white/[0.06] hover:bg-white/[0.08] hover:text-zinc-300 transition-colors"
              >
                Отклонить
              </button>
            </div>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
});
