#!/usr/bin/env node
/** Inspect and flash local GB/GBC ROMs through the official ModRetro CLI. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assessCompatibility, decodeRequirements, DEMO_CARTRIDGE, formatInspection } from './compatibility.mjs';

export const ROOT = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const CLI_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  .dependencies['@modretro/chromatic-cli'];
const ROM_SIZES = new Map(Array.from({ length: 9 }, (_, code) => [code, 32768 * 2 ** code]));
for (const [code, banks] of [[0x52, 72], [0x53, 80], [0x54, 96]]) ROM_SIZES.set(code, banks * 16384);
export class WorkflowError extends Error {}
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value, null, 2);

export function inspectRom(filename) {
  const expanded = filename.startsWith('~/') ? join(homedir(), filename.slice(2)) : filename;
  if (!['.gb', '.gbc'].includes(extname(expanded).toLowerCase())) {
    throw new WorkflowError('Provide an extracted .gb or .gbc file.');
  }
  const path = realpathSync(resolve(expanded));
  const data = readFileSync(path);
  if (data.length < 0x150) throw new WorkflowError('File is too small for a Game Boy ROM header.');
  const declaredSize = ROM_SIZES.get(data[0x148]);
  if (data.length !== declaredSize) {
    throw new WorkflowError(`ROM length (${data.length}) does not match header size (${declaredSize ?? 'unknown'}).`);
  }
  let checksum = 0;
  for (let address = 0x134; address < 0x14d; address++) checksum = (checksum - data[address] - 1) & 255;
  if (checksum !== data[0x14d]) throw new WorkflowError('Invalid ROM header checksum; file was not modified.');
  let computedGlobal = 0;
  for (let address = 0; address < data.length; address++) {
    if (address !== 0x14e && address !== 0x14f) computedGlobal = (computedGlobal + data[address]) & 65535;
  }
  const globalChecksum = data.readUInt16BE(0x14e);
  const titleBytes = data.subarray(0x134, data[0x143] & 0x80 ? 0x143 : 0x144);
  const title = Array.from(titleBytes.subarray(0, titleBytes.indexOf(0) < 0 ? titleBytes.length : titleBytes.indexOf(0)))
    .map(byte => byte < 128 ? String.fromCharCode(byte) : '\ufffd').join('');
  const rom = {
    path, title, size_bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    cartridge_type_code: data[0x147], cgb_flag: data[0x143],
    rom_size_code: data[0x148], ram_size_code: data[0x149], rom_version: data[0x14c],
    header_checksum: checksum, global_checksum: globalChecksum,
    computed_global_checksum: computedGlobal, global_checksum_valid: globalChecksum === computedGlobal,
  };
  return { ...rom, requirements: decodeRequirements(rom) };
}

export function resolveCli() {
  try {
    // The vendor launcher handles OS/CPU/libc selection. Always use this
    // project's pinned dependency, even if a global CLI is on PATH.
    return require.resolve('@modretro/chromatic-cli/bin/chromatic-cli.cjs');
  } catch {
    throw new WorkflowError('The project CLI is not installed. Run npm ci first.');
  }
}

export class Session {
  constructor({ cli = resolveCli(), root = ROOT, runner = spawnSync, report = console.error } = {}) {
    this.cli = cli;
    this.root = root;
    this.runner = runner;
    this.report = report;
    const result = runner(process.execPath, [cli, '--version'], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new WorkflowError(result.stderr?.trim() || 'chromatic-cli could not start.');
    if (result.stdout.trim() !== `chromatic-cli ${CLI_VERSION}`) {
      throw new WorkflowError(`Expected chromatic-cli ${CLI_VERSION}. Run npm ci.`);
    }
    mkdirSync(join(root, 'logs'), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logs = mkdtempSync(join(root, 'logs', `${stamp}-`));
    this.step = 0;
    this.save('cli-version', { version: CLI_VERSION, executable: cli });
    report(`Logs: ${this.logs}`);
  }

  save(name, value) {
    writeFileSync(join(this.logs, `${name}.json`), `${json(value)}\n`);
  }

  run(operation, ...options) {
    const tmp = join(this.root, 'tools', 'chromatic-tmp');
    mkdirSync(tmp, { recursive: true });
    const args = [this.cli, operation, ...options, '--format', 'json', '--yes'];
    this.report(`${operation}…`);
    const result = this.runner(process.execPath, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, TMPDIR: tmp },
    });
    this.save(`${String(++this.step).padStart(2, '0')}-${operation}`, {
      command: [process.execPath, ...args], returncode: result.status,
      signal: result.signal, stdout: result.stdout, stderr: result.stderr,
      error: result.error?.message,
    });
    if (result.error) throw result.error;
    let payload;
    try { payload = JSON.parse(result.stdout); }
    catch { throw new WorkflowError(`${operation} did not return JSON. See ${this.logs}.`); }
    if (!isObject(payload) || payload.schema_version !== 1) {
      throw new WorkflowError(`${operation} returned an unsupported JSON response. See ${this.logs}.`);
    }
    if (result.status !== 0 || payload.ok !== true) {
      throw new WorkflowError(`${operation}: ${payload.error?.message || result.stderr?.trim() || 'command failed'}`);
    }
    if (!isObject(payload.result)) {
      throw new WorkflowError(`${operation} returned an unexpected JSON result. See ${this.logs}.`);
    }
    if (payload.operation !== operation) {
      throw new WorkflowError(`${operation} returned a response for a different operation. See ${this.logs}.`);
    }
    return payload.result;
  }
}

export function checkCapacity(cartridge, rom) {
  const capacity = cartridge?.flash?.capacity_bytes;
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new WorkflowError('No supported writable flash chip was detected; refusing to write.');
  }
  if (rom.size_bytes > capacity) throw new WorkflowError(`ROM is ${rom.size_bytes} bytes; cartridge capacity is only ${capacity} bytes.`);
}

export function verifyHeader(cartridge, rom) {
  const header = cartridge?.header ?? {};
  const expected = {
    cartridge_type_code: rom.cartridge_type_code, cgb_flag: rom.cgb_flag,
    stored_header_checksum: rom.header_checksum, global_checksum: rom.global_checksum,
    rom_version: rom.rom_version,
  };
  const mismatches = Object.keys(expected).filter(key => header[key] !== expected[key]);
  if (header.header_checksum !== 'valid') mismatches.push('header_checksum');
  if (header.rom_size?.bytes !== rom.size_bytes) mismatches.push('rom_size');
  if (header.ram_size?.code !== rom.ram_size_code) mismatches.push('ram_size');
  if (mismatches.length) throw new WorkflowError(`Cartridge header differs from the ROM: ${mismatches.join(', ')}`);
}

export function assertCompatibility(report, allowUnknown = false) {
  if (report.status === 'incompatible') {
    throw new WorkflowError(`Incompatible with the DevDay demo cartridge: ${report.reasons.join(' ')}`);
  }
  if (report.status === 'unknown' && !allowUnknown) {
    throw new WorkflowError(`Unknown compatibility: ${report.reasons.join(' ')} Use --allow-unknown-compatibility only to deliberately try an unverified ROM; --yes does not override compatibility.`);
  }
}

export function verifyWriteResult(result, rom, player) {
  if (result.player !== player) throw new WorkflowError('Write result reports a different or missing player number.');
  if (result.romSha256 !== rom.sha256) throw new WorkflowError('Write result reports a different or missing host ROM SHA-256.');
}

export function withDeviceReset(session, player, action) {
  const devices = session.run('list-devices').devices;
  if (!Array.isArray(devices) || !devices.some(device => device.player === player)) {
    throw new WorkflowError(`No Chromatic with player number ${player}. Use npm run devices to list players.`);
  }
  const options = ['--player', String(player)];
  let originalError;
  try { return action(options); }
  catch (error) { originalError = error; throw error; }
  finally {
    try { session.run('reset-device', ...options); }
    catch (error) {
      if (!originalError) throw error;
      session.report(`Device reset also failed: ${error.message}`);
    }
  }
}

export function check(session, rom, player, { profile = DEMO_CARTRIDGE } = {}) {
  return withDeviceReset(session, player, options => {
    const cartridge = session.run('detect-cart', '--all', ...options).cartridge ?? null;
    session.save('cartridge-before', cartridge);
    const report = assessCompatibility(rom, { profile, cartridge });
    session.save('compatibility', report);
    return report;
  });
}

export function flash(session, rom, player, { profile = DEMO_CARTRIDGE, allowUnknown = false } = {}) {
  assertCompatibility(assessCompatibility(rom, { profile }), allowUnknown);
  const verification = {
    profile_id: profile.id, requested_player: player, host_rom_sha256: rom.sha256,
    outcome: 'pending', cartridge_profile_before: 'not_checked', cartridge_profile_after: 'not_checked', cli_player_and_host_hash: 'not_checked',
    cartridge_header: 'not_checked', device_reset: 'not_confirmed',
    full_flash_readback: 'unavailable_in_cli_1.2.1',
    gameplay: 'not_tested_by_this_run', save_persistence: 'not_tested_by_this_run',
  };
  session.save('verification', verification);
  try {
    withDeviceReset(session, player, options => {
      const before = session.run('detect-cart', '--all', ...options).cartridge ?? null;
      session.save('cartridge-before', before);
      const report = assessCompatibility(rom, { profile, cartridge: before });
      session.save('compatibility', { ...report, unknown_compatibility_override: allowUnknown && report.status === 'unknown' });
      verification.cartridge_profile_before = report.hardware_match;
      session.save('verification', verification);
      checkCapacity(before, rom);
      assertCompatibility(report, allowUnknown);
      session.save('rom', rom);
      session.save('verification', verification);
      const written = session.run('write-homebrew', rom.path, '--expect-sha256', rom.sha256, ...options);
      verifyWriteResult(written, rom, player);
      verification.cli_player_and_host_hash = 'matched';
      session.save('verification', verification);
      const after = session.run('detect-cart', '--all', ...options).cartridge ?? null;
      session.save('cartridge-after', after);
      const afterReport = assessCompatibility(rom, { profile, cartridge: after });
      session.save('compatibility-after', afterReport);
      verification.cartridge_profile_after = afterReport.hardware_match;
      session.save('verification', verification);
      assertCompatibility(afterReport, allowUnknown);
      verifyHeader(after, rom);
      verification.cartridge_header = 'matched';
      session.save('verification', verification);
    });
    verification.device_reset = 'completed';
    verification.outcome = 'completed';
    session.save('verification', verification);
    return verification;
  } catch (error) {
    verification.outcome = 'failed';
    verification.error = error.message;
    session.save('verification', verification);
    throw error;
  }
}

export function installDrivers({
  platform = process.platform, userId = process.getuid?.(), runner = spawnSync,
  cli, yes = false, report = console.log,
} = {}) {
  if (platform === 'darwin') {
    report('macOS requires no additional USB drivers.');
    return;
  }
  cli ??= resolveCli();
  const args = [cli, 'install-drivers', ...(yes ? ['--yes'] : [])];
  // sudo receives the actual Node executable, so nvm/user-local installations
  // work even when sudo's PATH does not contain Node or the project CLI.
  const result = platform === 'linux' && userId !== 0
    ? runner('sudo', [process.execPath, ...args], { stdio: 'inherit' })
    : runner(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new WorkflowError('USB driver/permission installation failed.');
}

async function confirm(message) {
  if (!process.stdin.isTTY) throw new WorkflowError('Confirmation needs a terminal; use --yes for automation.');
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try { return (await terminal.question(`${message}\nType yes to continue: `)).trim().toLowerCase() === 'yes'; }
  finally { terminal.close(); }
}

const HELP = `Usage: node modretro.mjs <command> [ROM] [options]
Commands: devices, drivers, inspect, check, detect, flash
Target: Codex / OpenAI DevDay demo cartridge; ISSI IS29GL032-70TLET-TR (4 MiB)
Options:
  --player N   Select the Chromatic (default: 1)
  --yes        Confirm reset/replacement; for drivers, skip the vendor prompt
  --dry-run    Run offline flash checks and preview the wrapper command
  --json       Machine-readable output for inspect/check
  --allow-unknown-compatibility   Explicitly try unverified hardware requirements
  --allow-invalid-global-checksum  Allow a known stale whole-ROM checksum
Examples:
  npm ci
  npm run devices
  npm run inspect -- /path/to/game.gbc
  npm run check -- /path/to/game.gbc --player 1
  npm run flash -- /path/to/game.gbc --dry-run
  npm run flash -- /path/to/game.gbc --player 1`;

export async function main(argv = process.argv.slice(2), {
  sessionFactory = () => new Session(), ask = confirm, print = console.log,
} = {}) {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, player: { type: 'string' }, yes: { type: 'boolean' },
    'dry-run': { type: 'boolean' }, 'allow-invalid-global-checksum': { type: 'boolean' },
    json: { type: 'boolean' }, 'allow-unknown-compatibility': { type: 'boolean' },
  } });
  const [command, filename] = positionals;
  if (values.help || !command) { print(HELP); return 0; }
  if (!['devices', 'drivers', 'inspect', 'check', 'detect', 'flash'].includes(command)) throw new WorkflowError(`Unknown command: ${command}`);
  const takesRom = ['inspect', 'check', 'flash'].includes(command);
  if (positionals.length !== (takesRom ? 2 : 1)) throw new WorkflowError(takesRom ? 'Provide one .gb or .gbc path.' : 'Unexpected positional arguments.');
  const permitted = {
    devices: [], drivers: ['yes'], inspect: ['json'], check: ['player', 'yes', 'json'], detect: ['player', 'yes'],
    flash: ['player', 'yes', 'dry-run', 'allow-invalid-global-checksum', 'allow-unknown-compatibility'],
  }[command];
  for (const flag of Object.keys(values)) {
    if (!permitted.includes(flag)) throw new WorkflowError(`--${flag} is not valid for ${command}.`);
  }
  const player = Number(values.player ?? 1);
  if (!Number.isSafeInteger(player) || player < 1) throw new WorkflowError('Player number must be a positive integer.');
  if (command === 'drivers') { installDrivers({ yes: values.yes }); return 0; }
  if (command === 'devices') { print(json(sessionFactory().run('list-devices'))); return 0; }
  if (takesRom) {
    const rom = inspectRom(filename);
    const compatibility = assessCompatibility(rom);
    const show = report => print(values.json ? json({ ...rom, compatibility: report }) : formatInspection(rom, report));
    if (command !== 'check') show(compatibility);
    if (command === 'inspect') return 0;
    if (command === 'check') {
      if (!values.yes && !await ask(`Checking player ${player} resets the Chromatic but does not write a ROM. Save your game first.`)) {
        print(values.json ? json({ cancelled: true }) : 'Cancelled; device unchanged.'); return 0;
      }
      const report = check(sessionFactory(), rom, player);
      show(report);
      return !rom.global_checksum_valid || report.status === 'incompatible' ? 1 : report.status === 'unknown' ? 2 : 0;
    }
    if (!rom.global_checksum_valid && !values['allow-invalid-global-checksum']) {
      throw new WorkflowError('Whole-ROM checksum is invalid. Check the file; use --allow-invalid-global-checksum only for a known stale checksum.');
    }
    const allowUnknown = values['allow-unknown-compatibility'] === true;
    assertCompatibility(compatibility, allowUnknown);
    if (values['dry-run']) {
      const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
      print(`npm run flash -- ${quote(rom.path)} --player ${player}${allowUnknown ? ' --allow-unknown-compatibility' : ''}${values['allow-invalid-global-checksum'] ? ' --allow-invalid-global-checksum' : ''}${values.yes ? ' --yes' : ''}`);
      print('Dry run complete; no CLI commands or USB operations were performed.');
      return 0;
    }
    if (allowUnknown && compatibility.status === 'unknown') print('Explicit override: hardware compatibility remains UNKNOWN; successful writing does not establish playability or save support.');
    if (!values.yes && !await ask(`Replace the cartridge ROM on player ${player} with ${basename(rom.path)}? This resets the Chromatic; save your game first.`)) {
      print('Cancelled; cartridge unchanged.'); return 0;
    }
    flash(sessionFactory(), rom, player, { allowUnknown });
    print('Flash complete. Demo chip profile, CLI player/host hash, and cartridge header checked; Chromatic reset. Full-flash readback, gameplay, and save persistence were not tested by this run.');
  } else {
    if (!values.yes && !await ask(`Inspecting player ${player} resets the Chromatic. Save your game first.`)) {
      print('Cancelled; device unchanged.'); return 0;
    }
    const session = sessionFactory();
    withDeviceReset(session, player, options => print(json(session.run('detect-cart', '--all', ...options))));
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
