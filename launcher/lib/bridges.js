// Which Windows bridge the launcher has to start for the current settings, and where its exe is (DEC-022, WO-080).
// With `autoBridges` (DEC-037, WO-120) also every bridge whose Bosch software is installed (detectBoschApis).
// Pure Node: testable without Electron or Windows.
import { existsSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';

/**
 * @typedef {{ name: 'dcn-bridge' | 'dicentis-bridge', dir: string, exe: string, port: number, dllDir: string, token: string, auto?: boolean }} BridgeSpec
 */

export const BRIDGES = {
  'dcn-bridge': { dir: 'dcn', exe: 'dcn-bridge.exe', defaultPort: 9480 },
  'dicentis-bridge': { dir: 'dicentis', exe: 'dicentis-bridge.exe', defaultPort: 9481 },
};

/** Addresses that mean "this PC". */
export function isLocalHost(host, { name = hostname(), interfaces = networkInterfaces() } = {}) {
  const h = String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '' || h === 'localhost' || h === '::1' || h.startsWith('127.')) return true;
  if (h === name.toLowerCase() || h === `${name.toLowerCase()}.local`) return true;
  return Object.values(interfaces).flat().some(i => i?.address?.toLowerCase() === h);
}

/**
 * The bridges these settings need on this PC. Only on Windows (the bridges host Windows .NET DLLs); a remote bridge host
 * means the bridge runs elsewhere, as before.
 * @param {import('./settings-store.js').DEFAULT_SETTINGS} settings
 * @param {{ platform?: string, bridgeToken?: string, local?: (host: string) => boolean,
 *   found?: { dicentis?: { dllDir: string } | null, dcn?: { dllDir: string } | null } }} [options]
 *   `found`: installed Bosch APIs (detectBoschApis); with `autoBridges` their bridges start without being configured.
 * @returns {BridgeSpec[]}
 */
export function neededBridges(settings, { platform = process.platform, bridgeToken = '', local = isLocalHost, found = {} } = {}) {
  if (platform !== 'win32' || settings.manageBridges === false) return [];
  const auto = settings.autoBridges !== false;
  const out = [];
  const dcnHere = settings.system === 'dcn' && local(settings.host);
  const dcnElsewhere = settings.system === 'dcn' && !dcnHere; // the configured bridge runs on another PC
  if (dcnHere || (auto && found.dcn && !dcnElsewhere)) {
    out.push({
      name: 'dcn-bridge', ...pick('dcn-bridge'), port: (dcnHere ? settings.port : null) ?? BRIDGES['dcn-bridge'].defaultPort,
      dllDir: settings.dcnBridgeDllDir || found.dcn?.dllDir || '', token: bridgeToken, exe: settings.dcnBridgeExe || BRIDGES['dcn-bridge'].exe,
      ...(dcnHere ? {} : { auto: true }),
    });
  }
  const dcnmConfigured = settings.system === 'wired' && settings.dcnmBridge;
  const dcnmHere = dcnmConfigured && local(settings.dcnmHost);
  if (dcnmHere || (auto && found.dicentis && !(dcnmConfigured && !dcnmHere))) {
    out.push({
      name: 'dicentis-bridge', ...pick('dicentis-bridge'), port: settings.dcnmPort ?? BRIDGES['dicentis-bridge'].defaultPort,
      dllDir: settings.dcnmDllDir || found.dicentis?.dllDir || '', token: bridgeToken, exe: settings.dcnmExe || BRIDGES['dicentis-bridge'].exe,
      ...(dcnmHere ? {} : { auto: true }),
    });
  }
  return out;
}
const pick = name => ({ dir: BRIDGES[name].dir });

/**
 * Full path of a bridge exe: a configured path (absolute), else `bridges/<dir>/<exe>` in the packaged app's resources or
 * next to the launcher, else the build output `bridge/<dir>/bin/Release/net48/<exe>` of a source checkout. null = not found.
 * @param {BridgeSpec} bridge
 * @param {{ repoRoot: string, launcherDir: string, resourcesPath?: string, exists?: (p: string) => boolean }} where
 */
export function resolveExe(bridge, { repoRoot, launcherDir, resourcesPath, exists = existsSync }) {
  const file = BRIDGES[bridge.name].exe;
  if (bridge.exe && bridge.exe !== file) return exists(bridge.exe) ? bridge.exe : null;
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, 'bridges', bridge.dir, file)] : []),
    join(launcherDir, 'bridges', bridge.dir, file),
    join(repoRoot, 'bridges', bridge.dir, file),
    join(repoRoot, 'bridge', bridge.dir, 'bin', 'Release', 'net48', file),
  ];
  return candidates.find(p => exists(p)) ?? null;
}

/** Command line for a bridge started by the launcher: loopback only (DEC-022), the configured port, DLL folder, token. */
export function bridgeArgs(bridge) {
  return ['--listen', '127.0.0.1', '--port', String(bridge.port),
    ...(bridge.dllDir ? ['--dll-dir', bridge.dllDir] : []),
    ...(bridge.token ? ['--token', bridge.token] : [])];
}
