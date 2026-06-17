#!/usr/bin/env node
// touchenv — keychain-aware dotenvx, plus raw Touch ID keychain access.
//
//   touchenv <dotenvx args...>     run dotenvx, injecting DOTENV_PRIVATE_KEY from
//                                  the macOS Keychain (Touch ID) when opted in
//   touchenv keychain get|set|run  raw keychain access (see usage)
//
// dotenvx stays 100% vanilla — this is just a front door. On non-macOS the
// keychain is skipped entirely and touchenv is a plain dotenvx passthrough, so
// it's safe in Linux/CI/Vercel builds.
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Keychain } from './index.js'
import { isEnabled } from './util.js'

const argv = process.argv.slice(2)

if (argv[0] === '-h' || argv[0] === '--help') {
  usage(0)
} else if (argv[0] === 'keychain') {
  await keychainCli(argv.slice(1))
} else {
  await dotenvxProxy(argv)
}

// --- keychain-aware dotenvx ------------------------------------------------

async function dotenvxProxy(args) {
  let pkg = {}
  try {
    pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
  } catch {
    // no package.json — fall back to directory-name convention
  }
  const cfg = pkg.touchenv || {}
  const projectName = pkg.name ? pkg.name.split('/').pop() : basename(process.cwd())
  const service = cfg.service || `${projectName}-dotenv`
  const account = cfg.account || 'DOTENV_PRIVATE_KEY'
  const gate = cfg.gate || 'DOTENV_USE_KEYCHAIN'

  const env = { ...process.env }
  // Keychain is macOS-only; everywhere else this is a plain dotenvx passthrough.
  if (process.platform === 'darwin' && isEnabled(gate)) {
    try {
      env[account] = await new Keychain({ service }).get(account)
    } catch (err) {
      process.stderr.write(`${err.message}\n`)
      process.exit(1)
    }
  }

  const localDotenvx = join(process.cwd(), 'node_modules', '.bin', 'dotenvx')
  forward(existsSync(localDotenvx) ? localDotenvx : 'dotenvx', args, env, 'dotenvx not found (install it in the project or globally)')
}

// --- raw keychain access ---------------------------------------------------

async function keychainCli(args) {
  const action = args.shift()
  if (action !== 'get' && action !== 'set' && action !== 'run') usage()

  try {
    if (action === 'get' || action === 'set') {
      const { service, account } = parseFlags(args)
      if (!service || !account) usage()
      const kc = new Keychain({ service })
      if (action === 'get') {
        process.stdout.write(await kc.get(account))
      } else {
        await kc.set(account, await readStdin())
        process.stderr.write(`stored '${account}' in keychain service '${service}'\n`)
      }
    } else {
      // run: inject one secret into the env, then exec the command after `--`
      const sep = args.indexOf('--')
      if (sep === -1 || sep === args.length - 1) usage()
      const { service, account, as, gate } = parseFlags(args.slice(0, sep))
      const command = args.slice(sep + 1)
      if (!service || !account) usage()

      const env = { ...process.env }
      if (!gate || isEnabled(gate)) {
        env[as || account] = await new Keychain({ service }).get(account)
      }
      forward(command[0], command.slice(1), env, command[0] + ' not found')
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    process.exit(1)
  }
}

// --- helpers ---------------------------------------------------------------

function forward(bin, args, env, notFoundMsg) {
  const child = spawn(bin, args, { stdio: 'inherit', env })
  child.on('error', err => {
    process.stderr.write(`touchenv: ${err.code === 'ENOENT' ? notFoundMsg : err.message}\n`)
    process.exit(1)
  })
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0))
}

function parseFlags(args) {
  let service, account, as, gate
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--service' || args[i] === '-s') service = args[++i]
    else if (args[i] === '--as') as = args[++i]
    else if (args[i] === '--gate') gate = args[++i]
    else account = args[i]
  }
  return { service, account, as, gate }
}

function readStdin() {
  return new Promise(resolve => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', c => { data += c })
    process.stdin.on('end', () => resolve(data.trim()))
  })
}

function usage(code = 1) {
  process.stderr.write(`touchenv — keychain-aware dotenvx + Touch ID keychain access

usage:
  touchenv <dotenvx args...>      run dotenvx, injecting DOTENV_PRIVATE_KEY from
                                  the keychain (Touch ID) when opted in via the
                                  gate env var (default DOTENV_USE_KEYCHAIN)
  touchenv keychain get -s <service> <account>
  touchenv keychain set -s <service> <account>            # secret read from stdin
  touchenv keychain run -s <service> <account> [--as VAR] [--gate ENV] -- <cmd...>

examples:
  touchenv run --convention=nextjs -- next dev
  touchenv decrypt
  printf '%s' "$SECRET" | touchenv keychain set -s my-app API_KEY
`)
  process.exit(code)
}
