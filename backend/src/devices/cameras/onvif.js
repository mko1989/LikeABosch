// ONVIF PTZ camera driver (SOAP 1.2, WS-Security UsernameToken digest), no dependencies (WO-036, DEC-012).
// Reference: docs/protocol/cameras/README.md §3. XML is handled with small, tolerant regexes for the few elements needed.
import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../lib/errors.js';

const NS = {
  s: 'http://www.w3.org/2003/05/soap-envelope',
  tds: 'http://www.onvif.org/ver10/device/wsdl',
  trt: 'http://www.onvif.org/ver10/media/wsdl',
  tptz: 'http://www.onvif.org/ver20/ptz/wsdl',
  tt: 'http://www.onvif.org/ver10/schema',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
};
const esc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Text content of the first element with this local name (any namespace prefix). */
const text = (xml, local) => { const m = new RegExp(`<(?:\\w+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${local}>`).exec(xml); return m ? unesc(m[1].trim()) : null; };
/** All elements with this local name: [{ attrs, inner }]. */
const elements = (xml, local) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${local}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${local}>)`, 'g'))]
  .map(m => ({ attrs: Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], unesc(a[2])])), inner: m[2] ?? '' }));

/** WS-Security UsernameToken with PasswordDigest = base64(sha1(nonce + created + password)). */
export function usernameToken(username, password, { nonce = randomBytes(16), created = new Date().toISOString() } = {}) {
  const digest = createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(password ?? '')])).digest('base64');
  return `<wsse:Security s:mustUnderstand="1" xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}"><wsse:UsernameToken>`
    + `<wsse:Username>${esc(username)}</wsse:Username>`
    + `<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password>`
    + `<wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</wsse:Nonce>`
    + `<wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security>`;
}

export class OnvifCamera extends EventEmitter {
  /** @param {{ host: string, port?: number, username?: string, password?: string, path?: string, timeoutMs?: number }} options */
  constructor(options) {
    super();
    this.options = { port: 80, path: '/onvif/device_service', timeoutMs: 5000, ...options };
    this.deviceUrl = `http://${this.options.host}:${this.options.port}${this.options.path}`;
    this.mediaUrl = null;
    this.ptzUrl = null;
    this.profileToken = null;
    this.connected = false;
    this.lastError = null;
  }

  async #soap(url, body) {
    const { username, password, timeoutMs } = this.options;
    const header = username ? `<s:Header>${usernameToken(username, password)}</s:Header>` : '';
    const envelope = `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="${NS.s}" xmlns:tds="${NS.tds}" xmlns:trt="${NS.trt}" xmlns:tptz="${NS.tptz}" xmlns:tt="${NS.tt}">${header}<s:Body>${body}</s:Body></s:Envelope>`;
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/soap+xml; charset=utf-8' }, body: envelope, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      this.lastError = err.message;
      throw new AppError(err.name === 'TimeoutError' ? 'UPSTREAM_TIMEOUT' : 'NOT_CONNECTED', `ONVIF ${this.options.host}: ${err.cause?.code ?? err.message}`);
    }
    const xml = await res.text();
    if (!res.ok || /<(?:\w+:)?Fault\b/.test(xml)) {
      const reason = text(xml, 'Text') ?? text(xml, 'faultstring') ?? `HTTP ${res.status}`;
      const auth = res.status === 401 || /NotAuthorized|Sender not Authorized|authoriz/i.test(xml);
      this.lastError = reason;
      throw new AppError(auth ? 'UPSTREAM_AUTH' : 'UPSTREAM_ERROR', `ONVIF ${this.options.host}: ${reason}`, { upstream: reason });
    }
    return xml;
  }

  async connect() {
    const caps = await this.#soap(this.deviceUrl, '<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>');
    const xaddr = section => { const m = new RegExp(`<(?:\\w+:)?${section}\\b[^>]*>[\\s\\S]*?<(?:\\w+:)?XAddr>([^<]+)<`).exec(caps); return m?.[1].trim() ?? null; };
    // Use the host we can reach (cameras often report an internal IP) but keep the service path.
    const reach = url => { try { const u = new URL(url); u.hostname = this.options.host; u.port = String(this.options.port); return u.toString(); } catch { return this.deviceUrl; } };
    this.mediaUrl = reach(xaddr('Media') ?? this.deviceUrl);
    this.ptzUrl = reach(xaddr('PTZ') ?? this.deviceUrl);
    const profiles = await this.#soap(this.mediaUrl, '<trt:GetProfiles/>');
    const all = elements(profiles, 'Profiles');
    const withPtz = all.find(p => /PTZConfiguration/.test(p.inner)) ?? all[0];
    if (!withPtz?.attrs.token) throw new AppError('UPSTREAM_ERROR', `ONVIF ${this.options.host}: no media profile found`);
    this.profileToken = withPtz.attrs.token;
    this.connected = true;
    this.lastError = null;
    this.emit('status', this.status());
  }

  #token() {
    if (!this.profileToken) throw new AppError('NOT_CONNECTED', 'ONVIF camera not connected');
    return `<tptz:ProfileToken>${esc(this.profileToken)}</tptz:ProfileToken>`;
  }

  async listPresets() {
    const xml = await this.#soap(this.ptzUrl, `<tptz:GetPresets>${this.#token()}</tptz:GetPresets>`);
    return elements(xml, 'Preset').filter(p => p.attrs.token).map(p => ({ token: p.attrs.token, name: text(p.inner, 'Name') ?? p.attrs.token }));
  }

  async recallPreset(preset) {
    if (preset === undefined || preset === null || preset === '') throw new AppError('VALIDATION', 'ONVIF preset token is required');
    await this.#soap(this.ptzUrl, `<tptz:GotoPreset>${this.#token()}<tptz:PresetToken>${esc(preset)}</tptz:PresetToken></tptz:GotoPreset>`);
    return { acknowledged: true, completed: false };
  }

  /** Store the current position. With a token: overwrite it; without: the camera assigns one (returned). */
  async storePreset(preset, name) {
    const tokenXml = preset !== undefined && preset !== null && preset !== '' ? `<tptz:PresetToken>${esc(preset)}</tptz:PresetToken>` : '';
    const nameXml = name ? `<tptz:PresetName>${esc(name)}</tptz:PresetName>` : '';
    const xml = await this.#soap(this.ptzUrl, `<tptz:SetPreset>${this.#token()}${nameXml}${tokenXml}</tptz:SetPreset>`);
    return text(xml, 'PresetToken') ?? preset;
  }

  async move({ pan = 0, tilt = 0, zoom = 0 } = {}) {
    if (!pan && !tilt && !zoom) return this.stop();
    const f = v => clamp(v, -1, 1).toFixed(3);
    await this.#soap(this.ptzUrl, `<tptz:ContinuousMove>${this.#token()}<tptz:Velocity><tt:PanTilt x="${f(pan)}" y="${f(tilt)}"/><tt:Zoom x="${f(zoom)}"/></tptz:Velocity></tptz:ContinuousMove>`);
  }

  async stop() {
    await this.#soap(this.ptzUrl, `<tptz:Stop>${this.#token()}<tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`);
  }

  async ping() { await this.listPresets(); return 'on'; }

  status() {
    return { connected: this.connected, driver: 'onvif', host: this.options.host, port: this.options.port, profile: this.profileToken, lastError: this.lastError };
  }

  async close() { this.connected = false; }
}
