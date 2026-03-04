import { contextBridge, ipcRenderer } from 'electron'

// ws-url is passed via additionalArguments in main.ts
const wsUrlArg = process.argv.find((arg) => arg.startsWith('--ws-url='))
const wsUrl = wsUrlArg ? wsUrlArg.replace('--ws-url=', '') : 'ws://127.0.0.1:18080'

contextBridge.exposeInMainWorld('electronAPI', {
  wsUrl,
  onFullscreenChange: (cb: (isFullscreen: boolean) => void) => {
    ipcRenderer.on('fullscreen-change', (_event, value: boolean) => cb(value))
  },
})
