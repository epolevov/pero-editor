import { execFileSync } from 'child_process'
import * as path from 'path'
import { app } from 'electron'
import log from 'electron-log'

function findNodeBinary(): string {
  const candidates = [
    process.env.NODE_BINARY,
    '/usr/local/bin/node',
    '/usr/bin/node',
    '/opt/homebrew/bin/node',
  ].filter(Boolean) as string[]

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

  return 'node'
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

export function runMigrations(dbUrl: string): void {
  const prismaCliPath = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'node_modules', 'prisma', 'build', 'index.js')
    : path.join(__dirname, '../../../app-backend/node_modules/prisma/build/index.js')

  const schemaPath = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'prisma', 'schema.prisma')
    : path.join(__dirname, '../../../app-backend/prisma/schema.prisma')

  const nodeRuntime = app.isPackaged
    ? resolvePackagedNode()
    : { bin: findNodeBinary(), env: {} }

  // When packaged, point Prisma to the bundled engine binary so it doesn't
  // try to copy from cache into the read-only app bundle (EROFS on DMG).
  const engineEnv: NodeJS.ProcessEnv = {}
  if (app.isPackaged) {
    const engineName =
      process.arch === 'arm64'
        ? 'libquery_engine-darwin-arm64.dylib.node'
        : 'libquery_engine-darwin.dylib.node'
    engineEnv.PRISMA_QUERY_ENGINE_LIBRARY = path.join(
      process.resourcesPath,
      'backend',
      'node_modules',
      '.prisma',
      'client',
      engineName,
    )
  }

  log.info('Running prisma migrate deploy...')
  try {
    execFileSync(nodeRuntime.bin, [prismaCliPath, 'migrate', 'deploy', '--schema', schemaPath], {
      env: {
        ...process.env,
        ...nodeRuntime.env,
        ...engineEnv,
        DATABASE_URL: dbUrl,
      },
      stdio: 'pipe',
    })
    log.info('Migrations applied successfully.')
  } catch (err) {
    log.error('Failed to run migrations:', err)
    throw err
  }
}
