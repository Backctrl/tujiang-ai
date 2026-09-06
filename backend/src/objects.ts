import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from './errors.js';

// Local content-addressed object storage for development; the DB retains evidence text and locator.
export class LocalObjects {
  constructor(private directory: string) {}
  async put(text: string) {
    const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
    const objectKey = `${sha256}.txt`;
    await mkdir(this.directory, { recursive: true });
    try { await writeFile(join(this.directory, objectKey), text, { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    return { sha256, objectKey };
  }
  async putBinary(bytes: Buffer) {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const objectKey = `${sha256}.bin`;
    await mkdir(this.directory, { recursive: true });
    const staged = join(this.directory, `${sha256}.${randomUUID()}.tmp`);
    try {
      await writeFile(staged, bytes, { flag: 'wx' });
      try { await link(staged, join(this.directory, objectKey)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await this.readBinary(objectKey, bytes.length);
      }
    } finally { await unlink(staged).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
    return { sha256, objectKey };
  }
  async readBinary(objectKey: string, expectedSize: number): Promise<Buffer> {
    if (!/^[a-f0-9]{64}\.bin$/.test(objectKey)) throw new AppError('INVALID_SOURCE_OBJECT_KEY', 409);
    let bytes: Buffer;
    try {
      const path = join(this.directory, objectKey);
      const entry = await stat(path);
      if (!entry.isFile() || entry.size !== expectedSize) throw new AppError('SOURCE_FILE_INTEGRITY_FAILED', 409);
      bytes = await readFile(path);
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('SOURCE_FILE_MISSING', 409);
      throw error;
    }
    if (bytes.length !== expectedSize || createHash('sha256').update(bytes).digest('hex') !== objectKey.slice(0, -4))
      throw new AppError('SOURCE_FILE_INTEGRITY_FAILED', 409);
    return bytes;
  }
}
