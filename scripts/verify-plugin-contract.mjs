/**
 * Cross-repository contract gate: the App's compatibility expectations against
 * the sibling `dsh-mobile-plugin` checkout.
 *
 * The two repositories ship independently, so the App cannot import the plugin
 * at build time. This gate reads the plugin's source instead — the same way
 * `sync-protocol.mjs` reads the harness — and checks the four facts that
 * otherwise drift silently:
 *
 *   1. the plugin's declared version matches its package.json;
 *   2. that version sits inside the App's supported range;
 *   3. every mobileApi the plugin announces is one the App accepts;
 *   4. every method the App's protocol layer can send is whitelisted, and every
 *      feature the App requires is announced.
 *
 * A missing sibling checkout is a notice, not a failure: CI runs one repository
 * at a time, and the release checklist runs this where both are present.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginRoot = process.env.DSH_MOBILE_PLUGIN_REPO
  ? resolve(process.env.DSH_MOBILE_PLUGIN_REPO)
  : resolve(root, '..', 'dsh-mobile-plugin')

/** Method-name prefixes the App's own protocol modules may send. */
const MOBILE_METHOD_PREFIXES = new Set([
  'session', 'workspace', 'host', 'command', 'reference', 'file', 'subagent',
  'goal', 'agentPreset', 'skill', 'feedback', 'mobile', 'pair', 'hello', 'respond', 'plugin',
])

function fail(message) {
  console.error(`[plugin-contract] ${message}`)
  process.exitCode = 1
}

function read(path) {
  return readFileSync(path, 'utf8')
}

/** Quoted strings inside the first `[...]` or `new Set([...])` after `marker`. */
function stringListAfter(source, marker) {
  const start = source.indexOf(marker)
  if (start === -1) return null
  const open = source.indexOf('[', start)
  const close = source.indexOf(']', open)
  if (open === -1 || close === -1) return null
  return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map(match => match[1])
}

function stringConstant(source, name) {
  const match = new RegExp(`export const ${name} = '([^']+)'`).exec(source)
  return match?.[1] ?? null
}

function numberConstant(source, name) {
  const match = new RegExp(`export const ${name} = (\\d+)`).exec(source)
  return match === null ? null : Number(match[1])
}

/** Numbers inside the first `[...]` after `marker` (numeric const arrays). */
function numberListAfter(source, marker) {
  const start = source.indexOf(marker)
  if (start === -1) return null
  const open = source.indexOf('[', start)
  const close = source.indexOf(']', open)
  if (open === -1 || close === -1) return null
  return [...source.slice(open, close).matchAll(/\d+/g)].map(match => Number(match[0]))
}

/** Supports the `>=a.b.c <d.e.f` and `^a.b.c` shapes this repository uses. */
function versionSatisfies(version, range) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.replace(/^v/, ''))
    return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const compare = (left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
  const target = parse(version)
  if (target === null) return false
  const trimmed = range.trim()
  if (trimmed.startsWith('^')) {
    const floor = parse(trimmed.slice(1))
    if (floor === null) return null
    return compare(target, floor) >= 0 && target[0] === floor[0]
  }
  const parts = trimmed.split(/\s+/)
  if (parts.length !== 2 || !parts[0].startsWith('>=') || !parts[1].startsWith('<')) return null
  const floor = parse(parts[0].slice(2))
  const ceiling = parse(parts[1].slice(1))
  if (floor === null || ceiling === null) return null
  return compare(target, floor) >= 0 && compare(target, ceiling) < 0
}

/** Every mobile method literal the App's own protocol modules can send. */
function appMobileMethods(directory) {
  const methods = new Set()
  const files = [
    'mobile-commands.ts', 'mobile-references.ts', 'mobile-file-uploads.ts',
    'mobile-workspace.ts', 'mobile-feedback.ts', 'pairing.ts',
  ]
  for (const file of files) {
    const path = join(directory, file)
    if (!existsSync(path)) continue
    for (const match of read(path).matchAll(/'([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+)'/g)) {
      const [prefix] = match[1].split('.')
      if (MOBILE_METHOD_PREFIXES.has(prefix)) methods.add(match[1])
    }
  }
  return methods
}

if (!existsSync(pluginRoot)) {
  console.log(`[plugin-contract] plugin checkout unavailable at ${pluginRoot}; skipped the cross-repository checks`)
  process.exit(0)
}

const bridge = read(join(pluginRoot, 'src', 'bridge.ts'))
const pluginPackage = JSON.parse(read(join(pluginRoot, 'package.json')))
const compatibility = read(join(root, 'packages', 'core', 'src', 'compatibility.ts'))

const pluginVersion = stringConstant(bridge, 'PLUGIN_VERSION')
const pluginMobileApi = numberConstant(bridge, 'PLUGIN_MOBILE_API')
const pluginFeatures = stringListAfter(bridge, 'PLUGIN_FEATURES')
const allowedMethods = stringListAfter(bridge, 'ALLOWED_METHODS')
const pluginOwned = [
  stringConstant(bridge, 'PAIR_METHOD'),
  stringConstant(bridge, 'HELLO_METHOD'),
  stringConstant(bridge, 'MOBILE_INFO_METHOD'),
  stringConstant(bridge, 'MOBILE_HEALTH_METHOD'),
  stringConstant(bridge, 'MOBILE_INVENTORY_METHOD'),
].filter(value => value !== null)

const appMobileApi = numberConstant(compatibility, 'APP_MOBILE_API')
const supportedRange = stringConstant(compatibility, 'SUPPORTED_PLUGIN_RANGE')
const supportedApis = numberListAfter(compatibility, 'SUPPORTED_MOBILE_APIS')
const requiredFeatures = stringListAfter(compatibility, 'REQUIRED_PLUGIN_FEATURES')

if (pluginVersion === null || pluginFeatures === null || allowedMethods === null) {
  fail('could not read the plugin declarations from src/bridge.ts')
} else if (appMobileApi === null || supportedRange === null || requiredFeatures === null) {
  fail('could not read the App declarations from packages/core/src/compatibility.ts')
} else {
  if (pluginVersion !== pluginPackage.version) {
    fail(`plugin version drift: bridge.ts ${pluginVersion} vs package.json ${pluginPackage.version}`)
  }

  const inRange = versionSatisfies(pluginVersion, supportedRange)
  if (inRange === null) {
    fail(`unrecognized SUPPORTED_PLUGIN_RANGE form: ${supportedRange}`)
  } else if (!inRange) {
    fail(`App supports ${supportedRange} but the plugin declares ${pluginVersion}`)
  }

  if (pluginMobileApi !== appMobileApi) {
    fail(`mobileApi drift: App expects ${appMobileApi}, plugin announces ${pluginMobileApi}`)
  }
  if (supportedApis !== null && pluginMobileApi !== null && !supportedApis.includes(pluginMobileApi)) {
    fail(`SUPPORTED_MOBILE_APIS ${supportedApis.join('/')} excludes the plugin's ${pluginMobileApi}`)
  }

  const missingFeatures = requiredFeatures.filter(feature => !pluginFeatures.includes(feature))
  if (missingFeatures.length > 0) {
    fail(`plugin is missing required features: ${missingFeatures.join(', ')}`)
  }

  const pluginMethods = new Set([...allowedMethods, ...pluginOwned])
  const unlisted = [...appMobileMethods(join(root, 'packages', 'protocol', 'src'))]
    .filter(method => !pluginMethods.has(method))
  if (unlisted.length > 0) {
    fail(`App can send methods the plugin does not whitelist: ${unlisted.join(', ')}`)
  }

  if (process.exitCode !== 1) {
    console.log(
      `[plugin-contract] plugin ${pluginVersion} / mobileApi ${pluginMobileApi} satisfies App `
      + `${appMobileApi} + ${supportedRange}; ${requiredFeatures.length} required features and `
      + `${pluginMethods.size} whitelisted methods verified`,
    )
  }
}
