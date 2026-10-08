/** Header requirements and evidence-based compatibility; no CLI or USB access. */
import { readFileSync } from 'node:fs';

export const DEMO_CARTRIDGE = JSON.parse(readFileSync(new URL('./cartridges/devday-demo.json', import.meta.url), 'utf8'));
const RAM_SIZES = new Map([[0, 0], [2, 8192], [3, 32768], [4, 131072], [5, 65536]]);
// Names/flags: Pan Docs, The Cartridge Header. MBC2/MBC7 memory follows
// their dedicated chapters rather than assuming header RAM=0 means no memory.
const TYPES = new Map([
  [0x00, ['ROM ONLY', 'ROM ONLY']],
  [0x01, ['MBC1', 'MBC1']], [0x02, ['MBC1+RAM', 'MBC1', 'ram']], [0x03, ['MBC1+RAM+BATTERY', 'MBC1', 'ram', 'save']],
  [0x05, ['MBC2', 'MBC2']], [0x06, ['MBC2+BATTERY', 'MBC2', 'save']],
  [0x08, ['ROM+RAM', 'ROM ONLY', 'ram']], [0x09, ['ROM+RAM+BATTERY', 'ROM ONLY', 'ram', 'save']],
  [0x0b, ['MMM01', 'MMM01']], [0x0c, ['MMM01+RAM', 'MMM01', 'ram']], [0x0d, ['MMM01+RAM+BATTERY', 'MMM01', 'ram', 'save']],
  [0x0f, ['MBC3+TIMER+BATTERY', 'MBC3', 'save', 'rtc']], [0x10, ['MBC3+TIMER+RAM+BATTERY', 'MBC3', 'ram', 'save', 'rtc']],
  [0x11, ['MBC3', 'MBC3']], [0x12, ['MBC3+RAM', 'MBC3', 'ram']], [0x13, ['MBC3+RAM+BATTERY', 'MBC3', 'ram', 'save']],
  [0x19, ['MBC5', 'MBC5']], [0x1a, ['MBC5+RAM', 'MBC5', 'ram']], [0x1b, ['MBC5+RAM+BATTERY', 'MBC5', 'ram', 'save']],
  [0x1c, ['MBC5+RUMBLE', 'MBC5', 'rumble']], [0x1d, ['MBC5+RUMBLE+RAM', 'MBC5', 'ram', 'rumble']],
  [0x1e, ['MBC5+RUMBLE+RAM+BATTERY', 'MBC5', 'ram', 'save', 'rumble']],
  [0x20, ['MBC6', 'MBC6', 'special']],
  // Real MBC7 hardware has an accelerometer and EEPROM; the historical
  // header table's RUMBLE label does not establish a rumble motor.
  [0x22, ['MBC7+ACCELEROMETER+EEPROM', 'MBC7', 'save', 'accelerometer']],
  [0xfc, ['POCKET CAMERA', 'POCKET CAMERA', 'ram', 'save', 'camera']],
  [0xfd, ['BANDAI TAMA5', 'BANDAI TAMA5', 'save', 'rtc', 'special']],
  [0xfe, ['HuC3', 'HuC3', 'ram', 'save', 'rtc', 'infrared']],
  [0xff, ['HuC1+RAM+BATTERY', 'HuC1', 'ram', 'save', 'infrared']],
]);
const code = value => `0x${value.toString(16).padStart(2, '0')}`;

export function decodeRequirements(rom) {
  const type = TYPES.get(rom.cartridge_type_code);
  const [cartridgeType, baseMapper, ...flags] = type ?? [`Unknown type ${code(rom.cartridge_type_code)}`, 'UNKNOWN'];
  const has = flag => flags.includes(flag);
  const issues = [];
  const unknowns = [];
  const headerRam = RAM_SIZES.get(rom.ram_size_code);
  if (headerRam === undefined) unknowns.push(`RAM size code ${code(rom.ram_size_code)} is reserved or unknown; its capacity cannot be inferred.`);
  if (!type) unknowns.push(`Cartridge type ${code(rom.cartridge_type_code)} is not decoded.`);
  if (headerRam > 0 && type && !has('ram') && !has('special') && baseMapper !== 'MBC7') {
    issues.push(`${cartridgeType} must not declare external RAM (header declares ${headerRam} bytes).`);
  }
  let memory = { kind: has('ram') ? 'sram' : 'none', bytes: has('ram') ? (headerRam ?? null) : 0 };
  if (baseMapper === 'MBC2') memory = { kind: 'mbc2', bytes: 256, cells: 512, bits_per_cell: 4 };
  if (baseMapper === 'MBC7') memory = { kind: 'eeprom', bytes: 256 };
  if (!type || has('special')) memory = { kind: 'unknown', bytes: null };
  // MBC30 shares MBC3 type codes, but doubles ROM/RAM addressing limits.
  const mapper = baseMapper === 'MBC3' && (headerRam > 32768 || rom.size_bytes > 2097152) ? 'MBC30' : baseMapper;
  const maxRom = { 'ROM ONLY': 32768, MBC1: 2097152, MBC2: 262144, MBC3: 2097152, MBC30: 4194304, MBC5: 8388608, MBC7: 2097152 }[mapper];
  if (maxRom && rom.size_bytes > maxRom) issues.push(`${mapper} cannot address this ${rom.size_bytes}-byte ROM (maximum ${maxRom} bytes).`);
  const maxRam = { 'ROM ONLY': 8192, MBC1: 32768, MBC3: 32768, MBC30: 65536, MBC5: has('rumble') ? 65536 : 131072 }[mapper];
  if (maxRam && headerRam > maxRam) issues.push(`${mapper} cannot address the declared ${headerRam}-byte RAM (maximum ${maxRam} bytes).`);
  if ((rom.cgb_flag & 0x80) && ![0x80, 0xc0].includes(rom.cgb_flag)) unknowns.push(`Nonstandard CGB mode flag ${code(rom.cgb_flag)} needs review.`);
  return {
    cartridge_type: cartridgeType, mapper, rom_banks: rom.size_bytes / 16384,
    color_mode: rom.cgb_flag & 0x80 ? (rom.cgb_flag & 0x40 ? 'GBC required' : 'GB and GBC enhanced') : 'GB monochrome',
    memory, persistent_save: has('save'), rtc: has('rtc'),
    accelerometer: has('accelerometer'), camera: has('camera'), special_hardware: has('special') || !type,
    optional_features: ['rumble', 'infrared'].filter(has), issues, unknowns,
  };
}

export function assessCompatibility(rom, { profile = DEMO_CARTRIDGE, cartridge } = {}) {
  // Recompute from header metadata; never infer physical capabilities from
  // cartridge.header (the previously stored game's declared requirements).
  const requirements = decodeRequirements(rom);
  const checks = [];
  const add = (requirement, status, detail, required = true) => checks.push({ requirement, status, detail, required });
  const capabilities = profile.capabilities;
  const tested = profile.tested_roms.find(test => test.sha256 === rom.sha256
    && test.rom_bytes === rom.size_bytes && test.cartridge_type_code === rom.cartridge_type_code
    && test.ram_size_code === rom.ram_size_code && test.cgb_flag === rom.cgb_flag);
  const capability = (name, value, detail, required = true) => {
    // An exact-ROM test may resolve unknown support, but cannot override an
    // explicitly unsupported capability or a chip/header/capacity mismatch.
    const supported = value ?? (tested?.checks[name] === true ? true : null);
    const evidence = supported === true ? (value === true ? 'Established in the profile.' : 'Verified for this exact ROM only.')
      : supported === false ? 'The profile explicitly marks this capability unsupported.' : 'Capability has not been established for the demo cartridge.';
    add(name, supported === true ? 'supported' : supported === false ? 'incompatible' : 'unknown', `${detail} ${evidence}`, required);
  };
  add('flash_capacity', rom.size_bytes <= profile.flash.capacity_bytes ? 'supported' : 'incompatible',
    `${rom.size_bytes} ROM bytes; demo profile has ${profile.flash.capacity_bytes} flash bytes.`);
  let hardwareMatch = 'not_checked';
  if (cartridge !== undefined) {
    const flash = cartridge?.flash;
    const mismatches = Object.keys(profile.flash).filter(key => flash?.[key] !== profile.flash[key]);
    hardwareMatch = mismatches.length ? 'mismatched' : 'matched';
    add('cartridge_identity', mismatches.length ? 'incompatible' : 'supported', mismatches.length
      ? `Inserted cartridge does not match the demo flash profile: ${mismatches.join(', ')}.`
      : 'Detected make, model, capacity, and sector size match. This is not a unique PCB identity.');
  }
  for (const issue of requirements.issues) add('header_requirements', 'incompatible', issue);
  for (const unknown of requirements.unknowns) add('header_requirements', 'unknown', unknown);
  capability('mapper', capabilities.mappers[requirements.mapper], `${requirements.mapper} mapper required.`);
  if (requirements.memory.kind !== 'none' && requirements.memory.bytes !== 0) {
    capability('memory', capabilities.memory[requirements.memory.kind], `${requirements.memory.kind} storage required (${requirements.memory.bytes ?? 'unknown'} bytes).`);
    if (requirements.memory.bytes === null || capabilities.max_ram_bytes == null) {
      capability('ram_capacity', null, 'Save/work-memory capacity has not been established.');
    } else add('ram_capacity', requirements.memory.bytes <= capabilities.max_ram_bytes ? 'supported' : 'incompatible',
      `${requirements.memory.bytes} bytes required; profile allows ${capabilities.max_ram_bytes} bytes.`);
  }
  for (const feature of ['persistent_save', 'rtc', 'accelerometer', 'camera', 'special_hardware']) {
    if (requirements[feature]) capability(feature, capabilities[feature], `${feature.replaceAll('_', ' ')} is required by this header.`);
  }
  for (const feature of requirements.optional_features) capability(feature, capabilities[feature], `${feature} is optional for basic play.`, false);
  const required = checks.filter(check => check.required);
  const status = required.some(check => check.status === 'incompatible') ? 'incompatible'
    : required.some(check => check.status === 'unknown') ? 'unknown' : 'supported';
  return {
    profile_id: profile.id, profile_name: profile.name, status, hardware_match: hardwareMatch,
    requirements, checks,
    reasons: required.filter(check => check.status !== 'supported').map(check => check.detail),
    warnings: checks.filter(check => !check.required && check.status !== 'supported').map(check => check.detail),
    tested_rom: tested ?? null,
    scope: 'Compatibility is conditional on the actual DevDay demo cartridge. It is not full-flash readback or a gameplay/save test of this run.',
  };
}

export function formatInspection(rom, compatibility) {
  const needs = compatibility.requirements;
  const memory = needs.memory.kind === 'mbc2' ? 'MBC2 internal RAM, 512 four-bit cells (256 bytes)'
    : `${{ sram: 'cartridge SRAM', eeprom: 'cartridge EEPROM' }[needs.memory.kind] ?? needs.memory.kind}, ${needs.memory.bytes ?? 'unknown'} bytes`;
  return [
    `ROM: ${rom.title || '(untitled)'} (${rom.size_bytes} bytes)`,
    `SHA-256: ${rom.sha256}`,
    `Hardware: ${needs.cartridge_type}; ${needs.rom_banks} ROM banks; ${needs.color_mode}`,
    `Memory: ${memory}; persistent save: ${needs.persistent_save}; clock: ${needs.rtc}`,
    `Special hardware: ${['accelerometer', 'camera', 'special_hardware'].filter(key => needs[key]).join(', ') || 'none declared'}`,
    `Optional features: ${needs.optional_features.join(', ') || 'none declared'}`,
    `Global checksum: ${rom.global_checksum_valid ? 'valid' : 'INVALID (flash requires a separate checksum override)'}`,
    `Compatibility: ${compatibility.status.toUpperCase()} — ${compatibility.profile_name}`,
    `Chip profile check: ${compatibility.hardware_match.replaceAll('_', ' ')}${compatibility.hardware_match === 'not_checked' ? ' (offline)' : ''}`,
    ...compatibility.reasons.map(reason => `  - ${reason}`),
    ...compatibility.warnings.map(warning => `  - Optional feature: ${warning}`),
    compatibility.tested_rom ? `Play evidence: ${compatibility.tested_rom.boot_and_play}` : 'Play evidence: this exact ROM has not been tested here.',
    compatibility.scope,
  ].join('\n');
}
