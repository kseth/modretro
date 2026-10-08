# Compatibility and verification reference

See the [README](../README.md) for setup and flashing commands. This reference
describes how reports are interpreted and how cartridge evidence is maintained.

## Compatibility evidence

The [demo profile](../cartridges/devday-demo.json) records the observed ISSI
`IS29GL032-70TLET-TR` flash identity, 4 MiB capacity, and 64 KiB sectors. All four
properties must match before writing, even with compatibility overrides. A
matching flash chip does not uniquely identify the cartridge PCB; use the actual
included DevDay demo cartridge.

Requirements are compared with independent evidence, never inferred from the
header of the currently flashed game. Missing or null capabilities mean unknown;
`true` means established support and `false` means established lack of support.

| Status | Meaning |
| --- | --- |
| `supported` | Required capabilities have evidence, or this exact ROM has the relevant recorded checks |
| `unknown` | At least one required capability has no established evidence |
| `incompatible` | Capacity, chip identity, header addressing, or a known capability fails a requirement |

Only the exact Sun's Dojo v3 SHA-256 and header configuration recorded in the
profile have play evidence, on macOS with CLI 1.2.1 and firmware 4.6. The game
uses 32 KiB ROM ONLY and no cartridge RAM. This does not establish banking, RAM,
save, RTC, or peripheral support, or support for other ROM-only files. A
`supported` result describes recorded evidence, not every scene or future
firmware behavior. The paid ROM is excluded from Git.

Inspection decodes mapper/banking, ROM banks, memory type/capacity, persistent
saves, RTC, color mode, and special hardware. MBC2's 512-by-4-bit memory and MBC7's
EEPROM/accelerometer are handled separately from the RAM-size byte. Reserved or
unknown codes stay unknown. Impossible addressing/header combinations are
incompatible. Rumble and infrared are optional for basic play.

## Validation and exit codes

Inspection requires an extracted `.gb` or `.gbc`, a file length matching its ROM
size code, and a valid header checksum. It also computes the whole-ROM checksum.
Inspection and flashing never patch files.

Flashing stops on an invalid whole-ROM checksum unless
`--allow-invalid-global-checksum` explicitly allows a known stale checksum. An
invalid header checksum or inconsistent file length always stops the workflow.
The separate `prepare` command requires both source checksums to be valid.

| Command | Exit codes |
| --- | --- |
| `inspect` | 0 on successful inspection, including unknown/incompatible reports; 1 on an error |
| `check` | 0 for supported requirements with a valid global checksum; 2 for unknown compatibility; 1 for incompatibility, invalid checksum, or an error |
| Cancelled confirmation | 0 |

`check --json` reports machine-readable results. A connected check resets the
running game, reads the cartridge, and attempts to restore normal mode; it never
calls `write-homebrew`. Dry runs use the same offline flash gates and preview
the wrapper command without validating USB or the inserted chip.

## What flashing verifies

1. Confirm the requested player and detect the cartridge.
2. Match the demo chip profile, capacity, and compatibility requirements.
3. Write with `--expect-sha256`; require a valid CLI schema/operation and the
   expected player and host-file SHA-256 in its result.
4. Detect again and compare chip identity and header fields: ROM size/type,
   color flag, revision, RAM-size code, stored header checksum, checksum validity,
   and stored global checksum.
5. Attempt to reset the device to normal FPGA mode, including after a failure.

The returned SHA-256 identifies the **host file**, not ROM bytes read back from
flash. CLI 1.2.1 has no exposed full-ROM readback/backup command; full-byte
verification would need vendor support or a suitable cartridge reader. Retain
the original ROM for restoration.

Logs retain raw commands/results plus `compatibility.json` and
`verification.json`. Partial runs record completed checks; a failed operation
does not roll back an already started write. Gameplay and save persistence remain
untested by the flashing workflow. Review raw reset results when diagnosing a
failed run.

## Test scope

`npm test` uses generated ROM buffers and simulated CLI responses. Tests cover
mapper/memory/clock/sensor requirements, compatibility gates, Linux driver setup,
chip mismatches, CLI schema/operation checks, wrong-player/hash responses,
reset attempts, and copy preparation/preservation. No hardware is accessed.

The original Sun's Dojo write/play was exercised on macOS with CLI 1.2.1 and
firmware 4.6. Hardware flashing through the current wrapper and Linux/Windows
hardware use have not been tested here.

Separate disconnected-device probes with CLI 1.2.1 returned
`rom.released_title_denied` for two original files and `device.player_not_found`
for prepared copies using absent player 255. Wrong expected SHA-256 values still
returned `rom.sha256_mismatch`. These confirm observed classification and
host-hash checks only, not a cartridge write or gameplay. The preparation command
and offline test suite do not perform these network-dependent probes.

## Extending the profile

Update capabilities only from a cited board/vendor specification or documented
hardware testing. Record firmware and CLI versions, cartridge identity, ROM
hash/header configuration, test steps, and results. Another PCB with the same
chip is not automatically covered.

For an exact-ROM test, add metadata to `tested_roms` and mark only verified
`checks`: `mapper`, `memory`, `ram_capacity`, `persistent_save`, `rtc`,
`accelerometer`, `camera`, or `special_hardware`. Exercise banking/progression
rather than treating boot as proof. Confirm saves after powering off and back on;
test clock/sensor behavior directly. Leave untested capabilities unknown. A
game-specific result does not establish generic mapper support. Store metadata,
not ROM bytes.

Requirements follow [Pan Docs' cartridge header](https://github.com/gbdev/pandocs/blob/master/src/The_Cartridge_Header.md),
[MBC2 memory](https://github.com/gbdev/pandocs/blob/master/src/MBC2.md),
[MBC3/MBC30 addressing](https://github.com/gbdev/pandocs/blob/master/src/MBC3.md), and
[MBC7 memory/sensors](https://github.com/gbdev/pandocs/blob/master/src/MBC7.md).
These describe what a ROM expects, not what the demo cartridge provides.
