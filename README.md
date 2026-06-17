# touchenv

Keychain-aware [dotenvx](https://dotenvx.com) for macOS: decrypt your `.env` with the dotenvx private key stored behind **Touch ID** instead of sitting in a plaintext `.env.keys` on disk. **No Apple Developer cert required**, and it's a plain dotenvx passthrough off macOS so it never breaks CI/Linux builds.

```bash
touchenv run --convention=nextjs -- next dev   # Touch ID, then dotenvx run …
touchenv decrypt                               # any dotenvx command works
```

## Install

```bash
npm install github:0arm/touchenv      # or: bun add github:0arm/touchenv
npm install -g github:0arm/touchenv   # global, use `touchenv` anywhere
```

Installs on **any platform** — the Swift helper compiles lazily on first use, so nothing native runs at install time. The keychain features need **macOS** with Touch ID and the **Xcode Command Line Tools** (`xcode-select --install`).

## How `touchenv` works

`touchenv <args…>` forwards everything to the real `dotenvx` (project-local if present, else on `PATH`). Before doing so, *when opted in*, it fetches `DOTENV_PRIVATE_KEY` from the macOS Keychain behind a Touch ID prompt and exports it, so dotenvx decrypts with it.

- **Opt-in** via a gate env var (default `DOTENV_USE_KEYCHAIN`), checked in the environment then `.env.local` / `.env`. Not truthy → no prompt, plain passthrough.
- **Non-macOS** → keychain skipped entirely, plain passthrough. Safe on Vercel/Linux (dotenvx uses its normal key resolution — e.g. a `DOTENV_PRIVATE_KEY` env var).
- **Zero config by convention** — `service` = `"<package-name>-dotenv"`, `account` = `DOTENV_PRIVATE_KEY`, `gate` = `DOTENV_USE_KEYCHAIN`. Override per project in `package.json`:

```jsonc
"touchenv": { "service": "my-svc", "account": "DOTENV_PRIVATE_KEY", "gate": "USE_KEYCHAIN" }
```

A typical `package.json`:

```jsonc
"scripts": {
  "dev": "touchenv run --convention=nextjs -- next dev",
  "build": "touchenv run -- next build"
}
```

## Seeding the keychain

Use the `keychain` subcommand for raw access (no dotenvx involved):

```bash
# store the dotenvx private key (read it out of .env.keys, then drop it from there)
grep '^DOTENV_PRIVATE_KEY=' .env.keys | cut -d= -f2- | touchenv keychain set -s my-app-dotenv DOTENV_PRIVATE_KEY

touchenv keychain get -s my-app-dotenv DOTENV_PRIVATE_KEY
```

`touchenv keychain run -s <service> <account> [--as VAR] [--gate ENV] -- <cmd…>` is the generic primitive `touchenv` is built on: fetch one secret (Touch ID), export it as `VAR`, exec `<cmd>`.

## JS API

```js
import { Keychain } from 'touchenv'

const kc = new Keychain({ service: 'my-app-dotenv' })
await kc.set('API_KEY', 'secret')   // Touch ID
const key = await kc.get('API_KEY') // Touch ID
```

## Security model (honest)

macOS's built-in `security` CLI can't gate items on Touch ID — biometric items need the data-protection keychain (provisioning-profile'd app bundle). So this uses the **legacy keychain + the trusted-application ACL**: the helper creates the item, so only its code identity is trusted; `security find-generic-password` gets a deny-able prompt instead of silent access, and the helper runs a `LocalAuthentication` check before reading. Items are stored `WhenUnlockedThisDeviceOnly` (never synced to iCloud).

This is *user-presence* protection, not an unbypassable vault: a process running as you can still invoke the helper and trigger a prompt you'd have to approve — but it can't read the secret silently, and the key never sits in a plaintext dotfile. For OS-enforced biometric access use the data-protection keychain (paid Developer Program) or a notarized vault like 1Password's `op`.

### Signing

The helper is code-signed so the keychain can trust it. With an `Apple Development` cert (auto-detected) the identity is stable, so you approve "Always Allow" once. Ad-hoc signing also works — you just re-approve after recompiling the helper. The build cache keys on source + identity, so the same binary is reused across rebuilds and projects.

## License

MIT
