#!/usr/bin/env node
import { Keychain } from './index.js'

function usage(code = 1) {
  process.stderr.write(`touchid-keychain — Touch ID-gated macOS Keychain access

usage:
  touchid-keychain get -s <service> <account>
  touchid-keychain set -s <service> <account>            # secret read from stdin
  touchid-keychain run -s <service> <account> [--as VAR] -- <command...>

  run: fetch <account> from <service> (one Touch ID prompt), export it as the
       env var VAR (default: the account name), then exec <command> with it.

examples:
  touchid-keychain get -s my-app API_KEY
  printf '%s' "$SECRET" | touchid-keychain set -s my-app API_KEY
  touchid-keychain run -s my-app DOTENV_PRIVATE_KEY -- dotenvx run -- next dev
`)
  process.exit(code)
}

const argv = process.argv.slice(2)
const action = argv.shift()
if (action === '-h' || action === '--help') usage(0)

try {
  if (action === 'get' || action === 'set') {
    const { service, account } = parseFlags(argv)
    if (!service || !account) usage()
    const kc = new Keychain({ service })
    if (action === 'get') {
      process.stdout.write(await kc.get(account))
    } else {
      await kc.set(account, await readStdin())
      process.stderr.write(`stored '${account}' in keychain service '${service}'\n`)
    }
  } else if (action === 'run') {
    const sep = argv.indexOf('--')
    if (sep === -1 || sep === argv.length - 1) usage()
    const { service, account, as } = parseFlags(argv.slice(0, sep))
    const command = argv.slice(sep + 1)
    if (!service || !account) usage()

    const value = await new Keychain({ service }).get(account)
    const { spawn } = await import('node:child_process')
    const child = spawn(command[0], command.slice(1), {
      stdio: 'inherit',
      env: { ...process.env, [as || account]: value },
    })
    child.on('error', err => { process.stderr.write(`${err.message}\n`); process.exit(1) })
    child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0))
  } else {
    usage()
  }
} catch (err) {
  process.stderr.write(`${err.message}\n`)
  process.exit(1)
}

function parseFlags(args) {
  let service, account, as
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--service' || args[i] === '-s') service = args[++i]
    else if (args[i] === '--as') as = args[++i]
    else account = args[i]
  }
  return { service, account, as }
}

function readStdin() {
  return new Promise(resolve => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', c => { data += c })
    process.stdin.on('end', () => resolve(data.trim()))
  })
}
