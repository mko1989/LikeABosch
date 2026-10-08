// Mock ONVIF PTZ camera server (SOAP 1.2 with WS-Security).
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';

/**
 * @param {object} [options]
 * @param {number} [options.port=0]
 * @param {string} [options.host='127.0.0.1']
 * @param {string} [options.username='admin']
 * @param {string} [options.password='admin']
 */
export async function createMockOnvifCamera(options = {}) {
  const {
    port = 0,
    host = '127.0.0.1',
    username = 'admin',
    password = 'admin',
  } = options;

  const state = {
    currentPreset: null,
    presets: new Map([['1', 'Chair'], ['2', 'Speaker left']]),
    nextPresetToken: 3,
    moving: null, // { x, y, zoom } or null
    commands: [], // array of operation names
  };

  // Helper: extract first element name from SOAP body (handles different namespace prefixes)
  const getOperationName = (soapBody) => {
    // Look for the first non-standard element after <s:Body> or <soap:Body>
    const bodyMatch = soapBody.match(/<s:Body[^>]*>\s*<(\w+:)?(\w+)[^>]*>/);
    if (bodyMatch) return bodyMatch[2];
    return null;
  };

  // Helper: verify WS-Security UsernameToken PasswordDigest
  const verifyWsSecurityDigest = (soapBody) => {
    const nonceMatch = soapBody.match(/<wsse:Nonce[^>]*>([^<]+)<\/wsse:Nonce>/);
    const createdMatch = soapBody.match(/<wsu:Created[^>]*>([^<]+)<\/wsu:Created>/);
    const passwordMatch = soapBody.match(/<wsse:Password[^>]*Type="[^"]*PasswordDigest"[^>]*>([^<]+)<\/wsse:Password>/);

    if (!nonceMatch || !createdMatch || !passwordMatch) {
      return false;
    }

    const nonce = nonceMatch[1];
    const created = createdMatch[1];
    const passwordDigest = passwordMatch[1];

    try {
      const nonceBytes = Buffer.from(nonce, 'base64');
      const toHash = Buffer.concat([nonceBytes, Buffer.from(created), Buffer.from(password)]);
      const expectedDigest = createHash('sha1').update(toHash).digest('base64');
      return expectedDigest === passwordDigest;
    } catch (e) {
      return false;
    }
  };

  // Helper: extract tag value by local name (ignoring namespace prefix)
  const getTagValue = (xml, localName) => {
    const match = xml.match(new RegExp(`<\\w*:?${localName}[^>]*>([^<]+)<\\/\\w*:?${localName}>`));
    return match ? match[1] : null;
  };

  // Helper: build SOAP 1.2 envelope with namespaces
  const buildSoapResponse = (responseBody) => {
    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
  <s:Body>
    ${responseBody}
  </s:Body>
</s:Envelope>`;
  };

  // Build SOAP Fault
  const buildSoapFault = (reason, subcode) => {
    const body = `<s:Fault>
      <s:Code>
        <s:Value>s:Sender</s:Value>
        <s:Subcode><s:Value>${subcode}</s:Value></s:Subcode>
      </s:Code>
      <s:Reason><s:Text>${reason}</s:Text></s:Reason>
    </s:Fault>`;
    return buildSoapResponse(body);
  };

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/soap+xml')) {
      res.writeHead(400);
      res.end('Content-Type must be application/soap+xml');
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk.toString('utf8');
    }

    // Verify WS-Security digest
    if (!verifyWsSecurityDigest(body)) {
      res.writeHead(400, { 'Content-Type': 'application/soap+xml; charset=utf-8' });
      res.end(buildSoapFault('Authentication failed', 'tds:NotAuthorized'));
      return;
    }

    // Determine operation
    const operation = getOperationName(body);
    if (!operation) {
      res.writeHead(400);
      res.end('Could not determine operation');
      return;
    }

    state.commands.push(operation);

    let responseBody;

    if (operation === 'GetCapabilities') {
      responseBody = `<tds:GetCapabilitiesResponse>
        <tds:Capabilities>
          <tt:Media><tt:XAddr>http://${host}:${port}/onvif/media_service</tt:XAddr></tt:Media>
          <tt:PTZ><tt:XAddr>http://${host}:${port}/onvif/ptz_service</tt:XAddr></tt:PTZ>
        </tds:Capabilities>
      </tds:GetCapabilitiesResponse>`;
    } else if (operation === 'GetProfiles') {
      responseBody = `<trt:GetProfilesResponse>
        <trt:Profiles token="Profile_1">
          <tt:Name>Profile 1</tt:Name>
          <tt:PTZConfiguration token="PTZ_1"></tt:PTZConfiguration>
        </trt:Profiles>
      </trt:GetProfilesResponse>`;
    } else if (operation === 'GetPresets') {
      let presetXml = '';
      for (const [token, name] of state.presets) {
        presetXml += `<tptz:Preset token="${token}"><tt:Name>${name}</tt:Name></tptz:Preset>`;
      }
      responseBody = `<tptz:GetPresetsResponse>${presetXml}</tptz:GetPresetsResponse>`;
    } else if (operation === 'GotoPreset') {
      const presetToken = getTagValue(body, 'PresetToken');
      if (!state.presets.has(presetToken)) {
        const fault = buildSoapFault('Preset token does not exist', 'tptz:NoToken');
        res.writeHead(500, { 'Content-Type': 'application/soap+xml; charset=utf-8' });
        res.end(fault);
        return;
      }
      state.currentPreset = presetToken;
      responseBody = `<tptz:GotoPresetResponse></tptz:GotoPresetResponse>`;
    } else if (operation === 'SetPreset') {
      let presetToken = getTagValue(body, 'PresetToken');
      const presetName = getTagValue(body, 'PresetName');

      if (!presetToken) {
        // Create new preset
        presetToken = String(state.nextPresetToken++);
        state.presets.set(presetToken, presetName || `Preset ${presetToken}`);
      } else {
        // Update existing preset
        state.presets.set(presetToken, presetName || state.presets.get(presetToken) || `Preset ${presetToken}`);
      }

      responseBody = `<tptz:SetPresetResponse><tptz:PresetToken>${presetToken}</tptz:PresetToken></tptz:SetPresetResponse>`;
    } else if (operation === 'ContinuousMove') {
      const xMatch = body.match(/x="([^"]+)"/);
      const yMatch = body.match(/y="([^"]+)"/);
      const zMatch = body.match(/<tt:Zoom[^>]*x="([^"]+)"/);
      state.moving = {
        x: xMatch ? parseFloat(xMatch[1]) : 0,
        y: yMatch ? parseFloat(yMatch[1]) : 0,
        zoom: zMatch ? parseFloat(zMatch[1]) : 0,
      };
      responseBody = `<tptz:ContinuousMoveResponse></tptz:ContinuousMoveResponse>`;
    } else if (operation === 'Stop') {
      state.moving = null;
      responseBody = `<tptz:StopResponse></tptz:StopResponse>`;
    } else {
      res.writeHead(400);
      res.end(`Operation ${operation} not implemented`);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/soap+xml; charset=utf-8' });
    res.end(buildSoapResponse(responseBody));
  });

  await new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      resolve();
    });
    server.on('error', reject);
  });

  const actualPort = server.address().port;

  return {
    port: actualPort,
    deviceUrl: `http://${host}:${actualPort}/onvif/device_service`,
    state,
    async close() {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(() => resolve()));
    },
  };
}
