# Release Process (S3 Generic Provider)

## Overview

Auto-updates use `electron-updater` with the `generic` S3 provider.
No Squirrel or Sparkle — just static files on S3.

The update flow:
1. App starts → `autoUpdater.checkForUpdatesAndNotify()`
2. electron-updater fetches `<S3_URL>/latest-mac.yml`
3. If a newer version is found, the DMG is downloaded silently in the background
4. A dialog prompts the user to restart and install

## One-time S3 Setup

1. Create an S3 bucket (e.g., `pero-editor-releases`)
2. Enable public read access (or use pre-signed URLs — not supported by generic provider)
3. Update `electron-builder.yml`:
   ```yaml
   publish:
     provider: generic
     url: "https://pero-editor-releases.s3.us-east-1.amazonaws.com/updates/"
   ```

## Releasing a New Version

### 1. Bump the version

Edit `app-desktop/package.json`:
```json
{ "version": "0.2.0" }
```

### 2. Build

```bash
cd ../app-backend && npm run build
cd ../app-desktop && npm run dist
```

### 3. Upload to S3

```bash
VERSION="0.2.0"
S3_URL="s3://pero-editor-releases/updates"

aws s3 cp "dist-electron/Pero Editor-${VERSION}.dmg" "${S3_URL}/"
aws s3 cp "dist-electron/Pero Editor-${VERSION}.dmg.blockmap" "${S3_URL}/"
aws s3 cp dist-electron/latest-mac.yml "${S3_URL}/"
```

**Important:** always upload `latest-mac.yml` last — it's the trigger that tells
running apps a new version exists.

### 4. Verify

```bash
# Check the manifest is accessible
curl https://pero-editor-releases.s3.us-east-1.amazonaws.com/updates/latest-mac.yml
```

Expected output:
```yaml
version: 0.2.0
files:
  - url: Pero Editor-0.2.0.dmg
    sha512: <hash>
    size: <bytes>
path: Pero Editor-0.2.0.dmg
sha512: <hash>
releaseDate: '2026-03-01T...'
```

## Rollback

To roll back, re-upload the previous `latest-mac.yml`:

```bash
aws s3 cp "backups/latest-mac-0.1.0.yml" "${S3_URL}/latest-mac.yml"
```

## Channels

Currently only the `stable` channel is configured.
To add a `beta` channel in the future:
- Set `channel: beta` in `electron-builder.yml`
- Upload to `s3://.../updates/beta/`
- Update `publish.url` accordingly
