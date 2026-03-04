import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  try {
    const maybeBase64 = Buffer.from(trimmed, 'base64');
    if (maybeBase64.length === KEY_BYTES) {
      return maybeBase64;
    }
  } catch {
    // no-op
  }

  const utf8 = Buffer.from(trimmed, 'utf8');
  if (utf8.length === KEY_BYTES) {
    return utf8;
  }

  throw new Error(
    'AI_SECRETS_ENCRYPTION_KEY must be 32 bytes (hex/base64/utf8).',
  );
}

function requireEncryptionKey(
  env: NodeJS.ProcessEnv = process.env,
): Buffer {
  const value = env.AI_SECRETS_ENCRYPTION_KEY;
  if (!value?.trim()) {
    throw new Error(
      'AI_SECRETS_ENCRYPTION_KEY is required to store OpenRouter API keys from UI.',
    );
  }
  return parseEncryptionKey(value);
}

export function encryptSecret(
  plaintext: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = requireEncryptionKey(env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(
  payload: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = requireEncryptionKey(env);
  const parts = payload.split(':');

  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Encrypted secret format is invalid.');
  }

  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const encrypted = Buffer.from(parts[3], 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
