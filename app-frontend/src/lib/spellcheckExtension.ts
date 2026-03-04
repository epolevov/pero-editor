import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { useEditorStore } from '../store/editorStore';

// Converts a 0-based character offset in editor.getText() to a ProseMirror doc position.
// Mirrors Tiptap 3.x getTextBetween: block nodes after the first contribute "\n\n" to the offset.
function textOffsetToDocPos(doc: PMNode, textPos: number): number {
  const BLOCK_SEP = '\n\n';
  let charCount = 0;
  let result = doc.content.size;
  let found = false;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isBlock && pos > 0) {
      if (charCount + BLOCK_SEP.length > textPos) {
        result = pos + 1;
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

export const SpellcheckHighlight = Extension.create({
  name: 'spellcheckHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('spellcheckHighlight'),
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, oldState) {
            const state = useEditorStore.getState();
            const suggestions = Array.from(state.suggestions.values());
            const decorations: Decoration[] = [];

            suggestions.forEach((suggestion) => {
              if (suggestion.type === 'spellcheck' && suggestion.range) {
                const from = textOffsetToDocPos(tr.doc, suggestion.range.from);
                const to = textOffsetToDocPos(tr.doc, suggestion.range.to);
                if (from >= 0 && to <= tr.doc.content.size && from < to) {
                  decorations.push(
                    Decoration.inline(from, to, {
                      class: 'spellcheck-highlight',
                      'data-suggestion-id': suggestion.id,
                    })
                  );
                }
              }
            });

            return DecorationSet.create(tr.doc, decorations);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleClick(view, pos, event) {
            const target = event.target as HTMLElement;
            const suggestionId = target.getAttribute('data-suggestion-id');
            if (suggestionId) {
              const domRect = target.getBoundingClientRect();
              const store = useEditorStore.getState();
              store.setActiveSuggestionId(suggestionId);
              store.setSpellcheckPopupAnchor({
                suggestionId,
                rect: {
                  top: domRect.top,
                  bottom: domRect.bottom,
                  left: domRect.left,
                  right: domRect.right,
                  width: domRect.width,
                },
              });
              return true;
            }
            useEditorStore.getState().setSpellcheckPopupAnchor(null);
            return false;
          }
        },
      }),
    ];
  },
});
