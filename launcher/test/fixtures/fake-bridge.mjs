// Stand-in for dcn-bridge.exe / dicentis-bridge.exe in launcher tests (WO-080). Mode from FAKE_BRIDGE_MODE:
// ok (READY, stay up), fail (error, exit 1), crash-once (READY, exit after 150 ms the first time; marker file FAKE_BRIDGE_MARK).
import { existsSync, writeFileSync } from 'node:fs';

const arg = name => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
const mode = process.env.FAKE_BRIDGE_MODE ?? 'ok';
console.log(`INFO  args ${process.argv.slice(2).join(' ')}`);
if (mode === 'fail') {
  console.error('ERROR DICENTIS API (Bosch.Dcnm.Interfaces.Api.dll) not found');
  process.exit(1);
}
console.log(`READY port=${arg('--port') ?? 0}`);
if (mode === 'crash-once' && !existsSync(process.env.FAKE_BRIDGE_MARK)) {
  writeFileSync(process.env.FAKE_BRIDGE_MARK, 'crashed');
  setTimeout(() => process.exit(3), 150);
}
setInterval(() => {}, 1000);
process.on('SIGTERM', () => process.exit(0));
