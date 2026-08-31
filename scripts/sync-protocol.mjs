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
const metaPath = join(vendorRoot, 'SYNCED.json')
const checkOnly = process.argv.includes('--check')

const toPosix = value => value.replace(/\\/g, '/')

if (!existsSync(sourceRoot)) {
  if (checkOnly) {
    if (!existsSync(vendorRoot) || !existsSync(metaPath)) {
      console.error(`[sync-protocol] standalone vendor check failed: ${vendorRoot} is missing`)
      process.exit(1)
    }

    let meta
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    } catch (error) {
      console.error('[sync-protocol] standalone vendor check failed: invalid SYNCED.json')
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }

    const mirrored = listFiles(vendorRoot)
      .map(file => toPosix(relative(vendorRoot, file)))
      .filter(rel => rel !== 'SYNCED.json')

    if (!Array.isArray(meta.manifest)) {
      if (mirrored.length !== meta.files) {
        console.error(`[sync-protocol] standalone vendor check failed: expected ${meta.files} files, found ${mirrored.length}`)
        process.exit(1)
      }
      console.log(`[sync-protocol] vendor tree present (${mirrored.length} files); legacy metadata has no hash manifest, source diff skipped`)
      process.exit(0)
    }

    const expected = new Map(meta.manifest.map(entry => [entry.path, entry.sha256]))
    const actual = new Map(mirrored.map(rel => [rel, digest(join(vendorRoot, rel))]))
    const missing = [...expected.keys()].filter(path => !actual.has(path))
    const extra = [...actual.keys()].filter(path => !expected.has(path))
    const changed = [...expected.keys()].filter(path => actual.has(path) && actual.get(path) !== expected.get(path))

    if (missing.length > 0 || extra.length > 0 || changed.length > 0) {
      console.error('[sync-protocol] standalone vendor check failed:')
      for (const rel of missing) console.error(`  missing: ${rel}`)
      for (const rel of extra) console.error(`  extra:   ${rel}`)
      for (const rel of changed) console.error(`  changed: ${rel}`)
      process.exit(1)
    }

    console.log(`[sync-protocol] vendor tree matches committed manifest (${actual.size} files)`)
    process.exit(0)
  }

  console.error(`[sync-protocol] harness source not found: ${sourceRoot}`)
  console.error('  set DSH_REPO to the deepseek-harness checkout if it lives elsewhere')
  console.error('  if dsh restructured the API layer (e.g. apiproxy -> packages/api),')
  console.error('  update sourceRoot and the MAPPING below, then re-run.')
  console.error('  see skills/dsh-sync-check/SKILL.md for the full workflow')
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
  manifest: sources.map(({ from, to }) => ({
    path: toPosix(to),
    sha256: digest(from),
  })),
}
writeFileSync(join(vendorRoot, 'SYNCED.json'), JSON.stringify(meta, null, 2) + '\n')
console.log(`[sync-protocol] vendored ${sources.length} files from ${sourceRepo}`)
if (changed.length > 0) console.log(`  updated: ${changed.length}`)
if (stale.length > 0) console.log(`  removed: ${stale.length}`)
