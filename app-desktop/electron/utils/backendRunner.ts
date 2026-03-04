import { spawn, ChildProcess } from 'child_process'
import * as net from 'net'
import * as path from 'path'
import { app } from 'electron'
import log from 'electron-log'

interface BackendOptions {
  port: number
  dbUrl: string
  encryptionKey: string
}

let child: ChildProcess | null = null

function findNodeBinary(): string {
  // Use the node binary from PATH (not Electron's execPath)
  const candidates = [
    process.env.NODE_BINARY,                   // explicit override
    '/usr/local/bin/node',
    '/usr/bin/node',
    '/opt/homebrew/bin/node',
  ].filter(Boolean) as string[]

  const { execFileSync } = require('child_process') as typeof import('child_process')
  try {
    const p = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
    if (p) candidates.unshift(p)
  } catch {
    // ignore
  }

  const fs = require('fs') as typeof import('fs')
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return 'node' // fallback: rely on PATH
}

function resolvePackagedNode(): { bin: string; env: NodeJS.ProcessEnv } {
  const fs = require('fs') as typeof import('fs')
  const bundledNode = path.join(process.resourcesPath, 'node')
  if (fs.existsSync(bundledNode)) {
    return { bin: bundledNode, env: {} }
  }
  return {
    bin: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    function attempt() {
      if (Date.now() > deadline) {
        reject(new Error(`Backend port ${port} did not open within ${timeoutMs / 1000}s`))
        return
      }
      const sock = net.createConnection({ host: '127.0.0.1', port })
      sock.once('connect', () => {
        sock.destroy()
        resolve()
      })
      sock.once('error', () => {
        sock.destroy()
        setTimeout(attempt, 200)
      })
    }
    attempt()
  })
}

export function start(options: BackendOptions): Promise<void> {
  const backendPath = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'dist', 'index.js')
    : path.join(__dirname, '../../../app-backend/dist/index.js')

  const nodeRuntime = app.isPackaged
    ? resolvePackagedNode()
    : { bin: findNodeBinary(), env: {} }

  log.info(`Starting backend: ${nodeRuntime.bin} ${backendPath}`)

  child = spawn(nodeRuntime.bin, [backendPath], {
    env: {
      ...process.env,
      ...nodeRuntime.env,
      NODE_ENV: 'production',
      DATABASE_URL: options.dbUrl,
      WS_PORT: String(options.port),
      AI_SECRETS_ENCRYPTION_KEY: options.encryptionKey,
      MOLECULER_NAMESPACE: 'text-assistant',
      LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout?.on('data', (d: Buffer) => log.info('[backend]', d.toString().trimEnd()))
  child.stderr?.on('data', (d: Buffer) => log.warn('[backend]', d.toString().trimEnd()))

  child.on('error', (err) => log.error('Backend spawn error:', err))
  child.on('exit', (code) => {
    log.warn(`Backend exited with code ${code}`)
    child = null
  })

  return waitForPort(options.port, 30_000)
}

export function stop(): Promise<void> {
  return new Promise((resolve) => {
    if (!child) {
      resolve()
      return
    }

    const timeout = setTimeout(() => {
      child?.kill('SIGKILL')
      resolve()
    }, 5_000)

    child.once('exit', () => {
      clearTimeout(timeout)
      child = null
      resolve()
    })

    child.kill('SIGTERM')
  })
}
