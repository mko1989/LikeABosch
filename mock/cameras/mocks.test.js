// Tests for mock PTZ camera servers.
// Run: node --test mock/cameras/mocks.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { createSocket } from 'node:dgram';
import { createConnection } from 'node:net';
import { createMockViscaCamera } from './visca.js';
import { createMockPanasonicCamera } from './panasonic.js';
import { createMockOnvifCamera } from './onvif.js';

const TIMEOUT = 5000;

// Helper: send UDP and wait for reply
const sendUdp = (host, port, data) => {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('UDP timeout'));
    }, TIMEOUT);

    socket.on('message', (msg) => {
      clearTimeout(timeout);
      socket.close();
      resolve(msg);
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      socket.close();
      reject(err);
    });

    socket.send(data, 0, data.length, port, host);
  });
};

// Helper: send TCP and wait for reply
const sendTcp = (host, port, data) => {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('TCP timeout'));
    }, TIMEOUT);
    let response = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      response = Buffer.concat([response, chunk]);
    });

    socket.on('end', () => {
      clearTimeout(timeout);
      resolve(response);
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    socket.write(data);
    socket.end();
  });
};

// Helper: build VISCA Sony header
const buildViscaHeader = (payloadType, payload, sequenceNumber) => {
  const header = Buffer.alloc(8);
  header.writeUInt16BE(payloadType, 0);
  header.writeUInt16BE(payload.length, 2);
  header.writeUInt32BE(sequenceNumber, 4);
  return Buffer.concat([header, payload]);
};

test('VISCA Sony UDP: reset sequence and preset recall', async (t) => {
  const mock = await createMockViscaCamera({ framing: 'sony', transport: 'udp' });

  // Reset sequence
  const resetCmd = buildViscaHeader(0x0200, Buffer.from([0x01]), 0);
  const resetReply = await sendUdp('127.0.0.1', mock.port, resetCmd);
  const resetPayloadType = resetReply.readUInt16BE(0);
  const resetPayload = resetReply.slice(8);
  assert.strictEqual(resetPayloadType, 0x0201);
  assert.deepStrictEqual(resetPayload, Buffer.from([0x01]));

  // Preset recall #R00 (preset 0)
  const presetCmd = Buffer.from([0x81, 0x01, 0x04, 0x3f, 0x02, 0x00, 0xff]);
  const presetMsg = buildViscaHeader(0x0100, presetCmd, 1);
  const presetReply = await sendUdp('127.0.0.1', mock.port, presetMsg);

  // Should get combined reply with ACK and Completion
  // Parse first message (ACK)
  const payloadType1 = presetReply.readUInt16BE(0);
  const length1 = presetReply.readUInt16BE(2);
  const seq1 = presetReply.readUInt32BE(4);
  const ack = presetReply.slice(8, 8 + length1);
  assert.strictEqual(payloadType1, 0x0111);
  assert.deepStrictEqual(ack, Buffer.from([0x90, 0x41, 0xff]));

  // Parse second message (Completion)
  const offset2 = 8 + length1;
  if (presetReply.length >= offset2 + 8) {
    const payloadType2 = presetReply.readUInt16BE(offset2);
    const length2 = presetReply.readUInt16BE(offset2 + 2);
    const completion = presetReply.slice(offset2 + 8, offset2 + 8 + length2);
    assert.strictEqual(payloadType2, 0x0111);
    assert.deepStrictEqual(completion, Buffer.from([0x90, 0x51, 0xff]));
  }

  // State should show preset 0 recalled
  assert.strictEqual(mock.state.currentPreset, 0);

  await mock.close();
});

test('VISCA Sony UDP: power inquiry', async (t) => {
  const mock = await createMockViscaCamera({ framing: 'sony', transport: 'udp' });

  // Power inquiry
  const powerCmd = Buffer.from([0x81, 0x09, 0x04, 0x00, 0xff]);
  const powerMsg = buildViscaHeader(0x0110, powerCmd, 5);
  const powerReply = await sendUdp('127.0.0.1', mock.port, powerMsg);

  // Should get reply with payload 90 50 02 FF
  const payload = powerReply.slice(8);
  assert.deepStrictEqual(payload, Buffer.from([0x90, 0x50, 0x02, 0xff]));

  await mock.close();
});

test('VISCA raw TCP: two commands in one chunk', async (t) => {
  const mock = await createMockViscaCamera({ framing: 'raw', transport: 'tcp' });

  // Send two commands in one TCP chunk (separated by 0xFF)
  const cmd1 = Buffer.from([0x81, 0x01, 0x04, 0x3f, 0x01, 0x05, 0xff]); // preset store 5
  const cmd2 = Buffer.from([0x81, 0x09, 0x04, 0x00, 0xff]); // power inquiry
  const combined = Buffer.concat([cmd1, cmd2]);
  const reply = await sendTcp('127.0.0.1', mock.port, combined);

  // Should get two replies: completion for preset, power response
  // reply should contain 90 51 FF (completion) and 90 50 02 FF (power on)
  assert(reply.includes(0x90));
  assert(reply.includes(0x51)); // completion
  assert(reply.includes(0x50)); // power response
  assert(reply.includes(0x02)); // power on

  // State should show preset 5 stored
  assert(mock.state.presets.has(5));

  await mock.close();
});

test('VISCA: failNext test helper', async (t) => {
  const mock = await createMockViscaCamera({ framing: 'sony', transport: 'udp' });

  mock.failNext(0x41); // error code 0x41
  const presetCmd = Buffer.from([0x81, 0x01, 0x04, 0x3f, 0x02, 0x00, 0xff]);
  const presetMsg = buildViscaHeader(0x0100, presetCmd, 1);
  const reply = await sendUdp('127.0.0.1', mock.port, presetMsg);

  // Should get error reply with proper header
  const payloadType = reply.readUInt16BE(0);
  const length = reply.readUInt16BE(2);
  const payload = reply.slice(8, 8 + length);
  assert.strictEqual(payloadType, 0x0111);
  assert.deepStrictEqual(payload, Buffer.from([0x90, 0x60, 0x41, 0xff]));

  await mock.close();
});

test('Panasonic: preset recall and store with auth', async (t) => {
  const mock = await createMockPanasonicCamera({
    username: 'admin',
    password: 'password123',
  });

  // Try without auth
  let response = await fetch(`http://127.0.0.1:${mock.port}/cgi-bin/aw_ptz?cmd=%23R00&res=1`);
  assert.strictEqual(response.status, 401);

  // Recall preset 1 (command #R00)
  const auth = Buffer.from('admin:password123').toString('base64');
  response = await fetch(`http://127.0.0.1:${mock.port}/cgi-bin/aw_ptz?cmd=%23R00&res=1`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  assert.strictEqual(response.status, 200);
  const text = await response.text();
  assert.strictEqual(text, 's00');
  assert.strictEqual(mock.state.currentPreset, 1); // 1-based

  // Store preset 5 (command #M04)
  response = await fetch(`http://127.0.0.1:${mock.port}/cgi-bin/aw_ptz?cmd=%23M04&res=1`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  assert.strictEqual(response.status, 200);
  assert(mock.state.presets.has(5)); // 0-based in command + 1 = 5

  await mock.close();
});

test('Panasonic: power query', async (t) => {
  const mock = await createMockPanasonicCamera();

  const response = await fetch(`http://127.0.0.1:${mock.port}/cgi-bin/aw_ptz?cmd=%23O&res=1`);
  assert.strictEqual(response.status, 200);
  const text = await response.text();
  assert.strictEqual(text, 'p1');

  await mock.close();
});

test('ONVIF: GetProfiles', async (t) => {
  const mock = await createMockOnvifCamera();

  const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <s:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>admin</wsse:Username>
        <wsse:Nonce>ASNFZ4mrze8=</wsse:Nonce>
        <wsu:Created>2025-10-03T12:00:00Z</wsu:Created>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">BaIOYB0IV0UrHpJASOZh5MCzHX4=</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </s:Header>
  <s:Body>
    <trt:GetProfiles/>
  </s:Body>
</s:Envelope>`;

  const response = await fetch(`http://127.0.0.1:${mock.port}/onvif/media_service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
    body: soapRequest,
  });

  assert.strictEqual(response.status, 200);
  const text = await response.text();
  assert(text.includes('Profile_1'));
  assert(text.includes('GetProfilesResponse'));
  assert.deepStrictEqual(mock.state.commands, ['GetProfiles']);

  await mock.close();
});

test('ONVIF: wrong password returns Fault', async (t) => {
  const mock = await createMockOnvifCamera();

  const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <s:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>admin</wsse:Username>
        <wsse:Nonce>ASNFZ4mrze8=</wsse:Nonce>
        <wsu:Created>2025-10-03T12:00:00Z</wsu:Created>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">WRONGDIGEST</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </s:Header>
  <s:Body>
    <tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>
  </s:Body>
</s:Envelope>`;

  const response = await fetch(`http://127.0.0.1:${mock.port}/onvif/device_service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
    body: soapRequest,
  });

  assert.strictEqual(response.status, 400);
  const text = await response.text();
  assert(text.includes('Fault'));
  assert(text.includes('NotAuthorized'));

  await mock.close();
});

test('ONVIF: SetPreset creates new token', async (t) => {
  const mock = await createMockOnvifCamera();

  const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <s:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>admin</wsse:Username>
        <wsse:Nonce>ASNFZ4mrze8=</wsse:Nonce>
        <wsu:Created>2025-10-03T12:00:00Z</wsu:Created>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">BaIOYB0IV0UrHpJASOZh5MCzHX4=</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </s:Header>
  <s:Body>
    <tptz:SetPreset>
      <tptz:ProfileToken>Profile_1</tptz:ProfileToken>
      <tptz:PresetName>My Preset</tptz:PresetName>
    </tptz:SetPreset>
  </s:Body>
</s:Envelope>`;

  const response = await fetch(`http://127.0.0.1:${mock.port}/onvif/ptz_service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
    body: soapRequest,
  });

  assert.strictEqual(response.status, 200);
  const text = await response.text();
  assert(text.includes('PresetToken'));
  assert(text.includes('3')); // should be token "3"
  assert(mock.state.presets.has('3'));
  assert.strictEqual(mock.state.presets.get('3'), 'My Preset');

  await mock.close();
});

test('ONVIF: GotoPreset with unknown token returns Fault', async (t) => {
  const mock = await createMockOnvifCamera();

  const soapRequest = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <s:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>admin</wsse:Username>
        <wsse:Nonce>ASNFZ4mrze8=</wsse:Nonce>
        <wsu:Created>2025-10-03T12:00:00Z</wsu:Created>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">BaIOYB0IV0UrHpJASOZh5MCzHX4=</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </s:Header>
  <s:Body>
    <tptz:GotoPreset>
      <tptz:ProfileToken>Profile_1</tptz:ProfileToken>
      <tptz:PresetToken>999</tptz:PresetToken>
    </tptz:GotoPreset>
  </s:Body>
</s:Envelope>`;

  const response = await fetch(`http://127.0.0.1:${mock.port}/onvif/ptz_service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
    body: soapRequest,
  });

  assert.strictEqual(response.status, 500);
  const text = await response.text();
  assert(text.includes('Fault'));
  assert(text.includes('NoToken'));

  await mock.close();
});
