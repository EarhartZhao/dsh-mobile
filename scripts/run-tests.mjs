#!/usr/bin/env node
/**
 * Automated test runner for dsh-mobile.
 * Runs core, protocol, and mobile test suites plus typecheck.
 * Usage: node scripts/run-tests.mjs [--domain <name>] [--report]
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const domainIdx = args.indexOf('--domain')
const domain = domainIdx >= 0 ? args[domainIdx + 1] : null
const report = args.includes('--report')

const suites = [
  { name: 'core-tests', cwd: root, cmd: 'pnpm --config.verify-deps-before-run=false run test' },
  { name: 'core-typecheck', cwd: root, cmd: 'pnpm --config.verify-deps-before-run=false run typecheck' },
  { name: 'mobile-tests', cwd: resolve(root, 'apps/mobile'), cmd: 'pnpm --config.verify-deps-before-run=false run test --runInBand' },
  { name: 'mobile-typecheck', cwd: resolve(root, 'apps/mobile'), cmd: 'pnpm --config.verify-deps-before-run=false run typecheck' },
  { name: 'mobile-lint', cwd: resolve(root, 'apps/mobile'), cmd: 'pnpm --config.verify-deps-before-run=false run lint' },
]

const domainMap = {
  pairing: ['core-tests', 'core-typecheck'],
  sessions: ['core-tests', 'mobile-tests'],
  chat: ['core-tests', 'mobile-tests'],
  attachments: ['mobile-tests', 'core-tests'],
  settings: ['mobile-tests', 'mobile-typecheck'],
}

const filtered = domain && domainMap[domain]
  ? suites.filter(s => domainMap[domain].includes(s.name))
  : suites

const results = []
let failed = 0

for (const suite of filtered) {
  process.stdout.write(`\n=== ${suite.name} (${suite.cwd}) ===\n`)
  try {
    const output = execSync(suite.cmd, { cwd: suite.cwd, encoding: 'utf8', timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] })
    const testLine = output.match(/Tests?\s+(\d+)\s+passed/)?.[0] ?? 'ok'
    results.push({ name: suite.name, status: 'PASS', detail: testLine })
    process.stdout.write(`  PASS ${testLine}\n`)
  } catch (error) {
    failed++
    const stderr = error.stderr ?? error.message ?? 'unknown'
    const snippet = String(stderr).slice(-500)
    results.push({ name: suite.name, status: 'FAIL', detail: snippet })
    process.stdout.write(`  FAIL\n${snippet}\n`)
  }
}

console.log('\n=== Summary ===')
for (const r of results) console.log(`  [${r.status}] ${r.name}: ${r.detail}`)
console.log(`  ${results.length - failed}/${results.length} suites passed`)

if (report) {
  const reportPath = resolve(root, 'docs/test-plan/last-report.json')
  writeFileSync(reportPath, JSON.stringify({ date: new Date().toISOString(), results }, null, 2))
  console.log(`\nReport written to ${reportPath}`)
}

process.exit(failed > 0 ? 1 : 0)
