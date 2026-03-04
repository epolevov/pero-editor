# Building macOS Release Artifacts

## Prerequisites

- macOS (required for `.dmg` / `.zip` targets)
- Node.js 20+
- Backend compiled (`app-backend/dist/` must exist)

## Steps

### 1. Build the backend

```bash
cd ../app-backend
npm install
npm run build
# Produces: app-backend/dist/index.js
```

### 2. Build and package the desktop app

```bash
cd ../app-desktop
npm install
npm run dist
```

`npm run dist` runs:
1. `vite build --config vite.main.config.ts` → `dist/main/main.js`
2. `vite build --config vite.preload.config.ts` → `dist/preload/preload.js`
3. `vite build --config vite.renderer.config.ts` → `dist/renderer/` (React app)
4. `electron-builder --mac` → packages everything

### Output

```
dist-electron/
├── Pero Editor-0.1.0.dmg          # Distributable installer
├── Pero Editor-0.1.0.dmg.blockmap # For delta updates
├── Pero Editor-0.1.0-arm64-mac.zip # Required by macOS auto-updater
├── Pero Editor-0.1.0-arm64-mac.zip.blockmap
├── latest-mac.yml                  # Auto-updater manifest
└── mac/
    └── Pero Editor.app/            # Unpacked app bundle
```

## App Bundle Contents

The `.app` bundle includes:
- Electron runtime
- `dist/main/main.js` — Main process
- `dist/preload/preload.js` — Preload script
- `dist/renderer/` — React frontend (served as local files)
- `resources/backend/dist/index.js` — Node.js backend
- `resources/backend/prisma/` — Prisma schema + migrations
- `resources/backend/node_modules/.prisma/` — Prisma native binaries

## Icons

Place icon files in `build/` before running `npm run dist`:
- `build/icon.icns` — macOS app icon (generate from 1024×1024 PNG using `iconutil`)
- `build/background.png` — DMG background image (540×380 px)

### Generating icon.icns

```bash
mkdir icon.iconset
sips -z 16 16   icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32   icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32   icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64   icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
cp icon.png     icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o build/icon.icns
```

## Notes

- No code signing is configured (no Apple Developer ID required)
- Build pipeline runs ad-hoc re-sign in `scripts/adhoc-sign.cjs` so ShipIt can validate update bundles
- macOS Gatekeeper will show a warning on first open — users can bypass with right-click → Open
- For internal distribution this is acceptable
