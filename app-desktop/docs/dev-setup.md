# Dev Setup

## Prerequisites

- Node.js 20+
- npm or compatible package manager

## Running in Development Mode

### Option A: Full Electron dev (all-in-one)

```bash
# 1. Build backend first (needed for backendRunner to fork)
cd ../app-backend
npm install
npm run build          # compiles src/ → dist/

# 2. Install desktop deps and launch Electron
cd ../app-desktop
npm install
npm run dev
```

`npm run dev` does:
1. Watches and rebuilds `electron/main.ts` → `dist/main/main.js`
2. Watches and rebuilds `electron/preload.ts` → `dist/preload/preload.js`
3. Launches Electron — which forks the backend and opens a BrowserWindow

In dev mode the renderer loads from the Vite dev server at `http://localhost:5173`.
Start it separately:

```bash
cd ../app-frontend
npm install
npm run dev            # serves on :5173
```

### Option B: Traditional separate processes (no Electron)

```bash
# Terminal 1 — backend
cd app-backend && npm run dev     # listens on :8080

# Terminal 2 — frontend
cd app-frontend && VITE_WS_URL=ws://localhost:8080 npm run dev
```

This workflow is unchanged from before Electron was added.

## Environment Variables (dev)

The Electron main process sets these when forking the backend:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `file:<userData>/pero-editor.db` |
| `WS_PORT` | Dynamic port 18080–18099 |
| `AI_SECRETS_ENCRYPTION_KEY` | Persisted in `<userData>/app-config.json` |
| `NODE_ENV` | `production` |

## Logs

Electron and backend logs appear in the terminal and in:
- macOS: `~/Library/Logs/Pero Editor/main.log`
