import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
}
