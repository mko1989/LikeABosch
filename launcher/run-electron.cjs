// Starts Electron with a clean environment. ELECTRON_RUN_AS_NODE (set e.g. in VS Code's terminal, which is
// itself Electron) would make Electron run main.js as plain Node and fail. Cross-platform alternative to `env -u`.
const { spawn } = require('node:child_process');
const electron = require('electron'); // path to the Electron binary

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { cwd: __dirname, env, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 1));
