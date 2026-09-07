import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { canonical, fail, sha256 } from './authorization-contract.js';

export interface SealedArtifact {
  version: 'artifact.1'; keyId: string; nonce: string; tag: string; ciphertext: string;
  contentSha256: string; originalSha256: string; byteLength: number; redacted: boolean;
}
export interface ArtifactBinding { authorizationId: string; batchId: string | null; attemptId: string | null; kind: string;
  sourceSha256: string; metadataSha256: string }

export class ArtifactCipher {
  private readonly key: Buffer;
  private secrets: string[] = [];
  readonly keyId: string;
  constructor(encodedKey: string) {
    this.key = Buffer.from(encodedKey, 'base64');
    if (this.key.length !== 32 || this.key.toString('base64') !== encodedKey) fail('ARTIFACT_KEY_NOT_CONFIGURED');
    this.keyId = sha256(this.key);
    this.protectSecrets([encodedKey, this.key.toString('hex')]);
  }
  protectSecrets(secrets: string[]) { this.secrets = [...new Set([...this.secrets, ...secrets.filter(Boolean)])]; }
  redact(bytes: Uint8Array): { bytes: Buffer; redacted: boolean } {
    const source = Buffer.from(bytes); const chunks: Buffer[] = []; let offset = 0;
    for (let index = source.indexOf(this.key); index !== -1; index = source.indexOf(this.key, offset)) {
      chunks.push(source.subarray(offset, index), Buffer.from('[REDACTED]')); offset = index + this.key.length;
    }
    const input = chunks.length ? Buffer.concat([...chunks, source.subarray(offset)]) : source;
    let value = input.toString('utf8');
    const original = value;
    for (const secret of this.secrets) {
      for (const encoding of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]) {
        value = value.split(encoding).join('[REDACTED]');
      }
    }
    value = value.replace(/\bsk-or-v1-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
      .replace(/(authorization["']?\s*[:=]\s*["']?Bearer\s+)[^\s"',}]+/gi, '$1[REDACTED]');
    // Keep arbitrary raw bytes byte-identical when there was no textual redaction.
    return { bytes: value === original ? input : Buffer.from(value), redacted: chunks.length > 0 || value !== original };
  }
  seal(bytes: Uint8Array, binding: ArtifactBinding): SealedArtifact {
    const protectedBytes = this.redact(bytes);
    const originalSha256 = sha256(bytes); const contentSha256 = sha256(protectedBytes.bytes);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(canonical({ ...binding, originalSha256, contentSha256, version: 'artifact.1' })));
    const ciphertext = Buffer.concat([cipher.update(protectedBytes.bytes), cipher.final()]);
    return { version: 'artifact.1', keyId: this.keyId, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'), contentSha256, originalSha256, byteLength: protectedBytes.bytes.length, redacted: protectedBytes.redacted };
  }
  open(artifact: SealedArtifact, binding: ArtifactBinding): Buffer {
    if (artifact.keyId !== this.keyId || artifact.version !== 'artifact.1') fail('ARTIFACT_KEY_MISMATCH');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(artifact.nonce, 'base64'));
      decipher.setAAD(Buffer.from(canonical({ ...binding, originalSha256: artifact.originalSha256,
        contentSha256: artifact.contentSha256, version: 'artifact.1' })));
      decipher.setAuthTag(Buffer.from(artifact.tag, 'base64'));
      const bytes = Buffer.concat([decipher.update(Buffer.from(artifact.ciphertext, 'base64')), decipher.final()]);
      if (bytes.length !== artifact.byteLength || sha256(bytes) !== artifact.contentSha256) fail('ARTIFACT_INTEGRITY_FAILED');
      return this.redact(bytes).bytes;
    } catch { return fail('ARTIFACT_INTEGRITY_FAILED'); }
  }
}
