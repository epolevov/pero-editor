interface Window {
  electronAPI?: {
    wsUrl: string
    onFullscreenChange?: (cb: (isFullscreen: boolean) => void) => void
  }
}
