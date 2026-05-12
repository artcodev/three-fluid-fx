import { writeFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { chromium } from 'playwright'

const baseUrl = process.env.FLUID_DEMO_URL ?? 'http://127.0.0.1:4321'
const pages = [
  ['glsl-full-overlay', '/examples/glsl/full/overlay/'],
  ['glsl-full-distortion', '/examples/glsl/full/distortion/'],
  ['glsl-full-particles-2d', '/examples/glsl/full/particles-2d/'],
  ['glsl-full-particles-3d', '/examples/glsl/full/particles-3d/'],
]
const viewports = [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function parsePng(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') throw new Error('Not a PNG')

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += length + 12
  }

  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`)

  const compressed = Buffer.concat(idat)
  const raw = inflateSync(compressed)
  const stride = width * channels
  const pixels = Buffer.alloc(width * height * channels)
  let rawOffset = 0
  let pixelOffset = 0

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset]
    rawOffset += 1
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rawOffset + x]
      const left = x >= channels ? pixels[pixelOffset + x - channels] : 0
      const up = y > 0 ? pixels[pixelOffset + x - stride] : 0
      const upLeft = y > 0 && x >= channels ? pixels[pixelOffset + x - stride - channels] : 0
      let out = value
      if (filter === 1) out = value + left
      else if (filter === 2) out = value + up
      else if (filter === 3) out = value + Math.floor((left + up) / 2)
      else if (filter === 4) out = value + paeth(left, up, upLeft)
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`)
      pixels[pixelOffset + x] = out & 255
    }
    rawOffset += stride
    pixelOffset += stride
  }

  return { width, height, channels, pixels }
}

function imageStats(buffer) {
  const png = parsePng(buffer)
  const unique = new Set()
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let i = 0; i < png.pixels.length; i += png.channels * 7) {
    const r = png.pixels[i]
    const g = png.pixels[i + 1]
    const b = png.pixels[i + 2]
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sum += lum
    sumSq += lum * lum
    count += 1
    if (unique.size < 5000) unique.add(`${r},${g},${b}`)
  }
  const mean = sum / count
  const variance = sumSq / count - mean * mean
  return {
    width: png.width,
    height: png.height,
    unique: unique.size,
    mean,
    stddev: Math.sqrt(Math.max(0, variance)),
    pixels: png.pixels,
    channels: png.channels,
  }
}

function averageDiff(a, b) {
  const first = imageStats(a)
  const second = imageStats(b)
  const length = Math.min(first.pixels.length, second.pixels.length)
  let total = 0
  let count = 0
  for (let i = 0; i < length; i += first.channels * 13) {
    total += Math.abs(first.pixels[i] - second.pixels[i])
    total += Math.abs(first.pixels[i + 1] - second.pixels[i + 1])
    total += Math.abs(first.pixels[i + 2] - second.pixels[i + 2])
    count += 3
  }
  return total / count
}

const browser = await chromium.launch({ headless: true })
const results = []

try {
  for (const [pageName, path] of pages) {
    for (const [viewportName, viewport] of viewports) {
      const page = await browser.newPage({ viewport })
      await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      await page.mouse.move(viewport.width * 0.35, viewport.height * 0.42)
      await page.mouse.move(viewport.width * 0.68, viewport.height * 0.57, { steps: 12 })
      await page.waitForTimeout(650)

      const canvasInfo = await page.evaluate(() => {
        const canvas = document.querySelector('#stage canvas')
        const rect = canvas?.getBoundingClientRect()
        return canvas && rect
          ? {
              width: canvas.width,
              height: canvas.height,
              clientWidth: Math.round(rect.width),
              clientHeight: Math.round(rect.height),
            }
          : null
      })
      if (!canvasInfo) throw new Error(`${pageName}/${viewportName}: canvas missing`)

      const demoCanvas = page.locator('#stage canvas').first()
      const first = await demoCanvas.screenshot()
      await page.waitForTimeout(500)
      const second = await demoCanvas.screenshot()
      const stats = imageStats(second)
      const diff = averageDiff(first, second)
      const outPath = `/private/tmp/fluid-sim-standalone-${pageName}-${viewportName}.png`
      await writeFile(outPath, second)
      await page.close()

      const ok =
        canvasInfo.width > 0 &&
        canvasInfo.height > 0 &&
        stats.unique > 80 &&
        stats.stddev > 4 &&
        diff > 0.08

      results.push({
        page: pageName,
        viewport: viewportName,
        canvas: canvasInfo,
        unique: stats.unique,
        mean: Number(stats.mean.toFixed(2)),
        stddev: Number(stats.stddev.toFixed(2)),
        frameDiff: Number(diff.toFixed(3)),
        screenshot: outPath,
        ok,
      })

      if (!ok) {
        throw new Error(`${pageName}/${viewportName}: render check failed`)
      }
    }
  }
} finally {
  await browser.close()
}

console.log(JSON.stringify(results, null, 2))
