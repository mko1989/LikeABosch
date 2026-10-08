// Minimal levelled logger. Never pass passwords or full credential objects to it.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * @param {object} [options]
 * @param {keyof LEVELS} [options.level]
 * @param {string} [options.name]   component name shown in each line
 */
export function createLogger({ level = 'info', name = 'app' } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, msg, extra) => {
    if (LEVELS[lvl] < min) return;
    const line = `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} [${name}] ${msg}`;
    const out = lvl === 'error' || lvl === 'warn' ? console.error : console.log;
    extra === undefined ? out(line) : out(line, extra);
  };
  return {
    debug: (msg, extra) => write('debug', msg, extra),
    info: (msg, extra) => write('info', msg, extra),
    warn: (msg, extra) => write('warn', msg, extra),
    error: (msg, extra) => write('error', msg, extra),
    /** @param {string} child */
    child: child => createLogger({ level, name: `${name}:${child}` }),
  };
}
