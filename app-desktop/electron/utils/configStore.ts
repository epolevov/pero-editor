import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

interface AppConfig {
  encryptionKey?: string
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'app-config.json')
}

export function getOrCreateEncryptionKey(): string {
  const configPath = getConfigPath()
  let config: AppConfig = {}

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as AppConfig
    } catch {
      config = {}
    }
  }

  if (!config.encryptionKey) {
    config.encryptionKey = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
  }

  return config.encryptionKey
}
