import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { useEditorStore } from '../store/editorStore';

export const RewriteLoading = Extension.create({
  name: 'rewriteLoading',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('rewriteLoading'),
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr) {
            const { aiLoadingByType, lastSuggestPayloadByType } = useEditorStore.getState();

            if (aiLoadingByType.rewrite !== 'loading') return DecorationSet.empty;

            const selection = lastSuggestPayloadByType.rewrite?.selection;
            if (!selection) return DecorationSet.empty;

            const { from, to } = selection;
            if (from < 0 || to > tr.doc.content.size || from >= to) return DecorationSet.empty;

            return DecorationSet.create(tr.doc, [
              Decoration.inline(from, to, { class: 'rewrite-loading-highlight' }),
            ]);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
