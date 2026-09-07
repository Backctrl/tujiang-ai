import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { canonical, fail, sha256 } from './authorization-contract.js';

export interface SealedArtifact {
  version: 'artifact.2'; keyId: string; nonce: string; tag: string; ciphertext: string;
  contentSha256: string; originalSha256: string; byteLength: number; redacted: boolean;
}
export interface ArtifactBinding { authorizationId: string; artifactId: string; batchId: string | null; attemptId: string | null; kind: string;
  sourceSha256: string; metadataSha256: string }

export class ArtifactCipher {
  private readonly key: Buffer;
  private secrets: string[] = [];
  private binarySecrets: Buffer[] = [];
  readonly keyId: string;
  constructor(encodedKey: string) {
    this.key = Buffer.from(encodedKey, 'base64');
    if (this.key.length !== 32 || this.key.toString('base64') !== encodedKey) fail('ARTIFACT_KEY_NOT_CONFIGURED');
    this.keyId = sha256(this.key);
    this.protectSecrets([encodedKey, this.key.toString('hex')]);
  }
  protectSecrets(secrets: string[]) {
    const text = new Set(this.secrets); const binary = new Map(this.binarySecrets.map(value => [value.toString('hex'), value]));
    for (const secret of secrets.filter(Boolean)) {
      const raw = Buffer.from(secret); const variants = [secret, raw.toString('base64'), raw.toString('hex')];
      const decoded = [Buffer.from(secret, 'base64'), /^[a-f0-9]+$/i.test(secret) && secret.length % 2 === 0 ? Buffer.from(secret, 'hex') : Buffer.alloc(0)];
      for (const bytes of decoded) {
        if (bytes.length < 16 || ![bytes.toString('base64'), bytes.toString('hex')].includes(secret)) continue;
        binary.set(bytes.toString('hex'), bytes); variants.push(bytes.toString('base64'), bytes.toString('hex'));
      }
      for (const value of variants) for (const encoding of [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)]) text.add(encoding);
    }
    this.secrets = [...text].sort((left, right) => right.length - left.length);
    this.binarySecrets = [...binary.values()];
  }
  redact(bytes: Uint8Array): { bytes: Buffer; redacted: boolean } {
    let input = Buffer.from(bytes); let binaryRedacted = false;
    for (const secret of this.binarySecrets) {
      const chunks: Buffer[] = []; let offset = 0;
      for (let index = input.indexOf(secret); index !== -1; index = input.indexOf(secret, offset)) {
        chunks.push(input.subarray(offset, index), Buffer.from('[REDACTED]')); offset = index + secret.length;
      }
      if (chunks.length) { input = Buffer.concat([...chunks, input.subarray(offset)]); binaryRedacted = true; }
    }
    let value = input.toString('utf8');
    const original = value;
    for (const secret of this.secrets) value = value.split(secret).join('[REDACTED]');
    value = value.replace(/\bsk-or-v1-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
      .replace(/(authorization["']?\s*[:=]\s*["']?Bearer\s+)[^\s"',}]+/gi, '$1[REDACTED]');
    // Keep arbitrary raw bytes byte-identical when there was no textual redaction.
    return { bytes: value === original ? input : Buffer.from(value), redacted: binaryRedacted || value !== original };
  }
  seal(bytes: Uint8Array, binding: ArtifactBinding): SealedArtifact {
    const protectedBytes = this.redact(bytes);
    const originalSha256 = sha256(bytes); const contentSha256 = sha256(protectedBytes.bytes);
    const byteLength = protectedBytes.bytes.length; const redacted = protectedBytes.redacted;
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(canonical({ ...binding, originalSha256, contentSha256, byteLength, redacted, version: 'artifact.2' })));
    const ciphertext = Buffer.concat([cipher.update(protectedBytes.bytes), cipher.final()]);
    return { version: 'artifact.2', keyId: this.keyId, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'), contentSha256, originalSha256, byteLength, redacted };
  }
  open(artifact: SealedArtifact, binding: ArtifactBinding): Buffer {
    try {
      // Older envelopes lack authenticated redaction metadata and cannot be silently upgraded.
      if (artifact.keyId !== this.keyId || artifact.version !== 'artifact.2' || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0 ||
          typeof artifact.redacted !== 'boolean' || artifact.redacted !== (artifact.originalSha256 !== artifact.contentSha256)) {
        fail('ARTIFACT_INTEGRITY_FAILED');
      }
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(artifact.nonce, 'base64'));
      decipher.setAAD(Buffer.from(canonical({ ...binding, originalSha256: artifact.originalSha256,
        contentSha256: artifact.contentSha256, byteLength: artifact.byteLength, redacted: artifact.redacted, version: 'artifact.2' })));
      decipher.setAuthTag(Buffer.from(artifact.tag, 'base64'));
      const bytes = Buffer.concat([decipher.update(Buffer.from(artifact.ciphertext, 'base64')), decipher.final()]);
      if (bytes.length !== artifact.byteLength || sha256(bytes) !== artifact.contentSha256) fail('ARTIFACT_INTEGRITY_FAILED');
      return this.redact(bytes).bytes;
    } catch { return fail('ARTIFACT_INTEGRITY_FAILED'); }
  }
}
