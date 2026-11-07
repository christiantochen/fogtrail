# Fogtrail

A desktop data browser for macOS and Windows. Find your way through your data.

Redis (and Redis-compatible servers such as Valkey and Dragonfly) comes first. The backend is built around a driver trait so other data sources can be added later.

**Status:** Phase 4. Save connection profiles (host, port, ACL user, database, TLS) with passwords in your system keychain, then browse every common key type read-only: strings (with JSON colors), hashes, lists, sets, sorted sets and streams (with consumer groups). Search runs on the server, the folder delimiter is configurable, you can switch databases, and a Server info panel shows version, memory, clients and keys per database. Valkey and Dragonfly are detected on connect.

## Prerequisites

- Rust (via [rustup](https://rustup.rs)), 1.85 or newer
- Node.js 24 or newer (an `.nvmrc` is included)
- macOS: Xcode Command Line Tools
- Windows: MSVC Build Tools and WebView2 (preinstalled on Windows 10/11)
- Docker, for the local test servers

See the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for details.

## Install

Download the installer for your system from the [latest release](https://github.com/christiantochen/fogtrail/releases/latest):

| Your system                         | File                               |
| ----------------------------------- | ---------------------------------- |
| macOS, Apple Silicon (M1 and newer) | `Fogtrail_<version>_aarch64.dmg`   |
| macOS, Intel                        | `Fogtrail_<version>_x64.dmg`       |
| Windows                             | `Fogtrail_<version>_x64-setup.exe` |

The `.tar.gz`, `.sig` and `latest.json` files in a release are for the in-app updater, not for you to download.

Builds are not code-signed yet, so your OS warns on first launch:

- **macOS:** open the `.dmg`, drag Fogtrail to Applications, then right-click it and choose Open. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine /Applications/Fogtrail.app`.
- **Windows:** run the installer. If SmartScreen appears, choose More info, then Run anyway.

## Getting started

```sh
npm install
npm run tauri dev
```

Local Redis, Valkey and Dragonfly servers for testing (ports 6379, 6380 and 6381, localhost only):

```sh
docker compose up -d
scripts/seed.sh            # or: scripts/seed.sh valkey | dragonfly
```

## Keyboard shortcuts

Use Cmd on macOS and Ctrl on Windows.

| Shortcut             | Action                                            |
| -------------------- | ------------------------------------------------- |
| Cmd/Ctrl + F         | Search keys (or press `/`)                        |
| Cmd/Ctrl + R         | Refresh keys, value and server info               |
| Cmd/Ctrl + I         | Show or hide server info                          |
| Cmd/Ctrl + N         | New connection                                    |
| Cmd/Ctrl + Shift + O | Back to connections                               |
| Arrow keys           | Move through the key list, open and close folders |

The window remembers its size and position between launches.

## Scripts

| Command                | What it does                           |
| ---------------------- | -------------------------------------- |
| `npm run tauri dev`    | Run the app with hot reload            |
| `npm run tauri build`  | Build installers for the current OS    |
| `npm run build`        | Type-check and build the frontend only |
| `npm test`             | Frontend unit tests (Vitest)           |
| `npm run lint`         | ESLint                                 |
| `npm run format`       | Prettier (write)                       |
| `npm run format:check` | Prettier (check only)                  |

For the Rust side, run `cargo fmt` and `cargo clippy` inside `src-tauri/`.

Backend integration tests need a real server and skip without one. They flush the target database, so use a throwaway one:

```sh
FOGTRAIL_TEST_REDIS_URL=redis://127.0.0.1:6379/15 cargo test
```

## Layout

```
src/            React + TypeScript UI
  api/          typed wrappers around Tauri commands, TanStack Query hooks
  lib/          pure helpers (key tree, formatting), unit tested
  state/        UI state (Zustand)
  components/   sidebar, key tree, value viewers
src-tauri/      Rust backend
  src/commands/ Tauri commands, the only way the UI reaches the backend
  src/drivers/  Driver trait and the Redis driver
  tests/        integration tests against a real server
  capabilities/ Tauri permission files
scripts/        dev helpers
```

## Security

- Read-only by design: the backend only exposes read commands, and the Redis driver only sends read commands.
- Passwords live in the OS keychain, never in the saved connections file.
- The webview runs under a strict content security policy: scripts, styles and fonts from the app only, no remote content, and IPC as the only connection it can open.
- For servers you don't fully trust the credentials of, connect with an ACL user limited to reading, for example `ACL SETUSER fogtrail on >password ~* +@read +info +scan +type +ttl +memory|usage +xinfo -@dangerous`.

## Roadmap

0. Setup (done)
1. First end-to-end slice: scan keys, show a value (done)
2. Connection profiles, keychain passwords, TLS and ACL users (done)
3. Browsing UX: streams, server info, database switcher, search (done)
4. Desktop polish: menus, shortcuts, window state, hardening (done)
5. Release pipeline, auto-update, cluster mode

## Releasing

Releases are cut from commit messages ([Conventional Commits](https://www.conventionalcommits.org)):

| Prefix                                                   | Release                           |
| -------------------------------------------------------- | --------------------------------- |
| `feat:`                                                  | minor (0.2.0 to 0.3.0)            |
| `fix:`, `perf:`                                          | patch (0.3.0 to 0.3.1)            |
| `feat!:` or a `BREAKING CHANGE:` footer                  | minor below 1.0, major from 1.0   |
| `chore:`, `docs:`, `ci:`, `test:`, `refactor:`, `style:` | none, they ride along in the next |

A dependency bump that changes the shipped app (a security fix, say) should be written as `fix(deps): ...` so it releases.

After CI passes on `main`, the **Prepare release** workflow reads the commits since the last tag. If any is a `feat:` or `fix:` (and the last release is over a day old), it bumps the version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and `src-tauri/tauri.conf.json`, writes `CHANGELOG.md`, commits `chore(release): vX.Y.Z`, tags it and starts the **Release** workflow. That builds macOS (Apple Silicon and Intel) and Windows installers into a **draft** release whose notes are the changelog entry. Review the draft on GitHub, then publish.

To release on demand, for example after a pile of housekeeping, open Actions, choose **Prepare release**, Run workflow, and pick `patch`, `minor` or `major` (or `auto`). Tick **dry run** to see the plan without tagging anything. From a terminal: `gh workflow run prepare-release.yml -f bump=patch`.

Locally, `npm run release -- --dry-run` prints the next version and changelog entry without changing files.

## License

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
