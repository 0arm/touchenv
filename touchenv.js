#!/usr/bin/env node
// touchenv — keychain-aware dotenvx.
//
// Default behavior is a passthrough: every command other than `keychain` is
// forwarded to dotenvx with the dotenvx private keys injected from the macOS
// Keychain (Touch ID). The `keychain` group manages those stored keys. Off
// macOS the keychain is skipped and this is a plain dotenvx passthrough, so it's
// safe in Linux/CI/Vercel builds where the keys come from the real environment.
//
// dotenvx keeps one private key per env file in .env.keys (DOTENV_PRIVATE_KEY for
// .env, DOTENV_PRIVATE_KEY_PRODUCTION for .env.production, etc). touchenv stores
// the whole set as a single keychain item and injects all of them at once, so a
// single prompt covers every env file.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import { Keychain } from './index.js'
import { isEnabled, resolveConfig } from './util.js'

const argv = process.argv.slice(2)
const RESERVED = new Set(['keychain', '-h', '--help', '-V', '--version', 'help'])

if (argv.length > 0 && !RESERVED.has(argv[0])) {
  await dotenvxPassthrough(argv)
} else {
  await buildCli().parseAsync(process.argv)
}

// --- keychain-aware dotenvx passthrough ------------------------------------

async function dotenvxPassthrough(args) {
  const { service, account, gate } = resolveConfig()
  const env = { ...process.env }

  if (process.platform === 'darwin' && isEnabled(gate)) {
    try {
      const kc = new Keychain(service, { account, reason: 'unlock the dotenvx keys' })
      Object.assign(env, asKeys(await kc.get(), account))
    } catch (err) {
      fail(err.message)
    }
  }

  const local = join(process.cwd(), 'node_modules', '.bin', 'dotenvx')
  const bin = existsSync(local) ? local : 'dotenvx'
  forward(bin, args, env, 'dotenvx not found (install @dotenvx/dotenvx in the project or globally)')
}

// --- key parsing -----------------------------------------------------------

// Pull every DOTENV_PRIVATE_KEY* entry out of .env.keys-style text.
function parseKeys(text) {
  const keys = {}
  for (const raw of String(text).split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const name = line.slice(0, eq).trim()
    if (!name.startsWith('DOTENV_PRIVATE_KEY')) continue
    keys[name] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return keys
}

function serializeKeys(keys) {
  return Object.entries(keys).map(([k, v]) => `${k}=${v}`).join('\n')
}

// Interpret a stored value as env vars. A bundle is NAME=value lines; a bare
// string is treated as the single default key (back-compat with older stores).
function asKeys(stored, account) {
  const keys = parseKeys(stored)
  return Object.keys(keys).length ? keys : { [account]: String(stored).trim() }
}

// dotenvx's .env.keys header, so `export` reproduces the canonical format.
const KEYS_HEADER = [
  '#/------------------!DOTENV_PRIVATE_KEYS!-------------------/',
  '#/ private decryption keys. DO NOT commit to source control /',
  '#/     [how it works](https://dotenvx.com/encryption)       /',
  '#/----------------------------------------------------------/',
].join('\n')

// Reverse dotenvx's naming for the per-key comment:
// DOTENV_PRIVATE_KEY -> .env, DOTENV_PRIVATE_KEY_PRODUCTION -> .env.production.
function envFileFor(name) {
  const suffix = name.slice('DOTENV_PRIVATE_KEY'.length)
  return suffix ? '.env.' + suffix.replace(/^_/, '').toLowerCase() : '.env'
}

function formatKeysFile(keys) {
  const blocks = Object.entries(keys).map(([k, v]) => `# ${envFileFor(k)}\n${k}="${v}"`)
  return KEYS_HEADER + '\n\n' + blocks.join('\n\n') + '\n'
}

// --- keychain management CLI (commander) -----------------------------------

function buildCli() {
  const program = new Command()
  program
    .name('touchenv')
    .description('keychain-aware dotenvx — keep the dotenvx private keys behind Touch ID')
    .version(pkgVersion(), '-V, --version')
    .addHelpText(
      'after',
      `
Passthrough:
  Any command other than 'keychain' is forwarded to dotenvx with the dotenvx
  private keys injected from the macOS Keychain (Touch ID):

    touchenv run -- next build      run a command with the decrypted env
    touchenv decrypt                decrypt .env in place
    touchenv encrypt                encrypt .env in place
    touchenv set FOO bar            set + encrypt a variable

  Off macOS this is a plain dotenvx passthrough.`
    )

  const kc = program
    .command('keychain')
    .description('manage the dotenvx private keys stored in the keychain')

  const withTarget = (cmd) =>
    cmd
      .option('-s, --service <name>', 'keychain service (default: <project>-dotenv)')
      .option('-a, --account <name>', 'item name (default: DOTENV_PRIVATE_KEY)')

  withTarget(kc.command('store'))
    .description('store every DOTENV_PRIVATE_KEY* from .env.keys in the keychain (Touch ID)')
    .option('--from <file>', 'source dotenvx keys file', '.env.keys')
    .action(async (opts) => {
      const { service, account } = target(opts)
      if (!existsSync(opts.from)) fail(`${opts.from} not found (run from the project root)`)
      const keys = parseKeys(readFileSync(opts.from, 'utf8'))
      const names = Object.keys(keys)
      if (!names.length) fail(`no DOTENV_PRIVATE_KEY* entries found in ${opts.from}`)
      await run(() => new Keychain(service, { account }).set(serializeKeys(keys)))
      ok(`stored ${names.length} key(s) in '${service}': ${names.join(', ')}.\n` +
        `now set DOTENV_USE_KEYCHAIN=true and delete ${opts.from}.`)
    })

  withTarget(kc.command('export'))
    .description('write the stored keys to a dotenvx keys file (Touch ID)')
    .option('--to <file>', 'destination keys file', '.env.keys')
    .option('-f, --force', 'overwrite the destination if it already exists')
    .action(async (opts) => {
      const { service, account } = target(opts)
      if (existsSync(opts.to) && !opts.force) {
        fail(`${opts.to} already exists — refusing to overwrite. ` +
          `Write elsewhere with --to <path>, or pass --force to overwrite.`)
      }
      const keys = asKeys(await run(() => new Keychain(service, { account }).get()), account)
      writeFileSync(opts.to, formatKeysFile(keys))
      ok(`wrote ${Object.keys(keys).length} key(s) to ${opts.to} — plaintext on disk, delete it when you're done.`)
    })

  withTarget(kc.command('rm'))
    .description('remove the stored keys — destructive (Touch ID or device password)')
    .action(async (opts) => {
      const { service, account } = target(opts)
      await run(() => new Keychain(service, { account }).delete())
      ok(`removed '${account}' from keychain service '${service}'`)
    })

  withTarget(kc.command('status'))
    .description('show the resolved config and whether the keys are stored')
    .action(async (opts) => {
      const { service, account, gate } = target(opts)
      const lines = [
        `service:  ${service}`,
        `account:  ${account}`,
        `gate:     ${gate} (${isEnabled(gate) ? 'enabled' : 'disabled'})`,
      ]
      if (process.platform !== 'darwin') {
        lines.push('stored:   n/a (keychain is macOS-only)')
      } else {
        const present = await run(() => new Keychain(service, { account }).has())
        lines.push(`stored:   ${present ? 'yes' : 'no'}`)
      }
      process.stdout.write(lines.join('\n') + '\n')
    })

  return program
}

// --- helpers ---------------------------------------------------------------

function target(opts) {
  const cfg = resolveConfig()
  return {
    service: opts.service || cfg.service,
    account: opts.account || cfg.account,
    gate: cfg.gate,
  }
}

async function run(fn) {
  try {
    return await fn()
  } catch (err) {
    fail(err.message)
  }
}

function forward(bin, args, env, notFoundMsg) {
  const child = spawn(bin, args, { stdio: 'inherit', env })
  child.on('error', (err) => fail(err.code === 'ENOENT' ? notFoundMsg : err.message))
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0))
}

function pkgVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    return JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

function ok(msg) {
  process.stderr.write(msg + '\n')
}

function fail(msg) {
  process.stderr.write(`touchenv: ${msg}\n`)
  process.exit(1)
}
