# touchenv

**Touch ID-protected private keys for [dotenvx](https://github.com/dotenvx/dotenvx).**

`touchenv` keeps your `dotenvx` private key out of plaintext `.env.keys` files and stores it in the macOS Keychain, with access protected by Touch ID.

Use it exactly where you would normally use `dotenvx`:

```bash
touchenv run -- next build
touchenv decrypt
touchenv rotate
```

On macOS, `touchenv` fetches the private key only after local user authentication. On Linux, CI, and other non-macOS environments, it passes through to `dotenvx` unchanged.

No Apple Developer Program membership is required.


## Why?

`dotenvx` encrypts your `.env` files so you can safely commit them to the repo. Its [whitepaper](https://dotenvx.com/dotenvx.pdf) calls this *cryptographic separation*: an encrypted secrets file that is safe to share, plus a separate private key that does the decryption. The catch is where that private key lives — by default, in plaintext in `.env.keys` on disk.

That makes the key the single point of failure. Anything that can read a file in your project directory can read it — and with supply-chain attacks and infostealer malware increasingly hunting for exactly these files, a private key sitting in a plaintext dotfile is a prime exfiltration target.

The whitepaper anticipates this: the runtime pulls the private key from "the `.env.keys` file **or a platform-native secrets manager**." `touchenv` makes the macOS Keychain that platform-native manager — so the key stays out of the plaintext default and behind Touch ID.

```text
before: .env.keys on disk
after:  macOS Keychain + Touch ID
```

Your commands stay the same. Your key is no longer sitting in a plaintext dotfile.


## Install

```bash
npm install touchenv
```

Or install it globally:

```bash
npm install -g touchenv
```

You can also use Bun or pnpm:

```bash
bun add touchenv
pnpm add touchenv
```

The package installs on any platform. The macOS helper is compiled on first use, not during installation.

Keychain support requires:

* macOS
* Touch ID-capable device
* Xcode Command Line Tools

Install the command line tools with:

```bash
xcode-select --install
```

`touchenv` also expects `dotenvx` to be available either locally in the project or on your `PATH`.


## Quick start

For a project that already uses `dotenvx` and has an encrypted `.env` plus `.env.keys`:

```bash
touchenv keychain store
echo "DOTENV_USE_KEYCHAIN=true" >> .env.local
rm .env.keys
touchenv run -- node server.js
```

That does four things:

1. Stores the dotenvx private key in the macOS Keychain
2. Enables Keychain mode locally
3. Removes the plaintext `.env.keys` file
4. Runs your app with the key injected after Touch ID approval

Check the setup without triggering a Touch ID prompt:

```bash
touchenv keychain status
```

Example output:

```text
service:  myapp-dotenv
account:  DOTENV_PRIVATE_KEY
gate:     DOTENV_USE_KEYCHAIN enabled
stored:   yes
```

If you have not encrypted your `.env` yet, encrypt first:

```bash
touchenv encrypt
touchenv keychain store
echo "DOTENV_USE_KEYCHAIN=true" >> .env.local
rm .env.keys
```


## Usage

Use `touchenv` anywhere you would normally use `dotenvx`.

```jsonc
{
  "scripts": {
    "dev": "touchenv run --convention=nextjs -- next dev",
    "build": "touchenv run -- next build",
    "start": "touchenv run -- node dist/server.js"
  }
}
```

The first protected command prompts for Touch ID. After approval, `touchenv` reads the private key from the Keychain and injects it into the environment before forwarding the command to `dotenvx`.

All normal dotenvx commands still work:

```bash
touchenv set STRIPE_KEY sk_live_123
touchenv get STRIPE_KEY
touchenv ls
touchenv decrypt
```


## Managing the stored key

The `keychain` commands manage the dotenvx private key stored on your Mac.

```bash
touchenv keychain store
touchenv keychain export
touchenv keychain status
touchenv keychain rm
```

### Commands

```bash
touchenv keychain store
```

Reads `.env.keys` and stores the private key in the macOS Keychain.

```bash
touchenv keychain export
```

Writes the stored key back to `.env.keys`. This is useful for recovery, migration, or key rotation.

```bash
touchenv keychain status
```

Shows the resolved configuration and whether a key is stored. This does not require Touch ID.

```bash
touchenv keychain rm
```

Deletes the stored key from the Keychain. This is destructive.

### Options

The default service and account are derived from your project:

```text
service: <package-name>-dotenv
account: DOTENV_PRIVATE_KEY
gate:    DOTENV_USE_KEYCHAIN
```

You can override them with flags:

```bash
touchenv keychain store --service my-svc --account DOTENV_PRIVATE_KEY
touchenv keychain export --to .env.keys
touchenv keychain export --force
```

Supported flags:

```bash
-s, --service <name>
-a, --account <name>
--from <file>
--to <file>
--force
```

`export` refuses to overwrite an existing file unless `--force` is passed.


## Rotating keys

`dotenvx rotate` creates a new keypair, re-encrypts your `.env`, and writes the new private key to `.env.keys`.

Because `touchenv` removes `.env.keys` from normal local development, rotation is a short export-rotate-store flow:

```bash
touchenv keychain export
touchenv rotate
touchenv keychain store --from .env.keys
rm .env.keys
```

Then commit the re-encrypted `.env`.

To rotate a specific env file, pass the dotenvx flags through:

```bash
touchenv rotate -f .env.production
```


## How it works

`touchenv <args>` forwards to `dotenvx <args>`.

Before forwarding, `touchenv` checks whether Keychain mode is enabled. By default, this is controlled by:

```text
DOTENV_USE_KEYCHAIN=true
```

The gate is resolved from:

1. The current environment
2. `.env.local`
3. `.env`

When the gate is enabled on macOS, `touchenv` asks the helper to read `DOTENV_PRIVATE_KEY` from the Keychain. The helper performs a Touch ID authentication check first, falling back to your device password if biometrics fail or aren't enrolled. If authentication succeeds, the key is injected into the child process environment and the original dotenvx command runs.

When the gate is disabled, `touchenv` is just a passthrough.

When not running on macOS, the Keychain path is skipped entirely.


## Configuration

You can configure the Keychain service, account, and gate variable in `package.json`.

```jsonc
{
  "touchenv": {
    "service": "my-app-dotenv",
    "account": "DOTENV_PRIVATE_KEY",
    "gate": "USE_KEYCHAIN"
  }
}
```

Most projects do not need this.

By convention, `touchenv` uses:

```text
service: <package-name>-dotenv
account: DOTENV_PRIVATE_KEY
gate:    DOTENV_USE_KEYCHAIN
```


## CI and hosted builds

No script changes are required for CI.

Because Keychain mode is normally enabled through `.env.local`, and `.env.local` should not be committed, CI will not enable Touch ID mode.

In CI, provide the private key the normal dotenvx way:

```text
DOTENV_PRIVATE_KEY=...
```

On non-macOS systems, `touchenv` simply forwards to `dotenvx`, so Linux builds, Docker builds, and hosted deployments keep working normally.


## JavaScript API

`touchenv` also exposes a small Keychain API.

```js
import { Keychain } from 'touchenv'

const kc = new Keychain('my-app-dotenv', {
  account: 'API_KEY'
})

await kc.set('s3cret')       // Touch ID or device password
const value = await kc.get() // Touch ID or device password
await kc.has()               // no prompt
await kc.delete()            // Touch ID or device password (destructive)
```

The account can be set on the instance or overridden per call:

```js
await kc.get('OTHER_KEY')
await kc.set('s3cret', 'OTHER_KEY')
await kc.delete('OTHER_KEY')
```

`get`, `set`, and `delete` require authentication. `has` only checks whether an item exists and does not prompt.

A missing item rejects with:

```js
err.code === 5
```


## Security model

`touchenv` stores your `dotenvx` private key in the macOS Keychain and requires Touch ID — or your device password as a fallback — before releasing it to `dotenvx`. It is the platform-native key store that dotenvx's [whitepaper](https://dotenvx.com/dotenvx.pdf) names as the alternative to a plaintext `.env.keys`.

This is strong local user-presence protection, not a claim that the secret is impossible to extract from a compromised Mac. An attacker running arbitrary code as your user should not be able to read the key silently, but they may be able to invoke the helper and trigger an authentication prompt. Bypassing the protection should require compromising macOS, the Keychain security model, the helper, or tricking the user into approving access.

`touchenv` protects the key at rest and gates local access before execution. It does not protect the key after it has been released to the process that needs it.

To run `dotenvx`, the private key must eventually be passed to the child process environment as `DOTENV_PRIVATE_KEY`. Code running inside that process may be able to read it. That includes application code, dependencies, debuggers, crash reporters, logging code, or anything else that can inspect environment variables or process memory.

In other words, `touchenv` prevents the key from living as a plaintext project file. It does not make secrets invisible to the application that is explicitly being given those secrets.

This means:

* the private key is not kept in `.env.keys`
* the key is not silently readable by ordinary shell commands
* access requires local user approval
* the key remains local to the Mac
* CI and non-macOS environments are unaffected
* the running app can still access the environment variables it receives

The built-in macOS `security` CLI cannot create Touch ID-gated generic password items. `touchenv` therefore uses a signed helper and a Keychain trusted-application ACL. With a stable Apple Development certificate, macOS can remember the helper identity and allow one-time approval. Ad-hoc signing also works, but may require re-approval after the helper is rebuilt.


## License

MIT
