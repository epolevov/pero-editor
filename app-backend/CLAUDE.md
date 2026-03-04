# Claude Code — Workflow Instructions

## Project Context

**Stack**: Moleculer 0.14 + TypeScript strict · SQLite + Prisma · WebSocket (ws) · Zod · OpenRouter (LLM) · Jest + ts-jest

**Key files**:
- `src/services/posts.service.ts` — post lifecycle, versioning, stale suggestion marking
- `src/services/suggestions.service.ts` — create/apply (accept|reject)
- `src/services/ai.service.ts` — spellcheck/rewrite/continue + OpenRouter integration
- `src/services/api-gateway-ws.service.ts` — WS server, rooms, event broadcasting
- `src/types/index.ts` — all interfaces (WS protocol + Moleculer params)
- `src/validators/ws-messages.ts` — Zod schemas
- `prisma/schema.prisma` — data model

**Commands**:
```bash
npm run dev          # ts-node + dotenv
npm test             # jest (no DB needed — Prisma fully mocked)
npm run build        # tsc → dist/
npm run db:migrate   # prisma migrate dev
npm run db:generate  # prisma generate (after schema change)
```

**Critical invariants**:
- Version monotonicity: client proposes `currentVersion + 1`, server 409 on mismatch
- Stale suggestions marked inside `posts.update` transaction, broadcast via `post.updated`
- Single-node WS rooms: `Map<postId, Set<WebSocket>>` — swap to Redis adapter on scale-out

---

## Workflow Orchestration

### 1. Plan First
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan — don't keep pushing
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep the main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One focused task per subagent

### 3. Codex Delegation
Delegate to Codex for isolated, well-scoped tasks where output is easy to verify:
- **Good candidates**: boilerplate generation, migration files, test scaffolding, type definitions, repetitive refactors
- **Bad candidates**: tasks requiring deep context across multiple files, architectural decisions, anything touching the WS event bus or versioning logic

**How to invoke** (via Bash tool):
```bash
codex "Add a Zod schema for the WS message type `suggest.remove` in src/validators/ws-messages.ts. Follow the existing pattern in that file. Output only the changed file."
```

**Rules for Codex delegation**:
1. Scope the task to **one file** or **one concern** whenever possible
2. Tell Codex which existing file to follow as a pattern
3. Always **read and verify** Codex output before accepting — run `npm test` to confirm
4. If Codex output touches more files than expected, reject and re-scope

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake from recurring
- Review lessons at the start of each session

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Run `npm test` — all tests must pass
- Ask yourself: "Would a staff engineer approve this?"

### 6. Autonomous Bug Fixing
- Given a bug report: just fix it. No hand-holding needed.
- Use logs, errors, failing tests as the entry point
- Zero context switching required from the user

### 7. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- Skip for simple, obvious fixes — don't over-engineer

---

## Task Management
1. **Plan**: Write plan to `tasks/todo.md` with checkable items
2. **Verify**: Check in before starting implementation
3. **Track**: Mark items complete as you go
4. **Summarise**: High-level summary at each step
5. **Document**: Add review section to `tasks/todo.md`
6. **Lessons**: Update `tasks/lessons.md` after corrections

---

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Only touch what's necessary. Avoid introducing bugs.
