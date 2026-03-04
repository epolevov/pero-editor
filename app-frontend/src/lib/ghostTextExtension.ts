import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { useEditorStore } from '../store/editorStore';

function buildGhostWidget(insertText: string): HTMLElement {
  const paragraphs = insertText.split(/\n\n+/);
  const firstParagraph = paragraphs[0].replace(/\n/g, ' ').trim();
  const displayText = paragraphs.length > 1 ? firstParagraph + ' …' : firstParagraph;

  const wrapper = document.createElement('span');
  wrapper.contentEditable = 'false';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.userSelect = 'none';

  const textSpan = document.createElement('span');
  textSpan.textContent = displayText;
  textSpan.style.color = 'rgba(113, 113, 122, 0.55)';
  textSpan.style.fontStyle = 'italic';

  const hint = document.createElement('span');
  hint.textContent = 'Tab';
  hint.style.fontSize = '10px';
  hint.style.fontStyle = 'normal';
  hint.style.color = 'rgba(113, 113, 122, 0.45)';
  hint.style.marginLeft = '8px';
  hint.style.padding = '1px 5px';
  hint.style.border = '1px solid rgba(113, 113, 122, 0.25)';
  hint.style.borderRadius = '3px';
  hint.style.fontFamily = 'monospace';
  hint.style.letterSpacing = '0';

  wrapper.appendChild(textSpan);
  wrapper.appendChild(hint);
  return wrapper;
}

export const GhostText = Extension.create({
  name: 'ghostText',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('ghostText'),
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr) {
            const { activeSuggestionId, suggestions } = useEditorStore.getState();
            if (!activeSuggestionId) return DecorationSet.empty;

            const suggestion = suggestions.get(activeSuggestionId);
            if (!suggestion || suggestion.type !== 'continue' || !suggestion.insertText) {
              return DecorationSet.empty;
            }

            const pos = suggestion.range.from;
            if (pos < 0 || pos > tr.doc.content.size) return DecorationSet.empty;

            return DecorationSet.create(tr.doc, [
              Decoration.widget(pos, buildGhostWidget(suggestion.insertText), {
                side: 1,
                key: suggestion.id,
              }),
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
