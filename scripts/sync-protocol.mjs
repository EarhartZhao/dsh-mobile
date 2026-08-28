/**
 * Vendors the deepseek-harness /api contract layer + fetch-carrier client into
 * packages/protocol/src/vendor/. The vendored tree is committed; this script
 * refreshes it and `--check` diffs without writing (CI / pre-release gate).
 *
 * Source (our fork):   deepseek-harness/packages/host/apiproxy/src/api/** + src/fetch/client.ts
 * Destination:         packages/protocol/src/vendor/api/** + vendor/fetch/client.ts
 *
 * Only type-only imports leave the contract layer (erased at compile time),
 * so the runtime closure is zod-only and Hermes-safe.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRepo = process.env.DSH_REPO
  ? resolve(process.env.DSH_REPO)
  : resolve(root, '..', 'deepseek-harness')
const sourceRoot = join(sourceRepo, 'packages/host/apiproxy/src')
const vendorRoot = join(root, 'packages/protocol/src/vendor')
const checkOnly = process.argv.includes('--check')

if (!existsSync(sourceRoot)) {
  console.error(`[sync-protocol] harness source not found: ${sourceRoot}`)
  console.error('  set DSH_REPO to the deepseek-harness checkout if it lives elsewhere')
  process.exit(1)
}

function listFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listFiles(full))
    else out.push(full)
  }
  return out
}

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** Files mirrored into the vendor tree: the whole api/ dir plus the fetch carrier client. */
const sources = [
  ...listFiles(join(sourceRoot, 'api')).map(f => ({ from: f, to: join('api', relative(join(sourceRoot, 'api'), f)) })),
  { from: join(sourceRoot, 'fetch/client.ts'), to: join('fetch/client.ts') },
]

const stale = []
const changed = []

if (existsSync(vendorRoot) && checkOnly) {
  for (const file of listFiles(vendorRoot)) {
    const rel = relative(vendorRoot, file)
    if (rel === 'SYNCED.json') continue // generated meta, not a mirror artifact
    if (!sources.some(s => s.to === rel)) stale.push(rel)
  }
}

for (const { from, to } of sources) {
  const dest = join(vendorRoot, to)
  if (checkOnly) {
    if (!existsSync(dest) || digest(dest) !== digest(from)) changed.push(to)
    continue
  }
  if (existsSync(dest) && digest(dest) === digest(from)) continue
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(from, dest)
  changed.push(to)
}

if (checkOnly) {
  if (changed.length > 0 || stale.length > 0) {
    console.error('[sync-protocol] vendor tree is stale:')
    for (const f of changed) console.error(`  changed: ${f}`)
    for (const f of stale) console.error(`  stale:   ${f}`)
    process.exit(1)
  }
  console.log(`[sync-protocol] vendor tree in sync (${sources.length} files)`)
  process.exit(0)
}

if (!checkOnly && existsSync(vendorRoot)) {
  for (const file of listFiles(vendorRoot)) {
    const rel = relative(vendorRoot, file)
    if (rel === 'SYNCED.json') continue
    if (!sources.some(s => s.to === rel)) {
      rmSync(file)
      stale.push(rel)
    }
  }
}

const meta = {
  syncedAt: new Date().toISOString(),
  sourceRepo,
  files: sources.length,
}
writeFileSync(join(vendorRoot, 'SYNCED.json'), JSON.stringify(meta, null, 2) + '\n')
console.log(`[sync-protocol] vendored ${sources.length} files from ${sourceRepo}`)
if (changed.length > 0) console.log(`  updated: ${changed.length}`)
if (stale.length > 0) console.log(`  removed: ${stale.length}`)
