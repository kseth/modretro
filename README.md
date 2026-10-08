# Flash the Codex / OpenAI DevDay demo cartridge from the terminal

A Node/npm workflow for flashing local Game Boy / Game Boy Color ROMs with the
official Chromatic CLI. **Flashing targets the writable demo cartridge supplied
with the Codex / OpenAI DevDay Chromatic**, using the observed ISSI
`IS29GL032-70TLET-TR` flash chip. Use stock ModRetro firmware. No Python,
Codex/ChatGPT desktop application, or plugin is needed.

No game ROMs are included. Keep paid downloads separately (for example in
`~/Downloads`) and pass their paths to the tool.

## Requirements and platforms

- Node.js 20 or newer with npm; Git to clone onto another laptop.
- A Chromatic with current official firmware, and Developer Mode activated for
  the computer that will flash it.
- For hardware commands: the Chromatic powered on, connected with a data-capable
  USB-C cable, and the included DevDay writable demo cartridge inserted.
- Network access for npm installation and the CLI's Cart Clinic firmware downloads.

The Node code uses portable built-in APIs. Hardware support depends on the
[official CLI's binaries](https://www.npmjs.com/package/@modretro/chromatic-cli):

| Platform | CLI support | USB setup |
| --- | --- | --- |
| macOS, Apple silicon or Intel | Supported | No extra drivers |
| Linux with glibc, ARM64 or x86-64 | Supported | `npm run drivers` installs udev rules via sudo |
| BSD, musl Linux (such as standard Alpine), other CPU architectures | No matching vendor binary | Offline inspection/tests only |

The vendor also provides Windows binaries. This workflow's setup instructions
target macOS and Linux; Windows hardware use has not been tested here.

## Demo cartridge scope and compatibility

The bundled [cartridge profile](cartridges/devday-demo.json) records the flash
identity observed on our DevDay demo cartridge:

| Property | Required value |
| --- | --- |
| Make | ISSI |
| Model | `IS29GL032-70TLET-TR` |
| Capacity | 4,194,304 bytes (4 MiB) |
| Sector size | 65,536 bytes (64 KiB) |

Before writing, all four properties must match. A larger flash chip or another
model is also rejected; compatibility overrides cannot bypass this check. **Use
the actual included demo cartridge.** A matching flash chip does not uniquely
identify its PCB or establish mapper/RAM capabilities. This workflow does not
support writing arbitrary flash cartridges or ordinary retail game cartridges.
Offline inspection can describe any local GB/GBC ROM.

Inspection decodes mapper/banking, ROM banks, memory kind/capacity, persistent
saves, real-time clock, color mode, and special hardware. MBC2's internal
512-by-4-bit memory and MBC7's EEPROM/accelerometer are handled separately from
the RAM-size byte. Unknown/reserved codes stay unknown. Impossible addressing
or header combinations are incompatible. Rumble/infrared are reported as
optional features for basic play.

Requirements are compared with independent profile evidence, **never the header
of the game currently flashed on the cartridge**:

| Status | Meaning | Flash behavior |
| --- | --- | --- |
| `supported` | Required capabilities are documented/tested for the profile, or this exact ROM has the relevant recorded test evidence | Can proceed after confirmation and the connected chip check |
| `unknown` | At least one required capability has no established evidence | Stops unless `--allow-unknown-compatibility` is explicitly supplied |
| `incompatible` | Capacity, chip identity, header addressing, or a known capability does not meet requirements | Always stops; overrides do not bypass it |

The initial profile establishes only the chip data and successful play of the
**exact Sun's Dojo v3 SHA-256** recorded in the profile, on firmware 4.6. This
game uses 32 KiB ROM ONLY, no banking, and no cartridge RAM. Only metadata and
test evidence are stored; the paid ROM is excluded. Other ROMs—including other
ROM-only games—remain unknown with the initial profile. Generic mapper, RAM,
save persistence, RTC, and peripheral support have not been established.
`supported` describes the scope of the recorded evidence; it does not guarantee
every scene or behavior of a game, or future firmware behavior.

Save any current game before detection or flashing. Flashing replaces the
cartridge ROM. CLI 1.2.1 has no exposed ROM-backup command, so retain the original
ROM file to restore it later.

## Prepare each laptop and the device

1. Install Node/npm and check `node --version` and `npm --version`.
2. Download the [official Chromatic Firmware Updater](https://support.modretro.com/en_us/chromatic-firmware-updater-ryhoYnzCx)
   for a supported computer. Its published builds cover macOS (12 or later),
   Windows x86-64, and Linux x86-64. Follow its platform-specific dependencies;
   the Linux GUI updater requires glibc 2.39+ and additional libraries. The Linux
   CLI's ARM64 support does not imply an ARM64 build of the GUI updater.
3. Power on and connect the Chromatic, open the updater, and follow the prompts
   to update official firmware. Wait for completion before unplugging it.
4. **Activate Developer Mode for this computer.** In the updater, press **Cmd-I**
   on macOS (**Ctrl-I** otherwise) and enter the DevDay activation code. See the
   [official DevDay quickstart](https://support.modretro.com/en_us/chromatic-devday-edition-quickstart-guid-By1iOlcMg).
   Cloning the repository does not transfer activation.
5. Quit the updater before using the CLI, to avoid competing USB access. Install
   this project's CLI dependency, configure Linux USB access, and activate via
   the CLI if needed, as shown below.

On a laptop without a supported GUI updater build, update the device firmware on
a supported computer first, then use the CLI activation command on the laptop
that will flash it. Activation is per computer; the GUI and CLI are alternative
ways to enter the provided activation code.

## Install once per clone

From the repository directory:

```sh
npm ci
npm run drivers                 # macOS: no action; Linux: sudo + vendor prompts
npm run devices                 # Confirm connection and player number
```

`package.json` pins `@modretro/chromatic-cli` to **1.2.1**, and
`package-lock.json` records its dependencies and integrity hashes. npm selects the
matching platform binary automatically. Installation uses the normal project
`node_modules/` directory; a globally installed CLI is not needed or used.
`.npmrc` keeps the npm cache in `tools/npm-cache/` and disables dependency install
scripts. Explicit commands such as `npm test` and `npm run flash` still run.

Linux USB setup installs the vendor's udev rules and may ask for a sudo password.
Reconnect the device afterward if needed. You do not need to run flashing as root.
Firmware update/activation and Linux USB rules remain machine/device setup steps;
`npm ci` does not perform them or write to the device.

If this computer still needs Developer Mode activation:

```sh
npm run cli -- activate 'YOUR_ACTIVATION_CODE'
```

`npm run cli -- ...` invokes the project's pinned vendor CLI directly. Its driver
installer can also be used from an Administrator terminal on Windows.

## Flash a ROM

Inspect or preview without CLI/USB access:

```sh
npm run inspect -- "/path/to/game.gbc"
npm run flash -- "/path/to/game.gbc" --dry-run
```

Inspection prints readable requirements and an offline compatibility report.
For machine-readable metadata, requirements, and the same report:

```sh
node modretro.mjs inspect "/path/to/game.gbc" --json
```

Offline reports are conditional on the demo profile; they cannot identify an
inserted cartridge. `--dry-run` applies the same offline gates as flashing and
previews the **wrapper** command. It does not bypass unknown compatibility or
claim to have checked USB/chip identity.

Complete device preparation above. With the powered-on Chromatic connected and
the DevDay demo cartridge inserted, check the actual chip without writing a ROM:

```sh
npm run check -- "/path/to/game.gbc" --player 1
```

This detection **resets the running game**; save first and confirm when prompted.
It restores normal device mode afterward and never calls `write-homebrew`.
`check` exits 0 for supported requirements with a valid global checksum, 2 for
unknown compatibility, and 1 for incompatibility/invalid checksum/errors. `inspect`
exits 0 when inspection succeeds even if compatibility is unknown/incompatible.
Cancellation exits 0. Use `--json` with `check` for machine-readable results.

Flash a supported ROM:

```sh
npm run flash -- "/path/to/game.gbc" --player 1
```

Type `yes` to allow the reset and ROM replacement. Add `--yes` for noninteractive
use. The `--` after the npm script name passes arguments to our tool.

To deliberately try a ROM with **unknown** cartridge requirements:

```sh
npm run flash -- "/path/to/game.gbc" --dry-run --allow-unknown-compatibility
npm run flash -- "/path/to/game.gbc" --player 1 --allow-unknown-compatibility
```

`--yes` only confirms replacement/reset; it does not allow unknown compatibility.
The separate compatibility override leaves the status unknown and is logged.
It cannot supply missing hardware or establish playability/save support.

The tool checks header/file size/checksums and offline compatibility, confirms
the player and demo chip profile, then writes with `--expect-sha256`. It requires
CLI responses to name the expected operation, and the write result to name the
expected player and host ROM SHA-256.
It detects the cartridge again to compare the chip profile and header fields,
then resets it to the normal FPGA image. A reset is also attempted after a
detection, write, or verification failure.

Verification compares the cartridge's ROM size, type, color flag, version, RAM-size
code, and stored checksum fields. The CLI's returned SHA-256 also identifies the
**host file**; it is not a hash read back from the cartridge. CLI 1.2.1 has no
exposed full-ROM readback command, so full-byte verification/backup would require
additional vendor support or a suitable cartridge reader. ZIP files must be
extracted first.

Each flash records `compatibility.json` and `verification.json` alongside raw CLI
results. The verification record distinguishes checked chip/player/host-hash and
header fields from **unavailable full-flash readback** and **untested gameplay/save
persistence**. Partial/failing runs retain the checks completed before failure;
a failure does not roll back an already started cartridge write.

For a known stale whole-ROM checksum, use `--allow-invalid-global-checksum`.
An invalid header checksum or inconsistent file length always stops the tool;
files are never patched. See the [Game Boy header specification](https://github.com/gbdev/pandocs/blob/master/src/The_Cartridge_Header.md).

Other commands:

```sh
npm run devices                 # Lists players without resetting
npm run detect -- --player 1    # Resets, inspects, restores game mode
npm run help
npm run cli -- --help
```

Choose the player shown by `devices` if several Chromatics are connected.
Direct `node modretro.mjs ...` invocation also works. Inspection, dry runs, and
tests need only Node, so they can run before `npm ci` and without an activated or
connected device.

## Local artifacts and sharing

| Path | Purpose |
| --- | --- |
| `modretro.mjs`, `compatibility.mjs`, `package.json`, `package-lock.json`, `.npmrc` | Reusable Node workflow, requirement decoding, and dependency configuration |
| `cartridges/devday-demo.json` | Observed demo chip identity, capability evidence, and exact-ROM test metadata |
| `tests/` | Offline Node tests using generated data, never game files |
| `node_modules/` | Local vendor CLI installation |
| `tools/` | npm cache and CLI temporary files |
| `logs/` | Per-operation commands, results, ROM paths/hashes, and headers |
| `downloads/` | Historical CLI archives from the initial setup |

`.gitignore` excludes ROMs, binaries, downloads, caches, and logs. Original run
artifacts are in `logs/initial-session/`. Keep these local directories out of any
shared ZIP; archiving a folder does not apply Git ignore rules.

On another laptop, clone the source, run `npm ci`, and repeat device/activation/USB
setup. ROMs, activation, and installed dependencies are not transferred by Git.
The official CLI downloads vendor-selected runtime firmware, so this is an
online workflow rather than a complete offline firmware bundle.

## Troubleshooting and verification

- Missing CLI or version mismatch: run `npm ci`.
- No device: check power, USB data cable, and `npm run devices`.
- Linux permission errors: run `npm run drivers`, then reconnect the device.
- Download failure: allow access to npm and ModRetro's firmware service.
- Unknown compatibility: inspect the requirements and profile evidence. Only a
  deliberate trial should use `--allow-unknown-compatibility`.
- Demo chip mismatch: insert the supplied DevDay demo cartridge; overrides do
  not authorize another flash chip.
- Validation/write failure: check the printed error and log directory. Keep USB
  connected while a write is running.
- Utility screen remains: `npm run cli -- reset-device --player 1`.

```sh
npm test
```

Tests use generated buffers and simulated CLI responses, including Linux driver
setup, mapper/RAM/RTC/sensor requirements, compatibility gates, chip mismatches,
and wrong-player/hash write responses. No hardware is accessed. The original
write was exercised on macOS with CLI 1.2.1, Chromatic firmware 4.6, and a 32 KiB
ROM on the DevDay cartridge. The
new compatibility checks and Node wrapper have been tested offline; hardware
flashing through this revision and Linux hardware use have not been tested here.

### Extending cartridge evidence

Missing/null capabilities mean unknown; `true` means established support and
`false` means established lack of support. Update the profile only with a cited
vendor/board specification or a documented hardware test. Record the device
firmware, CLI version, cartridge identity, ROM hash/header configuration, test
steps, and results. Another cartridge with the same chip is not automatically
covered by this profile.

For an exact-ROM test, add metadata to `tested_roms` and mark only independently
verified entries in `checks`: `mapper`, `memory`, `ram_capacity`,
`persistent_save`, `rtc`, `accelerometer`, `camera`, or `special_hardware`. Merely
booting a banked game does not prove banking or memory correctness; exercise
progression/test patterns. Confirm persistent saves after powering off and back
on. Clock/sensor support requires exercising those features. Leave anything
untested unknown, and do not copy ROM bytes into Git. A game-specific result
does not establish generic support for its mapper family.

ROM requirements follow [Pan Docs' cartridge header](https://github.com/gbdev/pandocs/blob/master/src/The_Cartridge_Header.md),
with [MBC2 memory](https://github.com/gbdev/pandocs/blob/master/src/MBC2.md),
[MBC3/MBC30 addressing](https://github.com/gbdev/pandocs/blob/master/src/MBC3.md), and
[MBC7 memory/sensor](https://github.com/gbdev/pandocs/blob/master/src/MBC7.md)
details from their dedicated chapters. Those specifications describe what a ROM
expects, not what our demo cartridge physically provides.
