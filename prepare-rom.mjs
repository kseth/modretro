#!/usr/bin/env node
/** Create an explicit metadata-only ROM copy without accessing the CLI or USB. */
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT, WorkflowError, inspectRom } from './modretro.mjs';

const digest = (data, algorithm = 'sha256') => createHash(algorithm).update(data).digest('hex');
const expand = path => resolve(path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);

export function prepareRomCopy(filename, { output } = {}) {
  const source = inspectRom(filename);
  if (!source.global_checksum_valid) {
    throw new WorkflowError('Source whole-ROM checksum is invalid; refusing to repair or disguise a damaged file.');
  }
  const original = readFileSync(source.path);
  if (digest(original) !== source.sha256) throw new WorkflowError('Source changed during inspection; retry with a stable file.');
  const extension = extname(source.path);
  const outputPath = expand(output ?? join(ROOT, 'roms', `${basename(source.path, extension)}.devday-copy${extension}`));
  if (!['.gb', '.gbc'].includes(extname(outputPath).toLowerCase())) {
    throw new WorkflowError('Output must have a .gb or .gbc extension.');
  }
  const manifestPath = `${outputPath}.json`;
  const copy = Buffer.from(original);
  // This is a local metadata marker, not a claim that the game is a newer release.
  copy[0x14c] = (original[0x14c] + 1) & 255;
  let headerChecksum = 0;
  for (let address = 0x134; address <= 0x14c; address++) headerChecksum = (headerChecksum - copy[address] - 1) & 255;
  copy[0x14d] = headerChecksum;
  let globalChecksum = 0;
  for (let address = 0; address < copy.length; address++) {
    if (address !== 0x14e && address !== 0x14f) globalChecksum = (globalChecksum + copy[address]) & 65535;
  }
  copy.writeUInt16BE(globalChecksum, 0x14e);
  const changes = [];
  for (let offset = 0; offset < copy.length; offset++) {
    if (original[offset] !== copy[offset]) {
      if (offset < 0x14c || offset > 0x14f) throw new WorkflowError('Unexpected change outside revision/checksum metadata.');
      changes.push({ offset, address: `0x${offset.toString(16)}`, before: original[offset], after: copy[offset] });
    }
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const created = [];
  const handles = [];
  try {
    // Exclusive creation also rejects existing files, symlinks, and aliases of the source.
    const outputHandle = openSync(outputPath, 'wx', 0o600);
    created.push(outputPath); handles.push(outputHandle);
    const manifestHandle = openSync(manifestPath, 'wx', 0o600);
    created.push(manifestPath); handles.push(manifestHandle);
    writeFileSync(outputHandle, copy);
    const prepared = inspectRom(outputPath);
    if (prepared.sha256 !== digest(copy) || !prepared.global_checksum_valid) {
      throw new WorkflowError('Copy verification failed.');
    }
    const manifest = {
      schema_version: 1, operation: 'prepare-rom-copy', created_at: new Date().toISOString(),
      strategy: 'increment_revision_and_recompute_checksums', manifest_path: manifestPath,
      source: { ...source, sha1: digest(original, 'sha1') },
      copy: { ...prepared, sha1: digest(copy, 'sha1') }, changes,
      unchanged: { bytes_outside_0x014c_through_0x014f: true, size: true },
      cli_filter: 'not_tested_by_this_command', hardware: 'not_accessed', gameplay: 'not_tested',
    };
    writeFileSync(manifestHandle, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } catch (error) {
    // Remove only files created by this invocation, including a partial copy if its report fails.
    for (const handle of handles.splice(0)) closeSync(handle);
    for (const path of created) unlinkSync(path);
    throw error;
  } finally {
    for (const handle of handles) closeSync(handle);
  }
}

export function main(argv = process.argv.slice(2), { print = console.log } = {}) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    output: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    print('Usage: npm run prepare -- /path/to/game.gbc [--output /path/to/copy.gbc] [--json]\nCreates a revision/checksum-only copy plus a JSON manifest; defaults to ignored roms/.\nNever overwrites files or invokes the CLI/device. Gameplay and CLI acceptance remain untested.');
    return 0;
  }
  if (positionals.length !== 1) throw new WorkflowError('Provide exactly one extracted .gb or .gbc source file.');
  const manifest = prepareRomCopy(positionals[0], { output: values.output });
  print(values.json ? JSON.stringify(manifest, null, 2) :
    `Copy: ${manifest.copy.path}\nManifest: ${manifest.manifest_path}\nChanged ${manifest.changes.length} revision/checksum bytes; original preserved.\nNo CLI or USB access. Passing a fingerprint check would not establish cartridge compatibility or playability.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
}
