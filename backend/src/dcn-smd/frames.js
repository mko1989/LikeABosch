// DCN-SWSMD framing (WO-066, docs/protocol/dcn-swsmd/README.md "Framing"):
//   [Int32 LE topic][Int32 LE message length in bytes][message bytes: XML]
// The manual's C# sample decodes the message as UTF-16LE (Encoding.Unicode) while the XML declares utf-8, so the
// encoding is detected per message.

/** EnumTopic (manual p. 24) */
export const TOPICS = ['System', 'Meeting', 'Session', 'Discussion', 'Participant', 'Seat', 'Voting', 'Interpretation', 'ServiceCall', 'Booth', 'Desk', 'TestSystem'];

const HEADER = 8;
const MAX_MESSAGE = 32 * 1024 * 1024; // a full MeetingStarted of a big parliament is well below this

/**
 * Decode message bytes: BOM if present, else UTF-16LE when the second byte is 0 (ASCII '<' as UTF-16LE), else UTF-8.
 * @param {Buffer} buf
 * @returns {{ text: string, encoding: 'utf16le' | 'utf8' }}
 */
export function decodeMessage(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le'), encoding: 'utf16le' };
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), encoding: 'utf8' };
  if (buf.length >= 2 && buf[1] === 0 && buf[0] !== 0) return { text: buf.toString('utf16le'), encoding: 'utf16le' };
  return { text: buf.toString('utf8'), encoding: 'utf8' };
}

/**
 * Build one frame (mock and tests).
 * @param {number} topic
 * @param {string} xml
 * @param {'utf16le' | 'utf8'} [encoding]
 */
export function encodeFrame(topic, xml, encoding = 'utf16le') {
  const body = Buffer.from(xml, encoding);
  const header = Buffer.alloc(HEADER);
  header.writeInt32LE(topic, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** Incremental decoder: push() TCP chunks, get complete messages back. */
export class FrameDecoder {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * @param {Buffer} chunk
   * @returns {{ topic: number, topicName: string, text: string, encoding: string, bytes: number }[]}
   * @throws {Error} on an impossible length (stream out of sync): the caller should reconnect
   */
  push(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out = [];
    while (this.buffer.length >= HEADER) {
      const topic = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (length < 0 || length > MAX_MESSAGE) throw new Error(`invalid SWSMD message length ${length} (topic ${topic}): stream out of sync`);
      if (this.buffer.length < HEADER + length) break;
      const body = this.buffer.subarray(HEADER, HEADER + length);
      this.buffer = this.buffer.subarray(HEADER + length);
      const { text, encoding } = decodeMessage(Buffer.from(body));
      out.push({ topic, topicName: TOPICS[topic] ?? `Topic${topic}`, text, encoding, bytes: length });
    }
    return out;
  }
}
