import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import * as path from 'path'
import { findFreePort } from './utils/portFinder'
import { getOrCreateEncryptionKey } from './utils/configStore'
import { runMigrations } from './utils/prismaRunner'
import * as backendRunner from './utils/backendRunner'

log.transports.file.level = 'info'
autoUpdater.logger = log

let mainWindow: BrowserWindow | null = null
let isStarting = false

async function createWindow(wsPort: number): Promise<void> {
  const preloadPath = app.isPackaged
    ? path.join(__dirname, '../preload/preload.js')
    : path.join(__dirname, '../dist/preload/preload.js')

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Pero Editor',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--ws-url=ws://127.0.0.1:${wsPort}`],
    },
  })

  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('fullscreen-change', true))
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('fullscreen-change', false))

  await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools()
  }
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version)
  })

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Обновление готово',
      message: `Версия ${info.version} загружена. Перезапустить приложение?`,
      buttons: ['Перезапустить', 'Позже'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
  })

  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err)
  })
}

async function main(): Promise<void> {
  if (isStarting) return
  isStarting = true

  const wsPort = await findFreePort()
  log.info(`Selected port: ${wsPort}`)

  const encryptionKey = getOrCreateEncryptionKey()

  const dbUrl = `file:${path.join(app.getPath('userData'), 'pero-editor.db')}`

  runMigrations(dbUrl)

  await backendRunner.start({ port: wsPort, dbUrl, encryptionKey })

  await createWindow(wsPort)

  setupAutoUpdater()
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    log.warn('Update check failed:', err)
  })
}

app.whenReady().then(() => {
  main().catch((err) => {
    log.error('Fatal startup error:', err)
    dialog.showErrorBox('Startup Error', String(err))
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      main().catch(log.error)
    }
  })
})

app.on('before-quit', () => {
  backendRunner.stop().catch(log.error)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
