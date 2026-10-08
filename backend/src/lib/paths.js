// Data folder locations (DEC-016): one per-user folder shared by a direct start and the launcher.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The OS folder for per-user application data. */
function appDataRoot({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support');
  if (platform === 'win32') return env.APPDATA || join(home, 'AppData', 'Roaming');
  return env.XDG_CONFIG_HOME || join(home, '.config');
}

/**
 * Default data folder when DATA_DIR is not set.
 * @param {{ platform?: string, env?: Record<string, string | undefined>, home?: string }} [os]
 */
export function defaultDataDir(os = {}) {
  return join(appDataRoot(os), 'LikeABosch');
}

/**
 * Where earlier versions kept their data; copied in once as projects when the default folder is new (DEC-016 §5).
 * @returns {{ dir: string, name: string, copySettings: boolean }[]}
 */
export function legacyDataDirs(os = {}) {
  return [
    { dir: fileURLToPath(new URL('../../../data', import.meta.url)), name: 'Imported: server data', copySettings: true },
    { dir: join(appDataRoot(os), 'likeabosch-launcher', 'backend-data'), name: 'Imported: launcher data', copySettings: false },
  ];
}
