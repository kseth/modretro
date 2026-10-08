import assert from 'node:assert/strict';
import test from 'node:test';
import { assessCompatibility, decodeRequirements, DEMO_CARTRIDGE } from '../compatibility.mjs';
import { assertCompatibility } from '../modretro.mjs';

// Header metadata only; no game bytes, files, CLI processes, or USB access.
const rom = overrides => ({
  sha256: '1'.repeat(64), size_bytes: 32768, cartridge_type_code: 0,
  ram_size_code: 0, cgb_flag: 0x80, ...overrides,
});
const profile = changes => {
  const result = structuredClone(DEMO_CARTRIDGE);
  Object.assign(result.capabilities, changes);
  return result;
};

test('demo profile records observed chip data without inventing mapper/save support', () => {
  assert.deepEqual(DEMO_CARTRIDGE.flash, {
    make: 'ISSI', model: 'IS29GL032-70TLET-TR', capacity_bytes: 4194304, sector_size_bytes: 65536,
  });
  assert.deepEqual(DEMO_CARTRIDGE.capabilities.mappers, {});
  assert.equal(DEMO_CARTRIDGE.capabilities.persistent_save, null);
  assert.equal(DEMO_CARTRIDGE.capabilities.rtc, null);
});

test('ROM-only header requires neither external RAM nor a persistent save', () => {
  const requirements = decodeRequirements(rom());
  assert.equal(requirements.mapper, 'ROM ONLY');
  assert.deepEqual(requirements.memory, { kind: 'none', bytes: 0 });
  assert.equal(requirements.persistent_save, false);
  assert.equal(requirements.rom_banks, 2);
});

test('MBC1 RAM and save requirements are decoded into capacities and names', () => {
  const requirements = decodeRequirements(rom({ cartridge_type_code: 0x03, ram_size_code: 3, size_bytes: 262144 }));
  assert.equal(requirements.cartridge_type, 'MBC1+RAM+BATTERY');
  assert.deepEqual(requirements.memory, { kind: 'sram', bytes: 32768 });
  assert.equal(requirements.persistent_save, true);
  assert.equal(requirements.rtc, false);
});

test('MBC2 RAM size zero still requires 512 four-bit cells and optional battery-backed persistence', () => {
  for (const type of [0x05, 0x06]) {
    const requirements = decodeRequirements(rom({ cartridge_type_code: type, size_bytes: 262144 }));
    assert.deepEqual(requirements.memory, { kind: 'mbc2', bytes: 256, cells: 512, bits_per_cell: 4 });
    assert.equal(requirements.persistent_save, type === 0x06);
  }
});

test('only MBC3 timer types require a clock', () => {
  for (const type of [0x0f, 0x10, 0x11, 0x12, 0x13]) {
    const requirements = decodeRequirements(rom({ cartridge_type_code: type }));
    assert.equal(requirements.rtc, [0x0f, 0x10].includes(type));
  }
});

test('larger MBC3 ROM or RAM requirements identify the MBC30 variant', () => {
  for (const changed of [{ ram_size_code: 5 }, { size_bytes: 4194304, ram_size_code: 3 }]) {
    const candidate = rom({ cartridge_type_code: 0x10, ...changed });
    assert.equal(decodeRequirements(candidate).mapper, 'MBC30');
    assert.deepEqual(decodeRequirements(candidate).issues, []);
    assert.equal(assessCompatibility(candidate).status, 'unknown');
  }
});

test('MBC7 RAM size zero still requires EEPROM and an accelerometer', () => {
  const requirements = decodeRequirements(rom({ cartridge_type_code: 0x22 }));
  assert.deepEqual(requirements.memory, { kind: 'eeprom', bytes: 256 });
  assert.equal(requirements.accelerometer, true);
  assert.equal(requirements.persistent_save, true);
  assert.deepEqual(requirements.optional_features, []);
});

test('color mode uses the header flag, including monochrome titles using byte 0x143', () => {
  assert.equal(decodeRequirements(rom({ cgb_flag: 0xc0 })).color_mode, 'GBC required');
  assert.equal(decodeRequirements(rom()).color_mode, 'GB and GBC enhanced');
  assert.equal(decodeRequirements(rom({ cgb_flag: 0x41 })).color_mode, 'GB monochrome');
  assert.equal(decodeRequirements(rom({ cgb_flag: 0x81 })).unknowns.length, 1);
});

test('reserved RAM codes are unknown rather than silently becoming zero or 2 KiB', () => {
  for (const ram of [1, 0xff]) {
    const requirements = decodeRequirements(rom({ cartridge_type_code: 0x02, ram_size_code: ram }));
    assert.equal(requirements.memory.bytes, null);
    assert.match(requirements.unknowns.join(' '), /reserved or unknown/);
    assert.equal(assessCompatibility(rom({ cartridge_type_code: 0x02, ram_size_code: ram })).status, 'unknown');
  }
});

test('unknown cartridge types and special hardware remain unknown, with explicit reasons', () => {
  const report = assessCompatibility(rom({ cartridge_type_code: 0x77 }));
  assert.equal(report.status, 'unknown');
  assert.equal(report.requirements.mapper, 'UNKNOWN');
  assert.equal(report.requirements.special_hardware, true);
  assert.match(report.reasons.join(' '), /not decoded/);
});

test('a matching chip does not turn unknown mapper requirements into support', () => {
  const report = assessCompatibility(rom({ cartridge_type_code: 0x01 }), { cartridge: { flash: DEMO_CARTRIDGE.flash } });
  assert.equal(report.hardware_match, 'matched');
  assert.equal(report.status, 'unknown');
});

test('the currently stored ROM header never supplies cartridge capabilities', () => {
  const candidate = rom({ cartridge_type_code: 0x10, ram_size_code: 3 });
  const cartridge = { flash: DEMO_CARTRIDGE.flash, header: { cartridge_type_code: 0x10, ram_size: { bytes: 32768 } } };
  const report = assessCompatibility(candidate, { cartridge });
  assert.equal(report.status, 'unknown');
  assert.match(report.reasons.join(' '), /persistent save/);
  assert.match(report.reasons.join(' '), /rtc/);
});

test('only the exact Sun’s Dojo hash and header configuration use the recorded play evidence', () => {
  const evidence = DEMO_CARTRIDGE.tested_roms[0];
  const tested = rom({ sha256: evidence.sha256, cgb_flag: 0xc0 });
  assert.equal(assessCompatibility(tested).status, 'supported');
  assert.equal(assessCompatibility(tested).hardware_match, 'not_checked');
  for (const changed of [{ sha256: '2'.repeat(64) }, { cgb_flag: 0x80 }, { cartridge_type_code: 0x01 }]) {
    assert.equal(assessCompatibility({ ...tested, ...changed }).status, 'unknown');
  }
});

test('a generic ROM-only file is not labeled as independently tested', () => {
  const report = assessCompatibility(rom());
  assert.equal(report.status, 'unknown');
  assert.equal(report.tested_rom, null);
});

test('an exact-ROM mapper test alone does not establish RAM or persistent saves', () => {
  const candidate = rom({ cartridge_type_code: 0x03, ram_size_code: 3 });
  const caps = profile({});
  caps.tested_roms.push({ sha256: candidate.sha256, rom_bytes: candidate.size_bytes,
    cartridge_type_code: candidate.cartridge_type_code, ram_size_code: candidate.ram_size_code,
    cgb_flag: candidate.cgb_flag, checks: { mapper: true } });
  const report = assessCompatibility(candidate, { profile: caps });
  assert.equal(report.checks.find(check => check.requirement === 'mapper').status, 'supported');
  assert.equal(report.status, 'unknown');
  assert.match(report.reasons.join(' '), /persistent save/);
});

test('missing/null capabilities mean unknown and explicit false means incompatible', () => {
  for (const value of [undefined, null, false, true]) {
    const report = assessCompatibility(rom(), { profile: profile({ mappers: { 'ROM ONLY': value } }) });
    assert.equal(report.status, value === true ? 'supported' : value === false ? 'incompatible' : 'unknown');
  }
});

test('known memory capacity, persistence, clock, and mapper support are all needed for a save/clock ROM', () => {
  const candidate = rom({ cartridge_type_code: 0x10, ram_size_code: 3 });
  const supported = profile({ mappers: { MBC3: true }, memory: { sram: true }, max_ram_bytes: 32768, persistent_save: true, rtc: true });
  assert.equal(assessCompatibility(candidate, { profile: supported }).status, 'supported');
  for (const [feature, value] of [['rtc', null], ['persistent_save', null], ['max_ram_bytes', null], ['memory', {}]]) {
    const partial = structuredClone(supported);
    partial.capabilities[feature] = value;
    assert.equal(assessCompatibility(candidate, { profile: partial }).status, 'unknown');
  }
  supported.capabilities.max_ram_bytes = 8192;
  assert.equal(assessCompatibility(candidate, { profile: supported }).status, 'incompatible');
});

test('a missing clock or motion sensor is incompatible even when mapper and memory are supported', () => {
  const caps = profile({ mappers: { MBC3: true, MBC7: true }, memory: { sram: true, eeprom: true }, max_ram_bytes: 32768,
    persistent_save: true, rtc: false, accelerometer: false });
  for (const candidate of [rom({ cartridge_type_code: 0x10, ram_size_code: 3 }), rom({ cartridge_type_code: 0x22 })]) {
    const report = assessCompatibility(candidate, { profile: caps });
    assert.equal(report.status, 'incompatible');
    assert.throws(() => assertCompatibility(report, true), /Incompatible/);
  }
});

test('optional rumble support does not block basic play and is reported as a limitation', () => {
  const candidate = rom({ cartridge_type_code: 0x1c });
  const caps = profile({ mappers: { MBC5: true }, rumble: false });
  const report = assessCompatibility(candidate, { profile: caps });
  assert.equal(report.status, 'supported');
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /rumble/);
});

for (const [name, candidate] of [
  ['ROM-only banking', rom({ size_bytes: 65536 })],
  ['ROM-only external RAM', rom({ ram_size_code: 2 })],
  ['MBC2 external RAM', rom({ cartridge_type_code: 0x06, ram_size_code: 2 })],
  ['MBC2 ROM addressing', rom({ cartridge_type_code: 0x06, size_bytes: 524288 })],
  ['MBC1 RAM addressing', rom({ cartridge_type_code: 0x03, ram_size_code: 4 })],
  ['MBC30 RAM addressing', rom({ cartridge_type_code: 0x10, ram_size_code: 4 })],
  ['MBC5 rumble RAM addressing', rom({ cartridge_type_code: 0x1e, ram_size_code: 4 })],
]) test(`impossible header combination (${name}) cannot be overridden`, () => {
  const report = assessCompatibility(candidate);
  assert.equal(report.status, 'incompatible');
  assert.throws(() => assertCompatibility(report, true), /Incompatible/);
});

test('unknown compatibility needs a separate explicit override', () => {
  const report = assessCompatibility(rom({ cartridge_type_code: 0x01 }));
  assert.throws(() => assertCompatibility(report), /--yes does not override/);
  assert.doesNotThrow(() => assertCompatibility(report, true));
});

test('recorded play evidence cannot override an explicitly unsupported mapper', () => {
  const candidate = rom({ sha256: DEMO_CARTRIDGE.tested_roms[0].sha256, cgb_flag: 0xc0 });
  const report = assessCompatibility(candidate, { profile: profile({ mappers: { 'ROM ONLY': false } }) });
  assert.equal(report.status, 'incompatible');
});
