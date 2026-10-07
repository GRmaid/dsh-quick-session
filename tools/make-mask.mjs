/**
 * Rebuild the sidebar icon mask from a source image.
 *
 * The artwork this ships with is an opaque dark plane carrying light line art, so
 * the conversion keys that plane out (thresholds read from the image's own luma
 * histogram), crops tight to the glyph, scales the long edge to 96 px, and prints
 * the exact `const TAIL_MASK = ...` line to paste into lib/client.js.
 *
 * sharp is not a dependency of this package — it is the copy inside the running
 * app. Point DSH_APP_NODE_MODULES at `<app>/resources/app.asar/dsh/node_modules`
 * and run this under the app's own Electron, for example:
 *
 *   $env:ELECTRON_RUN_AS_NODE = 1
 *   & "C:\...\DeepSeek Harness.exe" tools/make-mask.mjs "C:\path\tail.gif"
 *
 * @module dsh-quick-session/tools/make-mask
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const appModules = process.env.DSH_APP_NODE_MODULES
  ?? 'E:/University/VScode/DeepSeekHarness/resources/app.asar/dsh/node_modules'
const require = createRequire(`${appModules}/`)
const sharp = require(`${appModules}/sharp`)

const sourcePath = process.argv[2] ?? process.env.DSH_MASK_SOURCE
if (sourcePath === undefined) {
  console.error('usage: make-mask.mjs <source image>')
  process.exit(2)
}
/** The long edge of the emitted mask; the icon draws it at 20 px. */
const LONG_EDGE = Number(process.env.DSH_MASK_LONG_EDGE ?? 96)
/** Alpha below this counts as empty when measuring the glyph box. */
const EMPTY_ALPHA = 8
/** How far above the plane the key starts, and the floor for its upper bound. */
const KNEE = 12
const MIN_RANGE = 40

const frame = await sharp(sourcePath).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const { width, height, channels } = frame.info
const luma = new Float32Array(width * height)
const histogram = new Array(256).fill(0)
for (let pixel = 0; pixel < width * height; pixel++) {
  const at = pixel * channels
  const value = 0.2126 * frame.data[at] + 0.7152 * frame.data[at + 1] + 0.0722 * frame.data[at + 2]
  luma[pixel] = value
  histogram[Math.min(255, Math.round(value))]++
}
let plane = 0
for (let i = 1; i < 256; i++) if (histogram[i] > histogram[plane]) plane = i
const lo = Number(process.env.DSH_MASK_KEY_LO ?? plane + KNEE)
const above = []
for (let i = lo + 1; i < 256; i++) for (let n = 0; n < histogram[i]; n++) above.push(i)
above.sort((a, b) => a - b)
const derivedHi = Math.max(lo + MIN_RANGE, above.length === 0 ? 255 : above[Math.floor(above.length * 0.97)])
// The shipped icon was keyed with hi = 191; pin it (DSH_MASK_KEY_HI=191) to reproduce it byte for byte.
const hi = Number(process.env.DSH_MASK_KEY_HI ?? derivedHi)

const alpha = Buffer.alloc(width * height)
let minX = width
let minY = height
let maxX = -1
let maxY = -1
for (let pixel = 0; pixel < width * height; pixel++) {
  const value = Math.max(0, Math.min(255, Math.round((luma[pixel] - lo) * 255 / (hi - lo))))
  alpha[pixel] = value
  if (value > EMPTY_ALPHA) {
    const x = pixel % width
    const y = (pixel - x) / width
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
}
if (maxX < 0) throw new Error('every pixel keyed to empty; is the artwork dark-on-light instead?')

const box = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
const scale = LONG_EDGE / Math.max(box.width, box.height)
const target = { width: Math.round(box.width * scale), height: Math.round(box.height * scale) }
const rgba = Buffer.alloc(box.width * box.height * 4)
for (let y = 0; y < box.height; y++) {
  for (let x = 0; x < box.width; x++) {
    const at = (y * box.width + x) * 4
    rgba[at] = 255
    rgba[at + 1] = 255
    rgba[at + 2] = 255
    rgba[at + 3] = alpha[(y + box.top) * width + (x + box.left)]
  }
}
const png = await sharp(rgba, { raw: { width: box.width, height: box.height, channels: 4 } })
  .resize(target.width, target.height, { fit: 'fill', kernel: 'lanczos3' })
  .png({ compressionLevel: 9, effort: 10 })
  .toBuffer()

const base64 = png.toString('base64')
fs.writeFileSync(path.join(here, '..', 'lib', 'tail-mask.base64'), `${base64}\n`)
console.log(`key ${lo}..${hi}; glyph ${box.width}x${box.height} -> ${target.width}x${target.height}; ${png.length} bytes`)
console.log('paste into lib/client.js (one line):')
console.log(`\t\tconst TAIL_MASK = "data:image/png;base64,${base64}";`)
