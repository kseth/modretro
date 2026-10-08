# ModRetro DevDay cartridge tools

Inspect and flash local Game Boy / Game Boy Color ROMs from Node/npm using the
official Chromatic CLI. **Flashing targets the writable demo cartridge included
with the Codex / OpenAI DevDay Chromatic.** Use stock ModRetro firmware; no
ChatGPT/Codex desktop app or plugin is needed.

No ROMs are included. Keep original and paid downloads separately, such as in
`~/Downloads`, and supply extracted `.gb` or `.gbc` files.

## Requirements

- Node.js 20+ and npm; Git to clone onto another laptop.
- Official Chromatic firmware and **Developer Mode activated for each computer**.
- For hardware commands: a powered-on Chromatic, a data-capable USB-C cable, and
  the supplied DevDay demo cartridge inserted.
- Network access for npm installation and vendor runtime downloads.

The Node code is portable; hardware support depends on the
[vendor CLI binaries](https://www.npmjs.com/package/@modretro/chromatic-cli):

| Platform | Hardware support | USB setup |
| --- | --- | --- |
| macOS, Apple silicon or Intel | Supported | No extra drivers |
| Linux with glibc, ARM64 or x86-64 | Supported | `npm run drivers` installs udev rules via sudo |
| BSD, musl Linux/Alpine, other architectures | No matching vendor binary | Offline tools only |

The vendor also supplies Windows binaries; Windows hardware use is untested here.

## Set up each computer

1. Install Node/npm and check `node --version` and `npm --version`.
2. Download the [official Chromatic Firmware Updater](https://support.modretro.com/en_us/chromatic-firmware-updater-ryhoYnzCx).
   Power on and connect the Chromatic, then follow the updater's firmware prompts.
   Wait for completion before unplugging it.
3. **Activate Developer Mode.** In the updater, press **Cmd-I** on macOS
   (**Ctrl-I** otherwise) and enter the provided DevDay activation code. See the
   [DevDay quickstart](https://support.modretro.com/en_us/chromatic-devday-edition-quickstart-guid-By1iOlcMg).
4. Quit the updater to free USB access. From this repository, run:

   ```sh
   npm ci
   npm run drivers                 # macOS: no action; Linux: sudo + vendor prompts
   npm run devices                 # Confirm the connected player number
   ```

The GUI updater supports macOS 12+, Windows x86-64, and Linux x86-64. Its Linux
build requires glibc 2.39+ and additional libraries; follow the linked platform
instructions. A Linux ARM64 CLI binary does not imply an ARM64 GUI updater.
If necessary, update firmware on a supported computer first.

CLI activation is an alternative for a computer that still needs Developer Mode:

```sh
npm run cli -- activate 'YOUR_ACTIVATION_CODE'
```

Cloning does not transfer activation. On Linux, reconnect after installing USB
rules if needed; flashing itself does not require root. The vendor's Windows
driver installer requires an Administrator terminal.

The project pins CLI **1.2.1** in `package.json` and `package-lock.json`. `npm ci`
installs the matching binary in `node_modules/`; no global CLI is needed. The
local npm cache lives in `tools/npm-cache/`. Dependency install scripts are
disabled; firmware setup, activation, and USB rules are explicit steps.

## Inspect and flash

Inspect a ROM offline, without an installed CLI or connected device:

```sh
npm run inspect -- "/path/to/game.gbc"
```

The report describes banking, memory, saves, clocks, color mode, and special
hardware requirements, then compares them with the demo cartridge profile:

| Status | Flash behavior |
| --- | --- |
| `supported` | Can proceed after confirmation and the connected chip check |
| `unknown` | Requires an explicit `--allow-unknown-compatibility` trial |
| `incompatible` | Always stops |

The initial profile records successful play of **the exact Sun's Dojo v3 ROM**
on firmware 4.6: 32 KiB, ROM ONLY, no banking or cartridge RAM. Other ROMs,
including other ROM-only games, remain unknown. MBC5 banking, RAM, saves, clocks,
and peripheral support need independent evidence. A successful write does not
establish playability. See [compatibility and verification](docs/compatibility.md).

Before writing, these properties must match the
[DevDay profile](cartridges/devday-demo.json):

| Property | Required value |
| --- | --- |
| Make / model | ISSI `IS29GL032-70TLET-TR` |
| Capacity | 4,194,304 bytes (4 MiB) |
| Sector size | 65,536 bytes (64 KiB) |

**Use the actual included demo cartridge.** Its flash chip does not uniquely
identify the PCB or prove mapper/RAM support. Other flash chips and ordinary
retail cartridges are outside this workflow's flashing scope.

With setup complete and the Chromatic connected, check the inserted chip:

```sh
npm run check -- "/path/to/game.gbc" --player 1
```

`check` resets the running game but never writes a ROM. Save first. Choose the
player shown by `npm run devices` if multiple Chromatics are connected.

For a supported ROM, preview the command or flash it:

```sh
npm run flash -- "/path/to/game.gbc" --dry-run
npm run flash -- "/path/to/game.gbc" --player 1
```

For a deliberate trial of unknown requirements, add the override to both commands:

```sh
npm run flash -- "/path/to/game.gbc" --dry-run --allow-unknown-compatibility
npm run flash -- "/path/to/game.gbc" --player 1 --allow-unknown-compatibility
```

**Flashing replaces the cartridge ROM.** Save first and retain its original ROM
file for restoration; CLI 1.2.1 has no exposed backup command. Type `yes` at the
prompt, or add `--yes` for automation. `--yes` confirms replacement/reset only;
compatibility remains unknown when an override is used.

Dry runs apply the offline gates without CLI/USB access. Actual flashing checks
the chip, capacity, checksums, selected player, and expected host SHA-256, then
compares the cartridge header and chip again. A reset is attempted after success
or failure. **Full-ROM readback, gameplay, and save persistence are not verified.**

## Optional ROM metadata preparation

To create a separate local copy for development/testing with `write-homebrew`:

```sh
npm run prepare -- "/path/to/game.gbc"
```

This produces `roms/game.devday-copy.gbc` and a `.gbc.json` manifest containing
source/copy hashes, headers, requirements, and every byte difference. Use
`--output "/path/to/copy.gbc"` to choose another destination. Existing files and
symlinks are rejected. The original and vendor CLI remain untouched; preparation
runs offline without USB access.

Only the revision byte at `0x014C` is incremented (wrapping at 255), and checksums
at `0x014D–0x014F` are recomputed. All other bytes remain identical. Both source
checksums must already be valid. Repeating preparation on the original produces
identical ROM bytes.

The revision marks a local copy. Changing it changes the file hashes and can
affect the CLI's released-title classification; it does not make a commercial
game homebrew. Header-reading games and CLI acceptance need separate testing.
Inspect and flash the copy using the same workflow and compatibility checks above.
See [Pan Docs' header fields](https://github.com/gbdev/pandocs/blob/master/src/The_Cartridge_Header.md#014c--mask-rom-version-number).

## Commands and troubleshooting

| Command | Purpose |
| --- | --- |
| `npm run devices` | List players without resetting |
| `npm run detect -- --player 1` | Reset, inspect cartridge, restore game mode |
| `npm run inspect -- "game.gbc" --json` | Offline metadata and compatibility as JSON |
| `npm run check -- "game.gbc" --json` | Connected chip/compatibility check as JSON |
| `npm run help` | Workflow options |
| `npm run cli -- --help` | Direct access to the pinned vendor CLI |

- Missing CLI/version mismatch: run `npm ci`.
- No device: check power/data cable and run `npm run devices`.
- Linux USB permissions: run `npm run drivers`, then reconnect.
- Download failure: allow access to npm and ModRetro's firmware service.
- Unknown compatibility: review requirements and evidence before a deliberate trial.
- Chip mismatch: insert the supplied DevDay demo cartridge; overrides retain chip checks.
- `rom.released_title_denied`: the CLI matched the file's SHA-1 to its released-title
  list. This is separate from header validity, activation, and cartridge compatibility.
- Write/validation failure: inspect `logs/`; keep USB connected during a write.
- Utility screen remains: `npm run cli -- reset-device --player 1`.

## Verification and sharing

Run `npm test` for offline tests using generated buffers and simulated CLI
responses. No hardware or game downloads are involved. Detailed checks, exit
codes, hardware test limits, and profile maintenance are in
[compatibility and verification](docs/compatibility.md).

Hardware operations write raw CLI results to `logs/`; flashes also record
`compatibility.json` and `verification.json`. These distinguish host/header
checks from unavailable full-flash readback and untested gameplay/saves.

Git excludes ROMs, local copies/manifests in `roms/`, logs, `node_modules/`,
`tools/`, and `downloads/`. Keep those directories out of shared ZIPs too;
archiving a folder does not apply `.gitignore`. On another laptop, clone the
source, run `npm ci`, and repeat firmware/activation/USB setup. ROMs and activation
are supplied separately; vendor runtime downloads still require network access.
