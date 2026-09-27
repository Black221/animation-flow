// API keys are sealed with AES-256-GCM before they reach the database: "v1.<base64 iv | tag | ciphertext>".
// The key comes from APP_ENCRYPTION_KEY; a stolen database dump alone reveals nothing. Keys are opened only at the
// moment a provider is called, never sent back to the browser.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SecretBox { seal(plain: string): string; open(sealed: string): string }

export function secretBox(key: Buffer): SecretBox {
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes');
  return {
    seal(plain) {
      const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return 'v1.' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
    },
    open(sealed) {
      if (!sealed.startsWith('v1.')) throw new Error('unknown secret format');
      const raw = Buffer.from(sealed.slice(3), 'base64'), d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    },
  };
}
