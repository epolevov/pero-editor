# CLAUDE.md — Pero Text Assistant Frontend

## Project Overview

**Pero Text Assistant** is a realtime AI writing assistant frontend built as a single-page React app.

### Stack
- **Framework**: React 19 + Vite 6 + TypeScript
- **Editor**: Tiptap (ProseMirror) with custom SpellcheckHighlight extension
- **Styling**: Tailwind CSS v4 (via `@tailwindcss/vite` plugin)
- **State**: Zustand v5
- **Transport**: Native WebSocket API
- **Icons**: lucide-react
- **Animation**: motion

### Design System
Dark minimalism — no blur, no glow, no glassmorphism:
- Background: `zinc-950`
- Text: `zinc-100` / `zinc-300`
- Accent: `emerald-500`
- Borders: `border-white/[0.06]`
- Radius: `rounded-lg` / `rounded-xl`

---

## Project Structure

```
src/
├── App.tsx                          # Root layout: header, sidebar, editor, panels
├── main.tsx                         # Entry point
├── index.css                        # Global styles
├── components/
│   ├── Editor.tsx                   # Tiptap editor + AI action menu + hotkeys
│   ├── SuggestionsPanel.tsx         # Right panel: suggestion list + accept/reject
│   ├── PreviewPanel.tsx             # Desktop/mobile post preview
│   ├── AuthorPostsSidebar.tsx       # Left sidebar: author's post list
│   ├── HotkeysHelp.tsx              # Hotkeys help overlay
│   ├── LoadingSkeletons.tsx         # Skeleton loaders
│   ├── ToastStack.tsx               # Toast notification stack
│   └── ViewModeToggle.tsx           # Desktop/mobile view toggle
├── hooks/
│   └── useWebSocket.ts              # WS lifecycle, reconnect, message routing
├── store/
│   └── editorStore.ts               # Zustand store (all app state)
└── lib/
    ├── wsProtocol.ts                # WS message type definitions
    ├── wsApi.ts                     # Promise-based WS request layer
    └── spellcheckExtension.ts       # Tiptap spellcheck highlight extension
```

---

## WebSocket Protocol

Connect to `ws://localhost:8080` (env: `VITE_WS_URL`).

**Envelope format** (all messages):
```json
{ "event": "string", "data": {} }
```

**Lifecycle**:
1. Connect → send `post.open`
2. Receive `post.snapshot` → hydrate editor, load author posts
3. On every meaningful edit (debounce ≥ 300ms) → send `post.update` with `version = currentVersion + 1`
4. On `post.ack` → update `currentVersion`
5. On `error.code === VERSION_CONFLICT` → re-open via `post.open { postId }`
6. On `suggest.result` → add to suggestions store
7. On `suggest.removed` → remove from suggestions store

**Events sent by client**:
- `post.open` — open/reopen session
- `post.update` — debounced content update
- `post.listByAuthor` — request author's post list
- `post.get` — request post detail
- `suggest.spellcheck` — trigger spellcheck
- `suggest.rewrite` — trigger rewrite for selection
- `suggest.continue` — trigger continue at cursor
- `suggest.apply` — accept or reject suggestion

**Events received from server**:
- `post.snapshot` — initial post content + version
- `post.ack` — version confirmation after update
- `post.list` — author post list response
- `post.detail` — full post detail response
- `suggest.loading` — AI loading status (`start` / `done` / `error`)
- `suggest.result` — suggestion result
- `suggest.removed` — suggestion removed
- `error` — error with optional `code` (e.g. `VERSION_CONFLICT`)

---

## Editor Hotkeys

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+Shift+E` | Spellcheck |
| `Cmd/Ctrl+Shift+R` | Rewrite selected text |
| `Cmd/Ctrl+Shift+→` | Open "Continue with…" intent menu |
| `Cmd/Ctrl+Enter` | Accept active suggestion |
| `Esc` | Reject active suggestion / close menus |

Intent options for "Continue": `summary`, `example`, `argument`, `conclusion`.

---

## State (Zustand Store)

Key slices in `src/store/editorStore.ts`:

| Field | Description |
|---|---|
| `wsConnected` | WebSocket connection status |
| `postId` | Current open post ID |
| `currentVersion` | Tracked document version |
| `content` | Tiptap JSON doc |
| `plainText` | Plain text of the document |
| `suggestions` | `Map<id, SuggestionResult>` |
| `activeSuggestionId` | Currently selected suggestion |
| `aiLoadingByType` | `idle` / `loading` / `error` per suggestion type |
| `authorPosts` | Sidebar post list (items, total, loading) |
| `currentPost` | Full current post data |
| `viewMode` | `desktop` \| `mobile` (persisted to localStorage) |
| `toasts` | Toast notification queue |

---

## Environment Variables

```env
VITE_WS_URL=ws://localhost:8080       # WebSocket backend
VITE_WORKSPACE_ID=default-workspace   # Default workspace
VITE_AUTHOR_USER_ID=default-user      # Default author user
VITE_POST_LIST_LIMIT=20              # Posts per page
GEMINI_API_KEY=...                    # Gemini AI (injected by AI Studio)
```

---

## Dev Commands

```bash
npm run dev      # Vite dev server on port 3000 (host 0.0.0.0)
npm run build    # Production build → dist/
npm run lint     # TypeScript type check (tsc --noEmit)
npm run preview  # Preview production build
npm run clean    # Remove dist/
```

---

## Codex CLI Integration

Use `codex` (OpenAI Codex CLI) for tasks that benefit from a second agent with full shell access working in parallel or isolation:

**When to reach for `codex`**:
- Large-scale refactors across many files where context pollution is a concern
- Generating boilerplate (new components, hooks, store slices) from a tight spec
- Running test suites, linting, or build checks in a sandboxed pass
- Parallel investigation: while Claude reasons about architecture, Codex can scan/patch code

**How to invoke** (from project root):
```bash
codex "task description in plain English"
# or with a full prompt file:
codex --prompt tasks/todo.md
```

**Handoff pattern**:
1. Write a precise spec into `tasks/todo.md` or a temp file
2. Run `codex` with that spec as the prompt
3. Review the diff before committing
4. Update `tasks/lessons.md` with anything notable

---

## Workflow Orchestration

### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

---

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

---

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
