/**
 * adb UI driver for manual acceptance of the Android app.
 *
 * The app has no rendered-component test harness, so acceptance has to run the
 * real APK. This script turns `uiautomator dump` into a scriptable loop:
 * find a node by its visible label, tap it, and read back what changed.
 *
 * Usage:
 *   node scripts/ui-drive.mjs dump [--all]        list visible labels (+ bounds with --all)
 *   node scripts/ui-drive.mjs tap <label>         tap the first matching node
 *   node scripts/ui-drive.mjs long <label> [ms]   press and hold (default 600ms)
 *   node scripts/ui-drive.mjs type <text>         input text into the focused field
 *   node scripts/ui-drive.mjs key <name|code>     key event: enter, back, or a numeric code
 *   node scripts/ui-drive.mjs shot <file>         write a PNG screenshot
 *   node scripts/ui-drive.mjs texts <regex>       print matching labels with their bounds
 *
 * `ADB` overrides the adb path; the default is the SDK platform-tools path.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const ADB = process.env.ADB ?? 'E:\\Android\\Sdk\\platform-tools\\adb.exe'

function adb(args, options = {}) {
  return execFileSync(ADB, args, { encoding: options.binary === true ? 'buffer' : 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

/** Every node carrying visible text or an accessibility label, in dump order. */
function nodes() {
  const xml = adb(['shell', 'cat', '/sdcard/window.xml'])
  const found = []
  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const tag = match[0]
    const text = /\btext="([^"]*)"/.exec(tag)?.[1] ?? ''
    const label = /\bcontent-desc="([^"]*)"/.exec(tag)?.[1] ?? ''
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag)
    if (bounds === null) continue
    const value = text !== '' ? text : label
    if (value === '') continue
    found.push({
      value,
      text,
      label,
      x: Math.round((Number(bounds[1]) + Number(bounds[3])) / 2),
      y: Math.round((Number(bounds[2]) + Number(bounds[4])) / 2),
      clickable: /\bclickable="true"/.test(tag),
    })
  }
  return found
}

function refresh() {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/window.xml'])
}

function find(label) {
  const all = nodes()
  const exact = all.filter(node => node.value === label)
  const partial = all.filter(node => node.value.includes(label))
  const hit = exact[0] ?? partial[0]
  if (hit === undefined) {
    console.error(`not found: ${JSON.stringify(label)}`)
    console.error('visible:', JSON.stringify([...new Set(all.map(node => node.value))].slice(0, 60)))
    process.exit(1)
  }
  return hit
}

const [command, argument, extra] = process.argv.slice(2)
refresh()

if (command === 'dump') {
  const all = nodes()
  const seen = new Set()
  for (const node of all) {
    if (seen.has(node.value)) continue
    seen.add(node.value)
    console.log(argument === '--all' ? `${node.value} @ ${node.x},${node.y}${node.clickable ? ' (tap)' : ''}` : node.value)
  }
} else if (command === 'tap') {
  const hit = find(argument)
  adb(['shell', 'input', 'tap', String(hit.x), String(hit.y)])
  console.log(`tapped ${JSON.stringify(hit.value)} @ ${hit.x},${hit.y}`)
} else if (command === 'long') {
  const hit = find(argument)
  const duration = extra ?? '600'
  adb(['shell', 'input', 'swipe', String(hit.x), String(hit.y), String(hit.x), String(hit.y), duration])
  console.log(`held ${JSON.stringify(hit.value)} for ${duration}ms @ ${hit.x},${hit.y}`)
} else if (command === 'type') {
  // `input text` treats spaces as separators, so encode them.
  adb(['shell', 'input', 'text', argument.replace(/ /g, '%s')])
  console.log(`typed ${JSON.stringify(argument)}`)
} else if (command === 'key') {
  const code = argument === 'enter' ? '66' : argument === 'back' ? '4' : argument
  adb(['shell', 'input', 'keyevent', code])
  console.log(`key ${argument} (${code})`)
} else if (command === 'shot') {
  writeFileSync(argument, adb(['exec-out', 'screencap', '-p'], { binary: true }))
  console.log(`screenshot -> ${argument}`)
} else if (command === 'texts') {
  const pattern = new RegExp(argument, 'u')
  for (const node of nodes()) {
    if (pattern.test(node.value)) console.log(`${node.value} @ ${node.x},${node.y}`)
  }
} else {
  console.error('usage: dump|tap|long|type|key|shot|texts')
  process.exit(1)
}
