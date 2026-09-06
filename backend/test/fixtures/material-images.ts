import { deflateSync } from 'node:zlib';

/** Synthetic PNG chunks with real CRCs; no external sample assets. */
export function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return chunk;
}

/** Two valid RGBA animation frames, including a PNG-compatible default image. */
export function twoFrameApng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0); header.writeUInt32BE(1, 4);
  header[8] = 8; header[9] = 6;
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(2, 0);
  const frame = (sequence: number) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0); data.writeUInt32BE(2, 4); data.writeUInt32BE(1, 8);
    data.writeUInt16BE(1, 20); data.writeUInt16BE(10, 22);
    return pngChunk('fcTL', data);
  };
  const secondFrame = Buffer.alloc(4); secondFrame.writeUInt32BE(2, 0);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('acTL', animation), frame(0),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255, 255, 0, 0, 255]))), frame(1),
    pngChunk('fdAT', Buffer.concat([secondFrame, deflateSync(Buffer.from([0, 0, 0, 255, 255, 0, 0, 255, 255]))])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
