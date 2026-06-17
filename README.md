# touchid-keychain

Store and retrieve secrets in the **macOS login Keychain, gated by Touch ID** — from Node or the command line. **No Apple Developer cert required.**

```js
import { Keychain } from 'touchid-keychain'

const kc = new Keychain({ service: 'my-app' })

await kc.set('API_KEY', 'super-secret')   // Touch ID prompt
const key = await kc.get('API_KEY')       // Touch ID prompt
```

```bash
printf '%s' "$SECRET" | npx touchid-keychain set -s my-app API_KEY
npx touchid-keychain get -s my-app API_KEY
```

### Compose it into other commands

`run` fetches one secret (a single Touch ID prompt), exports it into the
environment, then execs whatever follows `--`. Because npm/bun put
`node_modules/.bin` on `PATH` inside scripts, your `package.json` stays a clean
one-liner — no wrapper script, no `node_modules/.bin/` path:

```jsonc
// package.json
"scripts": {
  "dev": "touchid-keychain run -s my-app DOTENV_PRIVATE_KEY -- dotenvx run -- next dev"
}
```

The secret is exported as the account name by default; use `--as VAR` to rename
it. If the Touch ID prompt is denied, `run` exits non-zero and the command never
starts.

## Install

```bash
npm install github:0arm/touchid-keychain
```

Requires **macOS** with a Touch ID sensor and the **Xcode Command Line Tools** (`xcode-select --install`) — the tiny Swift helper is compiled on first use and cached under `~/.cache/touchid-keychain/`.

## How it works (and what it does / doesn't protect)

macOS's built-in `security` CLI can store and read Keychain items but **cannot gate them on Touch ID** — biometric-gated items live in the *data-protection keychain*, which requires a provisioning-profile'd app bundle a bare CLI can't be.

So this uses the **legacy keychain + the trusted-application ACL** instead:

- A small Swift helper creates the item, so its default ACL **trusts only that helper's code identity**. `security find-generic-password -w` (or any other app) then gets a *deny-able prompt* instead of silently reading the secret.
- The helper runs a `LocalAuthentication` (Touch ID) check before it reads, and items are stored `WhenUnlockedThisDeviceOnly` (never synced to iCloud).

**Honest threat model:** this is *user-presence* protection, not an unbypassable vault. A process running as you can still invoke the helper and trigger a Touch ID prompt you'd have to approve — but it can't read the secret silently, and the secret never sits in a plaintext dotfile. For OS-enforced, unbypassable biometric access you need the data-protection keychain (app bundle + paid Developer Program) or a notarized vault like 1Password's `op`.

## Signing identity

The helper is code-signed so the Keychain can trust it. `identity` (constructor option) controls how:

| value | behavior |
|---|---|
| `'auto'` *(default)* | use an `Apple Development` cert if one exists, else fall back to ad-hoc |
| `'-'` | force ad-hoc signing |
| explicit string | use that exact `codesign` identity |

**With a cert** the helper has a stable identity, so you approve the one-time "Always Allow" keychain prompt once, ever. **Ad-hoc works too** — the only difference is that recompiling the helper changes its code hash, so you'd re-approve "Always Allow" after a rebuild. The build cache keys on the source + identity, so in practice the same binary is reused across rebuilds and projects and the prompt sticks.

## API

### `new Keychain({ service, identity?, reason? })`
- `service` *(required)* — namespaces your items.
- `identity` — see above (default `'auto'`).
- `reason` — the message shown in the Touch ID prompt.

### `kc.get(account): Promise<string>`
Prompts Touch ID, resolves the stored secret. Rejects if the item is missing or the prompt is denied.

### `kc.set(account, value): Promise<void>`
Prompts Touch ID, stores/replaces the secret (passed to the helper via stdin, never argv).

## License

MIT
