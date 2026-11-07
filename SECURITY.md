# Security policy

## Reporting a vulnerability

Please report it privately, not in a public issue. On GitHub, open the
repository's **Security** tab and choose **Report a vulnerability**. Include the
version, your operating system, and the steps to reproduce.

You can expect a first reply within a week. Once a fix is released, the report
can be made public with credit to you, if you want it.

## Supported versions

Only the latest release gets fixes. Fogtrail is pre-1.0, so upgrade to the
newest version before reporting.

## What Fogtrail does with your data

- It is read-only. It never writes to the server you connect to.
- Passwords are stored in the operating system keychain, never in a file.
- The only other network traffic is the update check against GitHub Releases.
  Updates are verified against a public key built into the app before they are
  installed.
- Release builds are not yet code-signed for macOS or Windows, so your OS will
  warn on first launch. Download only from this repository's releases page.

## In scope

- Anything that lets a server, a key's contents or a connection URL run code or
  read files on your computer.
- Leaking saved passwords out of the keychain, or writing them to disk or logs.
- Bypassing the update signature check.

Problems in Redis or in the operating system itself are out of scope; report
those to their own projects.
