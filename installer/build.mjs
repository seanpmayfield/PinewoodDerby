/**
 * Builds the Windows installer: PinewoodDerby-Setup-<version>.exe in installer/out.
 *
 * Steps: build the screens, compile the engine and server to plain
 * JavaScript, stage them with production dependencies only, add a private
 * copy of Node.js, then compile the Inno Setup script. Needs Inno Setup 6
 * (https://jrsoftware.org/isinfo.php) and internet for the Node.js download
 * and npm.
 *
 *   npm run installer                   about 30 MB
 *   npm run installer -- --with-ffmpeg  adds the video converter (20 MB more),
 *                                       only needed if phones record WebM clips
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const stage = path.join(here, 'stage');
const out = path.join(here, 'out');
const NODE_MAJOR = 24;

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const say = (t) => console.log(`\n== ${t}`);
const run = (cmd, args, cwd = root) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
};

/** Start the staged server on a spare port with its own node.exe, hit the API, stop it. */
async function smokeTest() {
  const port = 8097;
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'derby-smoke-'));
  const { spawn } = await import('node:child_process');
  const child = spawn(path.join(stage, 'runtime', 'node.exe'), ['packages/server/dist/index.js'], {
    cwd: stage,
    env: { ...process.env, DERBY_PORT: String(port), DERBY_HTTPS_PORT: '0', DERBY_USB_BACKUP: '0', DERBY_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const deadline = Date.now() + 20_000;
  let ok = false;
  while (Date.now() < deadline && !ok) {
    try {
      ok = (await fetch(`http://localhost:${port}/api/state`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    /* a temp folder left behind is harmless */
  }
  if (!ok) throw new Error(`The staged server did not answer:\n${log}`);
  console.log('  staged server answered on its own node.exe');
}

const iscc = [
  process.env.ISCC,
  path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  'C:/Program Files (x86)/Inno Setup 6/ISCC.exe',
  'C:/Program Files/Inno Setup 6/ISCC.exe',
].find((p) => p && existsSync(p));
if (!iscc) throw new Error('Inno Setup 6 not found. Install it from https://jrsoftware.org/isinfo.php or set ISCC to ISCC.exe.');

const withFfmpeg = process.argv.includes('--with-ffmpeg');

say(`Building the screens (v${version})`);
run('npm', ['run', 'build']);

say('Staging the app');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const copy = (rel, dest = rel) => cpSync(path.join(root, rel), path.join(stage, dest), { recursive: true });
for (const f of ['package.json', 'package-lock.json', 'LICENSE', 'README.md', 'Start Derby.cmd', 'Start Audience Screen.cmd', 'Allow Through Firewall.cmd']) copy(f);
copy('drivers');
// Engine and server as plain JavaScript, so the installed copy needs no TypeScript loader.
for (const p of ['core', 'server']) {
  run('npx', ['tsc', '-p', `"${path.join(here, `tsconfig.${p}.json`)}"`]);
  const manifest = JSON.parse(readFileSync(path.join(root, 'packages', p, 'package.json'), 'utf8'));
  manifest.main = './dist/index.js';
  manifest.exports = { '.': './dist/index.js' };
  delete manifest.types;
  delete manifest.scripts;
  delete manifest.devDependencies;
  writeFileSync(path.join(stage, 'packages', p, 'package.json'), JSON.stringify(manifest, null, 2));
}
// The screens are already built; their React dependencies are not needed at run time.
mkdirSync(path.join(stage, 'packages', 'web'), { recursive: true });
copy('packages/web/dist');
const web = JSON.parse(readFileSync(path.join(root, 'packages', 'web', 'package.json'), 'utf8'));
delete web.dependencies;
delete web.devDependencies;
delete web.scripts;
writeFileSync(path.join(stage, 'packages', 'web', 'package.json'), JSON.stringify(web, null, 2));
const staged = { ...pkg };
delete staged.devDependencies;
staged.scripts = { start: 'node packages/server/dist/index.js' };
writeFileSync(path.join(stage, 'package.json'), JSON.stringify(staged, null, 2));

say('Installing production dependencies');
// The lock file pins versions; then the pieces the installed copy never runs are dropped.
run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], stage);
run('npm', ['pkg', 'delete', 'dependencies.tsx', ...(withFfmpeg ? [] : ['dependencies.ffmpeg-static']), '-w', '@derby/server'], stage);
run('npm', ['prune', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], stage);
// Pruning leaves empty scope folders behind.
for (const d of readdirSync(path.join(stage, 'node_modules'))) {
  const full = path.join(stage, 'node_modules', d);
  if (statSync(full).isDirectory() && readdirSync(full).length === 0) rmSync(full, { recursive: true });
}
// Workspace links become real folders so the installer can copy them.
for (const p of ['core', 'server', 'web']) {
  const link = path.join(stage, 'node_modules', '@derby', p);
  rmSync(link, { recursive: true, force: true });
  cpSync(path.join(stage, 'packages', p), link, { recursive: true });
}
// Only the Windows build of the timer driver is needed.
const prebuilds = path.join(stage, 'node_modules', '@serialport', 'bindings-cpp', 'prebuilds');
if (existsSync(prebuilds)) for (const d of readdirSync(prebuilds)) if (d !== 'win32-x64') rmSync(path.join(prebuilds, d), { recursive: true, force: true });
if (withFfmpeg) {
  const ffmpeg = path.join(stage, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
  if (!existsSync(ffmpeg)) {
    const local = path.join(root, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
    if (existsSync(local)) cpSync(local, ffmpeg);
    else throw new Error('ffmpeg.exe is missing; run npm install in the repo first.');
  }
}

say('Adding Node.js');
const index = await (await fetch('https://nodejs.org/dist/index.json')).json();
const node = index.find((v) => v.version.startsWith(`v${NODE_MAJOR}.`));
if (!node) throw new Error(`No Node ${NODE_MAJOR} release found.`);
const zipName = `node-${node.version}-win-x64.zip`;
const cache = path.join(os.tmpdir(), zipName);
if (!existsSync(cache)) {
  console.log(`  downloading ${zipName}`);
  writeFileSync(cache, Buffer.from(await (await fetch(`https://nodejs.org/dist/${node.version}/${zipName}`)).arrayBuffer()));
}
const unpack = path.join(os.tmpdir(), 'PinewoodDerby-node');
rmSync(unpack, { recursive: true, force: true });
execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${cache}' -DestinationPath '${unpack}' -Force`]);
const inner = readdirSync(unpack).map((d) => path.join(unpack, d)).find((d) => statSync(d).isDirectory());
mkdirSync(path.join(stage, 'runtime'), { recursive: true });
// Only node.exe is needed at run time; npm and its modules stay out of the installer.
cpSync(path.join(inner, 'node.exe'), path.join(stage, 'runtime', 'node.exe'));
cpSync(path.join(inner, 'LICENSE'), path.join(stage, 'runtime', 'LICENSE'));
rmSync(unpack, { recursive: true, force: true });
console.log(`  ${node.version}`);

say('Smoke-testing the staged server');
await smokeTest();

say('Compiling the installer');
mkdirSync(out, { recursive: true });
const compile = spawnSync(iscc, [`/DAppVersion=${version}`, `/O${out}`, path.join(here, 'PinewoodDerby.iss')], { cwd: here, stdio: 'inherit' });
if (compile.status !== 0) throw new Error(`ISCC failed (${compile.status})`);
const exe = path.join(out, `PinewoodDerby-Setup-${version}.exe`);
console.log(`\nInstaller: ${exe} (${(statSync(exe).size / 1024 / 1024).toFixed(1)} MB)`);
