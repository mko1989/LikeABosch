// Which Bosch APIs are installed on this PC (WO-120, DEC-037): the same search as the bridges (DcnmHost.FindDllDir,
// ApiHost.FindDllDir): a configured folder, the standard installation folder below Program Files, else the first folder
// below Program Files\Bosch (4 levels) that contains the API DLL. Pure apart from the injected file-system functions.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const BOSCH_APIS = {
  dicentis: { dll: 'Bosch.Dcnm.Interfaces.Api.dll', installDir: ['Bosch', 'DICENTIS'], bridge: 'dicentis-bridge', label: 'DICENTIS software' },
  dcn: { dll: 'Bosch.Dcn.Ecpc.Client.Api.Logic.dll', installDir: ['Bosch', 'Digital Congress Network', 'DCN-SW'], bridge: 'dcn-bridge', label: 'DCN-SW' },
};

const defaultFs = {
  exists: p => existsSync(p),
  dirs: p => { try { return readdirSync(p).map(n => join(p, n)).filter(d => { try { return statSync(d).isDirectory(); } catch { return false; } }); } catch { return []; } },
};

/**
 * @param {{ platform?: string, env?: Record<string, string | undefined>, configured?: { dicentis?: string, dcn?: string },
 *   fs?: { exists: (p: string) => boolean, dirs: (p: string) => string[] }, join?: (...p: string[]) => string }} [options]
 * @returns {{ dicentis: { dllDir: string } | null, dcn: { dllDir: string } | null }}
 */
export function detectBoschApis({ platform = process.platform, env = process.env, configured = {}, fs = defaultFs, join: pathJoin = join } = {}) {
  const none = { dicentis: null, dcn: null };
  if (platform !== 'win32') return none;
  const programFiles = [...new Set([env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(Boolean))];
  const has = (dir, dll) => fs.exists(pathJoin(dir, dll));
  const search = (dir, dll, depth) => {
    if (!fs.exists(dir)) return null;
    if (has(dir, dll)) return dir;
    if (depth === 0) return null;
    for (const d of fs.dirs(dir)) {
      const found = search(d, dll, depth - 1);
      if (found) return found;
    }
    return null;
  };
  const find = (key) => {
    const { dll, installDir } = BOSCH_APIS[key];
    const own = configured[key];
    if (own) return has(own, dll) ? own : null; // a configured folder wins; wrong folder = not found (shown in the UI)
    const standard = programFiles.map(p => pathJoin(p, ...installDir)).find(d => has(d, dll));
    return standard ?? programFiles.map(p => search(pathJoin(p, 'Bosch'), dll, 4)).find(Boolean) ?? null;
  };
  const out = { ...none };
  for (const key of Object.keys(BOSCH_APIS)) {
    const dllDir = find(key);
    if (dllDir) out[key] = { dllDir };
  }
  return out;
}
