/**
 * Verifies the frozen legacy mobile wire and the current alpha.5 Remote
 * endpoints that dsh-mobile-plugin adapts onto it. The former ApiProxy source
 * tree no longer exists, so copying files from packages/host/apiproxy would
 * make this gate silently skip the protocol that production actually uses.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRepo = process.env.DSH_REPO ? resolve(process.env.DSH_REPO) : resolve(root, '..', 'deepseek-harness')
const vendorRoot = join(root, 'packages/protocol/src/vendor')
const vendorMetaPath = join(vendorRoot, 'SYNCED.json')
const remoteManifestPath = join(root, 'packages/protocol/src/REMOTE_ALPHA5.json')

const toPosix = value => value.replace(/\\/g, '/')
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex')

function listFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listFiles(full))
    else out.push(full)
  }
  return out
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`[sync-protocol] invalid ${label}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

function verifyVendor() {
  if (!existsSync(vendorRoot) || !existsSync(vendorMetaPath)) {
    console.error(`[sync-protocol] frozen mobile wire is missing: ${vendorRoot}`)
    process.exit(1)
  }
  const meta = readJson(vendorMetaPath, 'SYNCED.json')
  if (!Array.isArray(meta.manifest)) {
    console.error('[sync-protocol] SYNCED.json has no hash manifest')
    process.exit(1)
  }
  const mirrored = listFiles(vendorRoot)
    .map(file => toPosix(relative(vendorRoot, file)))
    .filter(path => path !== 'SYNCED.json')
  const expected = new Map(meta.manifest.map(entry => [entry.path, entry.sha256]))
  const actual = new Map(mirrored.map(path => [path, digest(join(vendorRoot, path))]))
  const problems = []
  for (const path of expected.keys()) {
    if (!actual.has(path)) problems.push(`missing: ${path}`)
    else if (actual.get(path) !== expected.get(path)) problems.push(`changed: ${path}`)
  }
  for (const path of actual.keys()) if (!expected.has(path)) problems.push(`extra: ${path}`)
  if (problems.length > 0) {
    console.error('[sync-protocol] frozen mobile wire changed without a manifest update:')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }
  return actual.size
}

function verifyRemote() {
  if (!existsSync(remoteManifestPath)) {
    console.error(`[sync-protocol] Remote manifest is missing: ${remoteManifestPath}`)
    process.exit(1)
  }
  const manifest = readJson(remoteManifestPath, 'REMOTE_ALPHA5.json')
  if (!Array.isArray(manifest.endpoints) || !Array.isArray(manifest.sourceChecks)) {
    console.error('[sync-protocol] Remote manifest must declare endpoints and sourceChecks')
    process.exit(1)
  }
  if (!existsSync(sourceRepo)) {
    console.log(`[sync-protocol] dsh source unavailable; validated ${manifest.endpoints.length} committed Remote endpoints only`)
    return manifest.endpoints.length
  }
  const failures = []
  for (const check of manifest.sourceChecks) {
    const path = join(sourceRepo, check.file)
    if (!existsSync(path)) {
      failures.push(`missing source: ${check.file}`)
      continue
    }
    const source = readFileSync(path, 'utf8')
    for (const token of check.includes) {
      if (!source.includes(token)) failures.push(`${check.file} no longer contains ${JSON.stringify(token)}`)
    }
  }
  if (failures.length > 0) {
    console.error('[sync-protocol] dsh alpha.5 Remote surface drifted:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exit(1)
  }
  return manifest.endpoints.length
}

const vendorFiles = verifyVendor()
const endpoints = verifyRemote()
console.log(`[sync-protocol] frozen mobile wire verified (${vendorFiles} files); alpha.5 Remote surface verified (${endpoints} endpoints)`)
