import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CLI_VERSION, Session, WorkflowError, flash, inspectRom, installDrivers, main } from '../modretro.mjs';

// These buffers are generated test data, not copies of any game ROM.
function fixture(t, { sizeCode = 0, title = 'TEST ROM', cgbFlag = 0x80, type = 0, ram = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'modretro-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'Game with spaces.GBC');
  const data = Buffer.alloc(32768 * 2 ** sizeCode);
  data.write(title, 0x134, 'ascii');
  if (cgbFlag !== null) data[0x143] = cgbFlag;
  data[0x147] = type; data[0x148] = sizeCode; data[0x149] = ram;
  data[0x14d] = (-data.subarray(0x134, 0x14d).reduce((sum, byte) => sum + byte, 0) - 25) & 255;
  data.writeUInt16BE(data.reduce((sum, byte) => sum + byte, 0) & 65535, 0x14e);
  writeFileSync(path, data);
  return { dir, path, data, rom: inspectRom(path) };
}

class FakeSession {
  constructor(rom, { capacity = 4194304, writable = true, badHeader = false, failWrite = false, failReset = false } = {}) {
    Object.assign(this, { rom, capacity, writable, badHeader, failWrite, failReset });
    this.calls = []; this.warnings = [];
  }
  save() {}
  report = message => this.warnings.push(message);
  run(operation, ...options) {
    this.calls.push({ operation, options });
    if (operation === 'list-devices') return { devices: [{ player: 1 }] };
    if (operation === 'write-homebrew' && this.failWrite) throw new WorkflowError('simulated write failure');
    if (operation === 'reset-device' && this.failReset) throw new WorkflowError('simulated reset failure');
    if (operation === 'detect-cart') return { cartridge: {
      flash: this.writable ? { capacity_bytes: this.capacity } : null,
      header: {
        cartridge_type_code: this.rom.cartridge_type_code, cgb_flag: this.rom.cgb_flag,
        stored_header_checksum: this.rom.header_checksum, header_checksum: 'valid',
        global_checksum: this.rom.global_checksum + Number(this.badHeader), rom_version: this.rom.rom_version,
        rom_size: { bytes: this.rom.size_bytes }, ram_size: { code: this.rom.ram_size_code },
      },
    } };
    return {};
  }
  operations() { return this.calls.map(call => call.operation); }
}
const quiet = { print() {} };
const mustNotAccessDevice = () => { throw new Error('Unexpected CLI/device access'); };

test('inspect a valid generated ROM', t => {
  const { rom } = fixture(t);
  assert.equal(rom.title, 'TEST ROM');
  assert.equal(rom.size_bytes, 32768);
  assert.equal(rom.global_checksum_valid, true);
});

test('larger mapped monochrome ROM with a 16-character title', t => {
  const { rom } = fixture(t, { sizeCode: 3, title: 'SIXTEENCHARTITLE', cgbFlag: null, type: 0x1b, ram: 3 });
  assert.equal(rom.title, 'SIXTEENCHARTITLE');
  assert.equal(rom.size_bytes, 262144);
  assert.equal(rom.global_checksum_valid, true);
  flash(new FakeSession(rom), rom, 1);
});

test('bad header is rejected before device access', async t => {
  const { path, data } = fixture(t);
  data[0x134] ^= 1; writeFileSync(path, data);
  await assert.rejects(main(['flash', path, '--yes'], { ...quiet, sessionFactory: mustNotAccessDevice }), /header checksum/);
});

test('truncated ROM is rejected', t => {
  const { path, data } = fixture(t);
  writeFileSync(path, data.subarray(0, -1));
  assert.throws(() => inspectRom(path), /does not match header/);
});

test('ZIP and other unextracted formats are rejected', t => {
  const { dir } = fixture(t);
  assert.throws(() => inspectRom(join(dir, 'game.zip')), /extracted/);
});

test('corrupted payload blocks writing before device access', async t => {
  const { path, data } = fixture(t);
  data[data.length - 1] = 1; writeFileSync(path, data);
  await assert.rejects(main(['flash', path, '--yes'], { ...quiet, sessionFactory: mustNotAccessDevice }), /Whole-ROM checksum/);
});

test('known stale global checksum can be explicitly allowed', async t => {
  const { path, data } = fixture(t);
  data[data.length - 1] = 1; writeFileSync(path, data);
  assert.equal(await main(['flash', path, '--dry-run', '--allow-invalid-global-checksum'], { ...quiet, sessionFactory: mustNotAccessDevice }), 0);
});

test('dry run needs no CLI and safely quotes paths', async t => {
  const { path, dir } = fixture(t);
  const special = join(dir, "Game's $(literal).gbc");
  writeFileSync(special, readFileSync(path));
  const output = [];
  await main(['flash', special, '--dry-run'], { sessionFactory: mustNotAccessDevice, print: text => output.push(text) });
  assert.match(output[1], /Game'\\''s \$\(literal\)/);
  assert.match(output[2], /no CLI commands or USB/);
});

test('declining confirmation never accesses the device', async t => {
  const { path } = fixture(t);
  assert.equal(await main(['flash', path], { ...quiet, ask: async () => false, sessionFactory: mustNotAccessDevice }), 0);
});

test('flash supplies the exact hash, checks the header, and restores the device', t => {
  const { rom, path } = fixture(t);
  const session = new FakeSession(rom);
  flash(session, rom, 1);
  assert.deepEqual(session.operations(), ['list-devices', 'detect-cart', 'write-homebrew', 'detect-cart', 'reset-device']);
  assert.deepEqual(session.calls[2].options, [realpathSync(path), '--expect-sha256', rom.sha256, '--player', '1']);
});

for (const [name, options, pattern] of [
  ['insufficient capacity', { capacity: 16384 }, /capacity is only/],
  ['unwritable cartridge', { writable: false }, /No supported writable/],
]) test(`${name} prevents writing`, t => {
  const { rom } = fixture(t);
  const session = new FakeSession(rom, options);
  assert.throws(() => flash(session, rom, 1), pattern);
  assert.equal(session.operations().includes('write-homebrew'), false);
  assert.equal(session.operations().at(-1), 'reset-device');
});

test('missing player prevents reset and write', t => {
  const { rom } = fixture(t);
  const session = new FakeSession(rom);
  assert.throws(() => flash(session, rom, 2), /player number 2/);
  assert.deepEqual(session.operations(), ['list-devices']);
});

test('header mismatch reports failure and resets', t => {
  const { rom } = fixture(t);
  const session = new FakeSession(rom, { badHeader: true });
  assert.throws(() => flash(session, rom, 1), /global_checksum/);
  assert.equal(session.operations().at(-1), 'reset-device');
});

test('failed write restores the device and skips verification', t => {
  const { rom } = fixture(t);
  const session = new FakeSession(rom, { failWrite: true });
  assert.throws(() => flash(session, rom, 1), /simulated write failure/);
  assert.deepEqual(session.operations(), ['list-devices', 'detect-cart', 'write-homebrew', 'reset-device']);
});

test('reset failure preserves the original write error', t => {
  const { rom } = fixture(t);
  const session = new FakeSession(rom, { failWrite: true, failReset: true });
  assert.throws(() => flash(session, rom, 1), /simulated write failure/);
  assert.match(session.warnings[0], /reset also failed/);
});

test('reset failure after a successful write is reported', t => {
  const { rom } = fixture(t);
  assert.throws(() => flash(new FakeSession(rom, { failReset: true }), rom, 1), /simulated reset failure/);
});

test('detect restores normal mode without writing', async t => {
  const { rom } = fixture(t);
  const session = new FakeSession(rom);
  await main(['detect', '--yes'], { ...quiet, sessionFactory: () => session });
  assert.deepEqual(session.operations(), ['list-devices', 'detect-cart', 'reset-device']);
});

test('devices lists players without resetting them', async t => {
  const session = new FakeSession(fixture(t).rom);
  await main(['devices'], { ...quiet, sessionFactory: () => session });
  assert.deepEqual(session.operations(), ['list-devices']);
});

test('bad player and command-specific options fail before device access', async t => {
  const { path } = fixture(t);
  await assert.rejects(main(['flash', path, '--player', '0'], quiet), /positive integer/);
  await assert.rejects(main(['detect', '--dry-run'], quiet), /not valid/);
});

function simulatedSession(t, payload, status = 0) {
  const { dir } = fixture(t);
  const calls = [];
  const session = new Session({ cli: 'fake-cli.cjs', root: dir, report() {}, runner(executable, args, options) {
    calls.push({ executable, args, options });
    return args[1] === '--version'
      ? { status: 0, stdout: `chromatic-cli ${CLI_VERSION}\n`, stderr: '' }
      : { status, stdout: typeof payload === 'string' ? payload : JSON.stringify(payload), stderr: '' };
  } });
  return { session, calls };
}

test('zero exit status with an error JSON response still fails', t => {
  const { session, calls } = simulatedSession(t, { schema_version: 1, ok: false, error: { message: 'not activated' } });
  assert.throws(() => session.run('detect-cart', '--all'), /not activated/);
  assert.deepEqual(calls[1].args, ['fake-cli.cjs', 'detect-cart', '--all', '--format', 'json', '--yes']);
  assert.equal(calls[1].options.stdio[0], 'ignore');
});

for (const [name, payload] of [
  ['non-JSON', 'oops'], ['null', null], ['array', []], ['unknown schema', { schema_version: 2 }],
  ['missing result', { schema_version: 1, ok: true, result: null }],
]) test(`unexpected CLI response (${name}) produces a workflow error`, t => {
  const { session } = simulatedSession(t, payload);
  assert.throws(() => session.run('detect-cart'), WorkflowError);
});

test('macOS driver setup makes no external calls', () => {
  installDrivers({ platform: 'darwin', runner: mustNotAccessDevice, report() {} });
});

test('Linux USB setup passes absolute Node and local CLI paths to sudo', () => {
  const calls = [];
  installDrivers({ platform: 'linux', userId: 1000, cli: '/project/local-cli.cjs', runner(...args) {
    calls.push(args); return { status: 0 };
  } });
  assert.equal(calls[0][0], 'sudo');
  assert.deepEqual(calls[0][1], [process.execPath, '/project/local-cli.cjs', 'install-drivers']);
  assert.equal(calls[0][2].stdio, 'inherit');
});

test('Linux root setup does not require sudo', () => {
  let executable;
  installDrivers({ platform: 'linux', userId: 0, cli: 'local-cli.cjs', yes: true, runner(command, args) {
    executable = command; assert.deepEqual(args, ['local-cli.cjs', 'install-drivers', '--yes']);
    return { status: 0 };
  } });
  assert.equal(executable, process.execPath);
});
