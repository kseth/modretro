# ModRetro cartridge flashing from the terminal

A Node/npm workflow for flashing local Game Boy / Game Boy Color ROMs with the
official Chromatic CLI. Use stock ModRetro firmware and a compatible writable
cartridge. No Python, Codex/ChatGPT desktop application, or plugin is needed.

No game ROMs are included. Keep paid downloads separately (for example in
`~/Downloads`) and pass their paths to the tool.

## Requirements and platforms

- Node.js 20 or newer with npm; Git to clone onto another laptop.
- A Chromatic with current official firmware, and Developer Mode activated for
  the computer that will flash it.
- For hardware commands: the Chromatic powered on, connected with a data-capable
  USB-C cable, and a supported writable cartridge inserted.
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

The DevDay cartridge used to establish this workflow has a 4 MiB ISSI
`IS29GL032-70TLET-TR` flash chip. Capacity is checked each time. A ROM must also
match the cartridge's mapper, RAM, and other features; fitting in flash does not
establish game compatibility. Ordinary retail cartridges cannot be overwritten.

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

Complete device preparation above. With the powered-on Chromatic connected and
the writable cartridge inserted:

```sh
npm run flash -- "/path/to/game.gbc" --player 1
```

Type `yes` to allow the reset and ROM replacement. Add `--yes` for noninteractive
use. The `--` after the npm script name passes arguments to our tool.

The tool checks header/file size/checksums, confirms the player and flash capacity,
then writes with `--expect-sha256`. It detects the cartridge again to compare
header fields and resets it to the normal FPGA image. A reset is also attempted
after a detection, write, or verification failure.

Verification compares the cartridge's ROM size, type, color flag, version, RAM-size
code, and stored checksum fields. It does not read back and hash all flash bytes;
the SHA-256 identifies the host ROM. ZIP files must be extracted first.

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
| `modretro.mjs`, `package.json`, `package-lock.json`, `.npmrc` | Reusable Node workflow and dependency configuration |
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
- Validation/write failure: check the printed error and log directory. Keep USB
  connected while a write is running.
- Utility screen remains: `npm run cli -- reset-device --player 1`.

```sh
npm test
```

Tests use generated buffers and simulated CLI responses, including Linux driver
setup. No hardware is accessed. The original write was exercised on macOS with
CLI 1.2.1, Chromatic firmware 4.6, and a 32 KiB ROM on the DevDay cartridge. The
Node wrapper has been tested offline; Linux hardware flashing has not been tested
here. Game/mapper compatibility depends on the cartridge and official CLI.
