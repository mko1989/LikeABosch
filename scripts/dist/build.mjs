#!/usr/bin/env node
// Distribution build (WO-097, installers WO-100): stage the launcher + backend + web UI + mocks (simulation, DEC-026) +
// protocol specs into dist/stage, install the runtime dependencies there, and package it with electron-builder (a dev
// dependency of the launcher). Unsigned: macOS dmg + zip (ad-hoc signed), Windows setup .exe (NSIS) + portable zip.
//
//   npm run dist                 # macOS x64 + arm64, Windows x64
//   npm run dist -- --mac        # only macOS (add --arm64 / --x64 / --universal to pick one)
//   npm run dist -- --win        # only Windows x64 (setup + zip; the Windows bridges are included when built)
//   npm run dist -- --test       # version <package version>-test.<yyyymmdd> (WO-097 test builds)
import { stripSpecs, stripApi } from './strip-specs.mjs';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const args = new Set(process.argv.slice(2));
const wantMac = args.has('--mac') || !args.has('--win');
const wantWin = args.has('--win') || !args.has('--mac');
const pickedArchs = args.has('--universal') ? ['universal'] : [args.has('--arm64') && 'arm64', args.has('--x64') && 'x64'].filter(Boolean);
const macArchs = pickedArchs.length ? pickedArchs : ['x64', 'arm64'];
const dist = join(root, 'dist');
const stage = join(dist, 'stage');

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const launcherPkg = JSON.parse(readFileSync(join(root, 'launcher/package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(join(root, 'launcher/node_modules/electron/package.json'), 'utf8')).version;
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const version = args.has('--test') ? `${rootPkg.version}-test.${stamp}` : rootPkg.version;
const icon = join(root, 'launcher/build/icon.png'); // 1024 px, from icon.svg; electron-builder derives .icns / .ico

const step = msg => console.log(`\n▶ ${msg}`);

// ---------------------------------------------------------------- 1. stage
step(`staging ${relative(root, stage)} (LikeABosch ${version}, Electron ${electronVersion})`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const skip = p => /[/\\](node_modules|test|\.DS_Store)([/\\]|$)/.test(p) || /\.test\.(m?js|cjs)$/.test(p);
const copy = (from, to = from) => cpSync(join(root, from), join(stage, to), { recursive: true, filter: src => !skip(relative(root, src)) });
copy('backend/src');
copy('web');
copy('mock');                 // simulated systems run the mocks inside the backend (WO-095)
stripSpecs(join(root, 'docs/protocol'), join(stage, 'docs/protocol')); // runtime specs without Bosch's text (WO-107)
for (const f of ['main.js', 'preload.cjs', 'renderer', 'lib', 'README.md']) copy(join('launcher', f));
writeFileSync(join(stage, 'launcher/package.json'), JSON.stringify({ type: 'module' }, null, 2)); // ES modules
// The app's package.json: the launcher is the Electron entry; runtime deps are the backend's.
writeFileSync(join(stage, 'package.json'), JSON.stringify({
  name: 'likeabosch', productName: 'LikeABosch', version, description: rootPkg.description, author: 'LikeABosch',
  private: true, type: 'module', main: 'launcher/main.js', dependencies: rootPkg.dependencies,
}, null, 2));
cpSync(join(root, 'package-lock.json'), join(stage, 'package-lock.json'));

step('installing runtime dependencies (npm ci --omit=dev)');
// The lock file is the repo's: same versions as tested. Its root entry differs (name/version), npm ci accepts that.
execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: stage, stdio: 'inherit' });

// ---------------------------------------------------------------- 2. package
const require = createRequire(join(root, 'launcher/package.json'));
const builder = require('electron-builder');
// The bridges' build output carries a copy of the full api.json: stage each bridge and ship the stripped one (WO-107).
const bridgeResources = ['dcn', 'dicentis']
  .map(dir => ({ dir, from: join(root, 'bridge', dir, 'bin/Release/net48') }))
  .filter(b => existsSync(b.from))
  .map(b => {
    const staged = join(dist, 'stage-bridges', b.dir);
    rmSync(staged, { recursive: true, force: true });
    cpSync(b.from, staged, { recursive: true, filter: src => !src.endsWith('.pdb') });
    if (existsSync(join(staged, 'api.json'))) writeFileSync(join(staged, 'api.json'), `${JSON.stringify(stripApi(JSON.parse(readFileSync(join(staged, 'api.json'), 'utf8'))), null, 1)}\n`);
    return { from: staged, to: `bridges/${b.dir}`, filter: ['**/*'] };
  });

const config = {
  appId: 'local.likeabosch.launcher',
  productName: 'LikeABosch',
  electronVersion,
  copyright: `© ${new Date().getFullYear()} LikeABosch`,
  directories: { app: stage, output: dist },
  icon,
  asar: false, // the backend runs as a child process (ELECTRON_RUN_AS_NODE) straight from these files
  npmRebuild: false, // no native modules
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  files: ['**/*'],
  mac: { target: [{ target: 'zip', arch: macArchs }, { target: 'dmg', arch: macArchs }], category: 'public.app-category.utilities', identity: '-', hardenedRuntime: false }, // ad-hoc signed (needed on Apple Silicon)
  dmg: { writeUpdateInfo: false },
  // Exe icon + version resources are written with resedit (no Wine); no certificate → not signed.
  win: { target: [{ target: 'nsis', arch: ['x64'] }, { target: 'zip', arch: ['x64'] }], signExecutable: false, extraResources: bridgeResources },
  // Assisted installer (native makensis on macOS): "only me" (no admin) or "all users" (Program Files), folder choice,
  // Start menu + desktop shortcut, uninstaller under Apps. Nothing is written to the install folder at runtime and the
  // user's data folder (%APPDATA%\LikeABosch, DEC-016) is kept on uninstall / update.
  nsis: {
    oneClick: false, perMachine: false, allowElevation: true, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'LikeABosch', runAfterFinish: true,
    deleteAppDataOnUninstall: false, artifactName: '${productName}-${version}-${os}-${arch}-setup.${ext}',
  },
  publish: null,
};
step(`electron-builder: ${[wantMac && `macOS ${macArchs.join('+')}`, wantWin && `Windows x64${bridgeResources.length ? ` + bridges (${bridgeResources.map(b => b.to).join(', ')})` : ' (no bridges built)'}`].filter(Boolean).join(', ')}`);
const files = await builder.build({ config, projectDir: stage, ...(wantMac ? { mac: [] } : {}), ...(wantWin ? { win: [] } : {}) }); // targets/archs from config

// ---------------------------------------------------------------- 3. install notes
const ver = (os, arch, ext) => `LikeABosch-${version}-${os}-${arch}${ext}`;
writeFileSync(join(dist, 'README.txt'), `LikeABosch ${version} (built ${new Date().toISOString().slice(0, 10)})

INSTALL

Windows (x64): ${ver('win', 'x64', '-setup.exe')}
  Run the setup. Choose "Only for me" (no admin rights) or "Anyone who uses this computer" (Program Files, asks for
  admin), pick the folder, finish. Start LikeABosch from the Start menu or the desktop shortcut.
  The build is not code-signed: SmartScreen says "Windows protected your PC" → "More info" → "Run anyway".
  Windows Firewall may ask on the first server start: allow it on private networks if other PCs should open the GUI.
  Uninstall: Settings → Apps → LikeABosch. Your projects and settings are kept.
  No installer wanted: ${ver('win', 'x64', '.zip')} — unzip the whole folder and run LikeABosch.exe.
  The Windows bridges (dcn-bridge, dicentis-bridge) are installed in resources\\bridges; the launcher starts them when
  the configuration needs them.

macOS: ${ver('mac', 'arm64', '.dmg')} (Apple Silicon) or ${ver('mac', 'x64', '.dmg')} (Intel)
  Open the dmg and drag LikeABosch onto Applications. The app is not notarised: the first time, right-click the app in
  Applications → Open → Open. If macOS says the app "is damaged": run  xattr -cr /Applications/LikeABosch.app  in
  Terminal and open it again.
  Updating: replace the app in Applications. Because the build is unsigned, the first start after an update asks
  to use "LikeABosch Safe Storage" in your keychain (the saved DICENTIS password): enter your Mac password and
  click Always Allow. Uninstall: move the app to the Bin.

FIRST START

The launcher window opens: choose the system, host and login, click "Start server", then "Launch GUI".
Without hardware: in the launcher pick a simulated system under "Simulation (no hardware)" → "Connect to" (or in the
GUI: Settings → Connection → Simulation). Each simulated system has its own project; download it (top bar), load
it at the venue, then Room → Edit layout → "Match seats…".

Data (projects, settings) are stored per user and survive updates and uninstalling:
macOS ~/Library/Application Support/LikeABosch, Windows %APPDATA%\\LikeABosch.
`);
console.log(`\n✔ built:\n${files.filter(f => !f.endsWith('.blockmap')).map(f => `  ${relative(root, f)}`).join('\n')}\n  dist/README.txt`);
