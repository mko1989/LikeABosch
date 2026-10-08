// Mock Sony VISCA over IP and raw VISCA camera server.
import { createSocket } from 'node:dgram';
import { createServer } from 'node:net';
import { Buffer } from 'node:buffer';

/**
 * @param {object} [options]
 * @param {'udp' | 'tcp'} [options.transport='udp']
 * @param {'sony' | 'raw'} [options.framing='sony']
 * @param {number} [options.port=0]
 * @param {string} [options.host='127.0.0.1']
 */
export async function createMockViscaCamera(options = {}) {
  const {
    transport = 'udp',
    framing = 'sony',
    port = 0,
    host = '127.0.0.1',
  } = options;

  const state = {
    currentPreset: null,
    presets: new Set(),
    moving: { pan: null, tilt: null, zoom: null },
    commands: [], // array of hex strings of VISCA payloads
  };

  let actualPort = port;
  let nextErrorCode = null;

  const failNext = (errorCode) => {
    nextErrorCode = errorCode;
  };

  // Helper: create Sony framing header for a VISCA reply
  const createHeader = (payloadType, payload, sequenceNumber) => {
    const header = Buffer.alloc(8);
    header.writeUInt16BE(payloadType, 0); // payload type
    header.writeUInt16BE(payload.length, 2); // length
    header.writeUInt32BE(sequenceNumber, 4); // sequence
    return Buffer.concat([header, payload]);
  };

  // Helper: parse Sony header and return { payloadType, payload, sequenceNumber }
  const parseViscaOverIp = (data) => {
    if (data.length < 8) return null;
    const payloadType = data.readUInt16BE(0);
    const length = data.readUInt16BE(2);
    const sequenceNumber = data.readUInt32BE(4);
    if (data.length < 8 + length) return null;
    const payload = data.slice(8, 8 + length);
    return { payloadType, payload, sequenceNumber, consumed: 8 + length };
  };

  // Send reply with Sony framing (type 0x0111 = VISCA reply)
  const replyViscaSony = (viscaBytes, sequenceNumber, socket, remoteInfo) => {
    const payload = viscaBytes;
    const reply = createHeader(0x0111, payload, sequenceNumber);
    if (transport === 'udp') {
      socket.send(reply, 0, reply.length, remoteInfo.port, remoteInfo.address);
    } else if (transport === 'tcp') {
      remoteInfo.write(reply);
    }
  };

  // Send reply with raw VISCA (plain bytes)
  const replyViscaRaw = (viscaBytes, socket, remoteInfo) => {
    if (transport === 'udp') {
      socket.send(viscaBytes, 0, viscaBytes.length, remoteInfo.port, remoteInfo.address);
    } else if (transport === 'tcp') {
      remoteInfo.write(viscaBytes);
    }
  };

  // Handle VISCA command; state may be modified
  const handleViscaCommand = (commandBytes) => {
    const hex = commandBytes.toString('hex');
    state.commands.push(hex);

    // Preset recall: 81 01 04 3F 02 pp FF
    if (commandBytes[0] === 0x81 && commandBytes[1] === 0x01 && commandBytes[2] === 0x04 &&
        commandBytes[3] === 0x3f && commandBytes[4] === 0x02 && commandBytes[commandBytes.length - 1] === 0xff) {
      const preset = commandBytes[5];
      state.currentPreset = preset;
      return Buffer.from([0x90, 0x51, 0xff]); // completion
    }

    // Preset store: 81 01 04 3F 01 pp FF
    if (commandBytes[0] === 0x81 && commandBytes[1] === 0x01 && commandBytes[2] === 0x04 &&
        commandBytes[3] === 0x3f && commandBytes[4] === 0x01 && commandBytes[commandBytes.length - 1] === 0xff) {
      const preset = commandBytes[5];
      state.presets.add(preset);
      return Buffer.from([0x90, 0x51, 0xff]); // completion
    }

    // Pan/tilt drive: 81 01 06 01 VV WW XX YY FF
    if (commandBytes[0] === 0x81 && commandBytes[1] === 0x01 && commandBytes[2] === 0x06 &&
        commandBytes[3] === 0x01 && commandBytes[commandBytes.length - 1] === 0xff) {
      const xx = commandBytes[6];
      const yy = commandBytes[7];
      // XX: 01=left, 02=right, 03=stop
      // YY: 01=up, 02=down, 03=stop
      state.moving.pan = xx === 0x01 ? 'left' : xx === 0x02 ? 'right' : 'stop';
      state.moving.tilt = yy === 0x01 ? 'up' : yy === 0x02 ? 'down' : 'stop';
      return Buffer.from([0x90, 0x51, 0xff]); // completion
    }

    // Zoom: 81 01 04 07 xx FF
    if (commandBytes[0] === 0x81 && commandBytes[1] === 0x01 && commandBytes[2] === 0x04 &&
        commandBytes[3] === 0x07 && commandBytes[commandBytes.length - 1] === 0xff) {
      const xx = commandBytes[4];
      // 2p = tele, 3p = wide, 00 = stop
      state.moving.zoom = xx === 0x00 ? 'stop' : (xx & 0xf0) === 0x20 ? 'tele' : (xx & 0xf0) === 0x30 ? 'wide' : 'stop';
      return Buffer.from([0x90, 0x51, 0xff]); // completion
    }

    // Power inquiry: 81 09 04 00 FF
    if (commandBytes[0] === 0x81 && commandBytes[1] === 0x09 && commandBytes[2] === 0x04 &&
        commandBytes[3] === 0x00 && commandBytes[commandBytes.length - 1] === 0xff) {
      return Buffer.from([0x90, 0x50, 0x02, 0xff]); // on
    }

    // Unknown command -> syntax error
    return Buffer.from([0x90, 0x60, 0x02, 0xff]);
  };

  if (transport === 'udp') {
    const socket = createSocket('udp4');
    await new Promise((resolve, reject) => {
      socket.bind(port, host, () => {
        actualPort = socket.address().port;
        resolve();
      });
      socket.on('error', reject);
    });

    socket.on('message', (msg, remoteInfo) => {
      if (framing === 'sony') {
        let offset = 0;
        while (offset < msg.length) {
          const parsed = parseViscaOverIp(msg.slice(offset));
          if (!parsed) break;

          const { payloadType, payload, sequenceNumber } = parsed;

          if (payloadType === 0x0200) {
            // Control command reset sequence - reply with type 0x0201
            const resetReply = Buffer.from([0x01]);
            const resetMsg = createHeader(0x0201, resetReply, sequenceNumber);
            socket.send(resetMsg, 0, resetMsg.length, remoteInfo.port, remoteInfo.address);
          } else if (payloadType === 0x0100) {
            // VISCA command: check for test error first, then send ACK and Completion
            if (nextErrorCode !== null) {
              const errorCode = nextErrorCode;
              nextErrorCode = null;
              const errorReply = Buffer.from([0x90, 0x60, errorCode, 0xff]);
              const errorMsg = createHeader(0x0111, errorReply, sequenceNumber);
              socket.send(errorMsg, 0, errorMsg.length, remoteInfo.port, remoteInfo.address);
            } else {
              const ack = Buffer.from([0x90, 0x41, 0xff]);
              const completion = handleViscaCommand(payload);
              const ackMsg = createHeader(0x0111, ack, sequenceNumber);
              const completionMsg = createHeader(0x0111, completion, sequenceNumber);
              const combined = Buffer.concat([ackMsg, completionMsg]);
              socket.send(combined, 0, combined.length, remoteInfo.port, remoteInfo.address);
            }
          } else if (payloadType === 0x0110) {
            // VISCA inquiry
            const reply = handleViscaCommand(payload);
            replyViscaSony(reply, sequenceNumber, socket, remoteInfo);
          }

          offset += parsed.consumed;
        }
      } else {
        // raw framing: plain VISCA bytes; like a real camera: ACK then Completion for commands (0x01),
        // a single reply for inquiries (0x09); honour failNext (fixed by Claude Opus in WO-036 review)
        const command = msg;
        if (command[1] === 0x01 && nextErrorCode !== null) {
          const errorCode = nextErrorCode;
          nextErrorCode = null;
          replyViscaRaw(Buffer.from([0x90, 0x60, errorCode, 0xff]), socket, remoteInfo);
        } else {
          const reply = handleViscaCommand(command);
          if (command[1] === 0x01 && reply[1] === 0x51) replyViscaRaw(Buffer.from([0x90, 0x41, 0xff]), socket, remoteInfo);
          replyViscaRaw(reply, socket, remoteInfo);
        }
      }
    });

    return {
      port: actualPort,
      transport,
      framing,
      state,
      failNext,
      async close() {
        socket.close();
      },
    };
  } else if (transport === 'tcp') {
    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (framing === 'sony') {
          let offset = 0;
          while (offset < buffer.length) {
            const parsed = parseViscaOverIp(buffer.slice(offset));
            if (!parsed) break;

            const { payloadType, payload, sequenceNumber } = parsed;

            if (payloadType === 0x0200) {
              // Control command reset sequence - reply with type 0x0201
              const resetReply = Buffer.from([0x01]);
              const resetMsg = createHeader(0x0201, resetReply, sequenceNumber);
              socket.write(resetMsg);
            } else if (payloadType === 0x0100) {
              // VISCA command: check for test error first, then send ACK and Completion
              if (nextErrorCode !== null) {
                const errorCode = nextErrorCode;
                nextErrorCode = null;
                const errorReply = Buffer.from([0x90, 0x60, errorCode, 0xff]);
                const errorMsg = createHeader(0x0111, errorReply, sequenceNumber);
                socket.write(errorMsg);
              } else {
                const ack = Buffer.from([0x90, 0x41, 0xff]);
                const completion = handleViscaCommand(payload);
                const ackMsg = createHeader(0x0111, ack, sequenceNumber);
                const completionMsg = createHeader(0x0111, completion, sequenceNumber);
                socket.write(Buffer.concat([ackMsg, completionMsg]));
              }
            } else if (payloadType === 0x0110) {
              // VISCA inquiry
              const reply = handleViscaCommand(payload);
              replyViscaSony(reply, sequenceNumber, socket, socket);
            }

            offset += parsed.consumed;
          }
          buffer = buffer.slice(offset);
        } else {
          // raw framing: split on 0xFF
          while (buffer.length > 0) {
            const ffIndex = buffer.indexOf(0xff);
            if (ffIndex === -1) break;
            const command = buffer.slice(0, ffIndex + 1);
            if (command[1] === 0x01 && nextErrorCode !== null) {
              const errorCode = nextErrorCode;
              nextErrorCode = null;
              replyViscaRaw(Buffer.from([0x90, 0x60, errorCode, 0xff]), socket, socket);
            } else {
              const reply = handleViscaCommand(command);
              if (command[1] === 0x01 && reply[1] === 0x51) replyViscaRaw(Buffer.from([0x90, 0x41, 0xff]), socket, socket);
              replyViscaRaw(reply, socket, socket);
            }
            buffer = buffer.slice(ffIndex + 1);
          }
        }
      });

      socket.on('error', () => {
        // Ignore client errors
      });
    });

    await new Promise((resolve, reject) => {
      server.listen(port, host, () => {
        actualPort = server.address().port;
        resolve();
      });
      server.on('error', reject);
    });

    return {
      port: actualPort,
      transport,
      framing,
      state,
      failNext,
      async close() {
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(() => resolve()));
      },
    };
  }
}
