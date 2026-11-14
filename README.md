# Fogtrail

A desktop data browser for macOS and Windows. Find your way through your data.

[![Latest release](https://img.shields.io/github/v/release/christiantochen/fogtrail)](https://github.com/christiantochen/fogtrail/releases) [![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue)](#license)

Downloads: https://tools.christiantochen.com/fogtrail

## What it does

Redis (and Redis-compatible servers such as Valkey and Dragonfly) came first, then MySQL and PostgreSQL. The backend is built around a driver trait so other data sources can be added later.

Save connection profiles (host, port, ACL user, database, TLS) with passwords in your system keychain, then browse every common key type read-only: strings (with JSON colors), hashes, lists, sets, sorted sets and streams (with consumer groups). Search and a key-type filter run on the server, keys can be listed by soonest expiry, the folder delimiter is configurable, you can switch databases, and a Server info panel shows version, memory (with a usage bar when a limit is set), clients and keys per database. Valkey and Dragonfly are detected on connect.

MySQL connections (tested with MySQL 8) browse the same way, read-only: pick a database, filter its tables (row counts are the server's estimates, shown with `~`), and read a table's rows 100 at a time or its structure (columns, indexes, foreign keys). Click a heading to sort, type a `WHERE` condition to filter (it is checked like the query editor), and click a row to see it laid out, with JSON over several lines. NULL is shown apart from an empty string. A query editor runs one statement at a time and only reads: `SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN` and `WITH`. Anything else is refused before it is sent. Results stop at 1,000 rows, a statement is stopped after 30 seconds, and a running query can be cancelled. The editor colours keywords, strings, numbers and comments, and suggests table names, column names (for the tables in the statement, fetched only when needed), other databases after `name.`, and SQL keywords as you type. Tab takes the first suggestion, the arrow keys then Enter pick another, Esc closes the list and Ctrl+Space opens it by hand. It is built into the app, with no extra editor library.

PostgreSQL connections (tested with PostgreSQL 16) work the same way, with the differences PostgreSQL has: a connection opens one database, and the sidebar picks a schema inside it (`public` first; built-in schemas are hidden until asked for). Tables, views, materialized views and foreign tables are listed, and the structure shows columns (identity and generated columns too), indexes (partial and expression ones included) and foreign keys. Names are quoted with double quotes, `jsonb` shows as JSON, and `timestamptz` keeps its offset. The query editor runs `SELECT`, `SHOW`, `EXPLAIN`, `VALUES` and `WITH`. The connection form takes a `postgres://` URL and an SSL mode.

Fogtrail follows your system's light or dark setting. To choose one yourself, use View → Theme (System, Light or Dark); the choice is remembered.

## Install

Download the installer for your system from the [latest release](https://github.com/christiantochen/fogtrail/releases/latest):

| Your system                         | File                               |
| ----------------------------------- | ---------------------------------- |
| macOS, Apple Silicon (M1 and newer) | `Fogtrail_<version>_aarch64.dmg`   |
| Windows                             | `Fogtrail_<version>_x64-setup.exe` |

The `.tar.gz`, `.sig` and `latest.json` files in a release are for the in-app updater, not for you to download.

Builds are not code-signed yet, so your OS warns on first launch:

- **macOS:** open the `.dmg`, drag Fogtrail to Applications, then right-click it and choose Open. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine /Applications/Fogtrail.app`.
- **Windows:** run the installer. If SmartScreen appears, choose More info, then Run anyway.

## Develop

Needs Node.js 24 or newer (an `.nvmrc` is included), Rust 1.88 or newer (via [rustup](https://rustup.rs)) and Docker for the local test servers. On macOS you also need the Xcode Command Line Tools; on Windows, the MSVC Build Tools and WebView2 (preinstalled on Windows 10/11). See the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for details.

```sh
npm install
npm run tauri dev
```

Local Redis, Valkey, Dragonfly, MySQL and PostgreSQL servers for testing (ports 6379, 6380, 6381, 3306 and 5432, localhost only):

```sh
docker compose up -d
scripts/seed.sh            # or: scripts/seed.sh valkey | dragonfly
# MySQL (give it a few seconds to start first):
docker compose exec -T mysql mysql -uroot -proot < scripts/seed-mysql.sql
# PostgreSQL (the same wait):
docker compose exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 < scripts/seed-postgres.sql
```

The MySQL and PostgreSQL seeds each create a `shop` database and a read-only user, `fogtrail_ro` (password `ro-test-pw`). Throwaway passwords for a throwaway server. The local PostgreSQL has no certificate, so connect with SSL mode set to Disable.

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

The MySQL tests run against the seeded `shop` database. A second variable, for a user that _can_ write, lets one test prove the server still refuses writes from Fogtrail's session:

```sh
FOGTRAIL_TEST_MYSQL_URL=mysql://fogtrail_ro:ro-test-pw@127.0.0.1:3306/shop \
FOGTRAIL_TEST_MYSQL_RW_URL=mysql://fogtrail_rw:rw-test-pw@127.0.0.1:3306/shop \
cargo test
```

The PostgreSQL tests work the same way:

```sh
FOGTRAIL_TEST_PG_URL=postgres://fogtrail_ro:ro-test-pw@127.0.0.1:5432/shop \
FOGTRAIL_TEST_PG_RW_URL=postgres://fogtrail_rw:rw-test-pw@127.0.0.1:5432/shop \
cargo test
```

## Configuration

| Name                                 | Kind     | Where it's set               | What it's for                                               |
| ------------------------------------ | -------- | ---------------------------- | ----------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | secret   | GitHub repo secret           | Signs the auto-update files                                 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret   | GitHub repo secret           | Password for that key                                       |
| `FOGTRAIL_TEST_REDIS_URL`            | variable | your shell, for `cargo test` | Points the backend integration tests at a throwaway Redis   |
| `FOGTRAIL_TEST_MYSQL_URL`            | variable | your shell, for `cargo test` | Points the MySQL integration tests at a seeded test server  |
| `FOGTRAIL_TEST_MYSQL_RW_URL`         | variable | your shell, for `cargo test` | A user that can write, only to prove the session refuses it |
| `FOGTRAIL_TEST_PG_URL`               | variable | your shell, for `cargo test` | Points the PostgreSQL integration tests at a seeded server  |
| `FOGTRAIL_TEST_PG_RW_URL`            | variable | your shell, for `cargo test` | A role that can write, only to prove the session refuses it |

Names only. Values never go in this repo.

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

## Security

- Read-only by design: the backend only exposes read commands, and the Redis driver only sends read commands.
- MySQL is read-only in layers. Every connection starts a read-only session, so the server itself refuses writes. The query editor checks each statement first and refuses more than one statement, anything but `SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN` and `WITH`, `SELECT ... INTO`, row locks (`FOR UPDATE`) and `/*! */` comments, which the server would run. The table browser only builds `SELECT` statements itself, and a filter you type into it is checked as part of the whole statement before it is sent. For the strongest guarantee, connect with a user that can only read (the connection form shows this too): `CREATE USER 'fogtrail'@'%' IDENTIFIED BY '<password>'; GRANT SELECT, SHOW VIEW ON your_database.* TO 'fogtrail'@'%';`
- PostgreSQL is read-only in layers too. Every connection defaults to read-only transactions, and every statement the app sends runs inside its own `BEGIN READ ONLY`, which is rolled back afterwards, so it also holds behind a connection pooler. The query editor refuses more than one statement, anything but `SELECT`, `SHOW`, `EXPLAIN`, `VALUES` and `WITH`, row locks, and functions that change state or reach outside the database (`set_config`, `pg_terminate_backend`, advisory locks, large objects, server-side file reads, `dblink`). A statement is stopped after 30 seconds. For the strongest guarantee, connect with a role that can only read (the connection form shows this too): `CREATE ROLE fogtrail LOGIN PASSWORD '<password>'; GRANT CONNECT ON DATABASE your_database TO fogtrail; GRANT USAGE ON SCHEMA public TO fogtrail; GRANT SELECT ON ALL TABLES IN SCHEMA public TO fogtrail;`
- With TLS on, MySQL certificates and host names are verified. There is no "skip verification" switch.
- PostgreSQL has an SSL mode instead. The default, Require, encrypts the connection but does not check who answers, as `sslmode=require` does in other tools. Choose Verify full to check the certificate and host name. Disable sends everything unencrypted, which is only for local servers.
- Passwords live in the OS keychain, never in the saved connections file.
- The webview runs under a strict content security policy: scripts, styles and fonts from the app only, no remote content, and IPC as the only connection it can open.
- For servers you don't fully trust the credentials of, connect with an ACL user limited to reading, for example `ACL SETUSER fogtrail on >password ~* +@read +info +scan +type +ttl +memory|usage +xinfo -@dangerous`.

## Releases

Releases are cut from commit messages ([Conventional Commits](https://www.conventionalcommits.org)):

| Prefix                                                   | Release                           |
| -------------------------------------------------------- | --------------------------------- |
| `feat:`                                                  | minor (0.2.0 to 0.3.0)            |
| `fix:`, `perf:`                                          | patch (0.3.0 to 0.3.1)            |
| `feat!:` or a `BREAKING CHANGE:` footer                  | minor below 1.0, major from 1.0   |
| `chore:`, `docs:`, `ci:`, `test:`, `refactor:`, `style:` | none, they ride along in the next |

A dependency bump that changes the shipped app (a security fix, say) should be written as `fix(deps): ...` so it releases.

After CI passes on `main`, the **Prepare release** workflow reads the commits since the last tag. If any is a `feat:` or `fix:` (and the last release is over a day old), it bumps the version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and `src-tauri/tauri.conf.json`, writes `CHANGELOG.md`, commits `chore(release): vX.Y.Z`, tags it and starts the **Release** workflow. That builds macOS (Apple Silicon) and Windows installers into a **draft** release whose notes are the changelog entry. Review the draft on GitHub, then publish.

To release on demand, for example after a pile of housekeeping, open Actions, choose **Prepare release**, Run workflow, and pick `patch`, `minor` or `major` (or `auto`). Tick **dry run** to see the plan without tagging anything. From a terminal: `gh workflow run prepare-release.yml -f bump=patch`.

Locally, `npm run release -- --dry-run` prints the next version and changelog entry without changing files.

## Layout

```
src/            React + TypeScript UI
  api/          typed wrappers around Tauri commands, TanStack Query hooks
  lib/          pure helpers (key tree, formatting), unit tested
  state/        UI state (Zustand)
  components/   sidebar, key tree, value viewers
src-tauri/      Rust backend
  src/commands/ Tauri commands, the only way the UI reaches the backend
  src/drivers/  Driver traits, the Redis, MySQL and PostgreSQL drivers
  src/sql_guard.rs  Decides which statements the query editor may send
  tests/        integration tests against a real server
  capabilities/ Tauri permission files
scripts/        dev helpers
```

## License

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
