import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))

const DEFAULT_SEQUENCE_SECONDS = 15.9
const DEFAULT_REPEAT_PAUSE_SECONDS = 5
const DEFAULT_DURATION_SECONDS = DEFAULT_SEQUENCE_SECONDS * 2 + DEFAULT_REPEAT_PAUSE_SECONDS + 1
const DEFAULT_TRANSITION_SECONDS = 0.55
const DEFAULT_BASE_URL = 'http://127.0.0.1:4321'
const DEFAULT_PIPELINE = 'tsl'
const DEFAULT_CAPTURE = 'canvas'
const DEFAULT_VIDEO_BITRATE = 30_000_000

const overlayStyles = [
  ['default', 'Default Overlay'],
  ['volumeCursor', 'Volume Cursor'],
  ['trail', 'Trail'],
  ['oil', 'Oil'],
  ['velocity', 'Velocity'],
  ['colorful', 'Colorful'],
  ['rainbowFish', 'Rainbow Fish'],
  ['glaze', 'Glaze'],
  ['burn', 'Burn'],
  ['smoke', 'Smoke'],
  ['artInk', 'Art Ink'],
  ['rainbowInk', 'Rainbow Ink'],
  ['colorWater', 'Color Water'],
  ['liquidLens', 'Liquid Lens'],
]

const distortionStyles = [
  ['simple', 'Simple Distortion'],
  ['rgbShift', 'RGB Shift'],
  ['chromatic', 'Chromatic Distortion'],
  ['water', 'Water Distortion'],
  ['waterCaustics', 'Water + Caustics'],
]

const particleClips = [
  ['particles-2d', 'Particles 2D', '/examples/glsl/full/particles-2d/'],
  ['particles-3d', 'Particles 3D', '/examples/glsl/full/particles-3d/'],
  ['particles-trefoil', 'Trefoil Particles', '/examples/glsl/full/particles-trefoil/'],
]

const heroIds = new Set([
  'overlay-trail',
  'overlay-oil',
  'overlay-colorful',
  'overlay-smoke',
  'overlay-colorWater',
  'overlay-liquidLens',
  'distortion-rgbShift',
  'distortion-waterCaustics',
  'particles-2d',
  'particles-3d',
  'particles-trefoil',
])

function argValue(name, fallback) {
  const prefix = `--${name}=`
  const exact = `--${name}`
  const index = process.argv.indexOf(exact)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  return inline ? inline.slice(prefix.length) : fallback
}

function hasArg(name) {
  return process.argv.includes(`--${name}`)
}

function makeDemoUrl(baseUrl, route, params) {
  const url = new URL(route, `${baseUrl.replace(/\/+$/, '')}/`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  return url.href
}

const demoMotionOverrides = {
  'particles-2d': { forceScale: 0.45 },
  'particles-3d': { forceScale: 0.42 },
  'particles-trefoil': { forceScale: 0.48 },
}

const demoMotions = [
  'all',
  'sSweep',
  'spiralBloom',
  'softWhip',
  'breathingOrbit',
  'diagonalReveal',
  'sweepSpiral',
  'infinity',
]
const demoMotionAliases = new Map([
  ['s-sweep', 'sSweep'],
  ['spiral-bloom', 'spiralBloom'],
  ['soft-whip', 'softWhip'],
  ['breathing-orbit', 'breathingOrbit'],
  ['diagonal-reveal', 'diagonalReveal'],
  ['sweep-spiral', 'sweepSpiral'],
])
const demoMotionSet = new Set(demoMotions)

function normalizeDemoMotion(motion) {
  if (!motion) return ''
  const canonical = demoMotionAliases.get(motion) ?? motion
  if (demoMotionSet.has(canonical)) return canonical
  throw new Error(`Unknown --motion=${motion}. Use one of: ${demoMotions.join(', ')}.`)
}

function demoClipParams(id, common, params) {
  return {
    ...common,
    ...(demoMotionOverrides[id] ?? {}),
    ...params,
  }
}

function buildCatalog(
  baseUrl,
  profile,
  pipeline,
  durationSeconds,
  motion,
  motionPause,
  repeatPause,
) {
  if (pipeline !== 'tsl' && pipeline !== 'glsl') {
    throw new Error(`Unknown --pipeline=${pipeline}. Use "tsl" or "glsl".`)
  }
  const normalizedMotion = normalizeDemoMotion(motion)

  const common = {
    demo: '1',
    demoStart: 'manual',
    profile,
    duration: durationSeconds,
    ...(motionPause ? { motionPause } : {}),
    ...(repeatPause ? { repeatPause } : {}),
    ...(normalizedMotion ? { motion: normalizedMotion } : {}),
  }
  const clips = [
    ...overlayStyles.map(([style, title]) => ({
      id: `overlay-${style}`,
      title,
      url: makeDemoUrl(
        baseUrl,
        `/examples/${pipeline}/full/overlay/`,
        demoClipParams(`overlay-${style}`, common, {
          style,
          label: title,
        }),
      ),
    })),
    ...distortionStyles.map(([style, title]) => ({
      id: `distortion-${style}`,
      title,
      url: makeDemoUrl(
        baseUrl,
        `/examples/${pipeline}/full/distortion/`,
        demoClipParams(`distortion-${style}`, common, {
          style,
          label: title,
        }),
      ),
    })),
    ...particleClips.map(([id, title, route]) => ({
      id,
      title,
      url: makeDemoUrl(
        baseUrl,
        route.replace('/examples/glsl/', `/examples/${pipeline}/`),
        demoClipParams(id, common, {
          label: title,
        }),
      ),
    })),
  ]

  return clips
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}

async function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(url)) return
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function maybeStartServer(baseUrl) {
  if (await isReachable(baseUrl)) return undefined
  if (hasArg('no-server') || process.env.FLUID_DEMO_URL || baseUrl !== DEFAULT_BASE_URL) {
    throw new Error(`${baseUrl} is not reachable. Start the Vite dev server first.`)
  }

  const child = spawn('npm', ['run', 'dev'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stopping = false
  let serverOutput = ''
  const remember = (chunk) => {
    serverOutput = `${serverOutput}${String(chunk)}`.slice(-4000)
  }
  child.stdout.on('data', (chunk) => {
    remember(chunk)
    if (hasArg('verbose')) process.stdout.write(String(chunk))
  })
  child.stderr.on('data', (chunk) => {
    remember(chunk)
    if (hasArg('verbose')) process.stderr.write(String(chunk))
  })
  child.on('exit', (code) => {
    if (!stopping && code !== 0 && code !== null) {
      process.stderr.write(`Vite dev server exited with code ${code}\n`)
    }
  })

  try {
    await waitForServer(baseUrl)
  } catch (error) {
    stopping = true
    child.kill('SIGTERM')
    throw new Error(`${error.message}\n${serverOutput}`.trim())
  }

  return {
    stop() {
      stopping = true
      child.kill('SIGTERM')
    },
  }
}

async function recordClip(browser, clip, options) {
  const usePlaywrightVideo = options.capture === 'playwright'
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1,
    ...(usePlaywrightVideo
      ? {
          recordVideo: {
            dir: options.tmpDir,
            size: { width: options.width, height: options.height },
          },
        }
      : {}),
  })
  const pageStartedAt = Date.now()
  const page = await context.newPage()

  await page.goto(clip.url, { waitUntil: 'networkidle' })
  await page.waitForSelector('canvas', { timeout: 15000 })
  await page.waitForFunction(() => window.__fluidDemoReady === true, undefined, {
    timeout: 15000,
  })

  const outputPath = join(options.clipsDir, `${clip.id}.webm`)
  if (usePlaywrightVideo) {
    await page.addStyleTag({ content: '.demo-reel-label{display:none!important}' })
    const video = page.video()
    if (!video) throw new Error('Playwright did not create a video recorder')
    const demoStartedAt = Date.now()
    await page.evaluate(() => window.__fluidDemoStart?.())
    await page.waitForTimeout(options.durationSeconds * 1000)
    await context.close()
    const videoPath = await video.path()
    await rm(outputPath, { force: true })
    await rename(videoPath, outputPath)
    return {
      outputPath,
      trimStartSeconds: Math.max(0, (demoStartedAt - pageStartedAt) / 1000),
    }
  }

  const recording = await page.evaluate(
    async ({ bitrate, durationMs, fps }) => {
      const canvas = document.querySelector('canvas')
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing canvas')
      if (!('captureStream' in canvas)) throw new Error('canvas.captureStream is not available')
      if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is not available')

      const stream = canvas.captureStream(fps)
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
          ? 'video/webm;codecs=vp8'
          : 'video/webm'
      const recorderOptions = { mimeType }
      if (Number.isFinite(bitrate) && bitrate > 0) recorderOptions.videoBitsPerSecond = bitrate
      const chunks = []
      const recorder = new MediaRecorder(stream, recorderOptions)
      const stopped = new Promise((resolveStop, rejectStop) => {
        recorder.onstop = resolveStop
        recorder.onerror = () => rejectStop(recorder.error ?? new Error('MediaRecorder failed'))
      })

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }

      window.__fluidDemoStart?.()
      recorder.start(100)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs))
      recorder.stop()
      await stopped
      for (const track of stream.getTracks()) track.stop()

      const blob = new Blob(chunks, { type: mimeType })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      const chunkSize = 0x8000
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
      }

      return { base64: btoa(binary) }
    },
    { bitrate: options.bitrate, durationMs: options.durationSeconds * 1000, fps: options.fps },
  )

  await rm(outputPath, { force: true })
  await writeFile(outputPath, Buffer.from(recording.base64, 'base64'))
  await context.close()
  return { outputPath, trimStartSeconds: 0 }
}

const baseUrl = argValue('base-url', process.env.FLUID_DEMO_URL ?? DEFAULT_BASE_URL)
const setName = argValue('set', process.env.FLUID_DEMO_SET ?? 'catalog')
const profile = argValue('profile', process.env.FLUID_DEMO_PROFILE ?? 'quality')
const pipeline = argValue('pipeline', process.env.FLUID_DEMO_PIPELINE ?? DEFAULT_PIPELINE)
const capture = argValue('capture', process.env.FLUID_DEMO_CAPTURE ?? DEFAULT_CAPTURE)
const motion = argValue('motion', process.env.FLUID_DEMO_MOTION ?? '')
const motionPause = argValue('motion-pause', process.env.FLUID_DEMO_MOTION_PAUSE ?? '')
const repeatPause = argValue('repeat-pause', process.env.FLUID_DEMO_REPEAT_PAUSE ?? '')
const clipFilter = argValue('clip', process.env.FLUID_DEMO_CLIP ?? '')
const limit = Number(argValue('limit', process.env.FLUID_DEMO_LIMIT ?? '0'))
const width = Number(argValue('width', process.env.FLUID_DEMO_WIDTH ?? '1920'))
const height = Number(argValue('height', process.env.FLUID_DEMO_HEIGHT ?? '1080'))
const fps = Number(argValue('fps', process.env.FLUID_DEMO_FPS ?? '30'))
const bitrate = Number(argValue('bitrate', process.env.FLUID_DEMO_BITRATE ?? DEFAULT_VIDEO_BITRATE))
const durationSeconds = Number(argValue('duration', DEFAULT_DURATION_SECONDS))
const transitionSeconds = Number(argValue('transition', DEFAULT_TRANSITION_SECONDS))
const outDir = resolve(
  repoRoot,
  argValue('out', process.env.FLUID_DEMO_OUT ?? `demo-output/${setName}`),
)
const clipsDir = join(outDir, 'clips')
const tmpDir = join(outDir, '.tmp-video')

if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
  throw new Error('Invalid --width/--height')
}
if (capture !== 'canvas' && capture !== 'playwright') {
  throw new Error('Invalid --capture. Use "canvas" or "playwright".')
}
if (!Number.isFinite(fps) || fps < 1) {
  throw new Error('Invalid --fps')
}
if (!Number.isFinite(bitrate) || bitrate < 0) {
  throw new Error('Invalid --bitrate')
}
if (motionPause && (!Number.isFinite(Number(motionPause)) || Number(motionPause) < 0)) {
  throw new Error('Invalid --motion-pause')
}
if (repeatPause && (!Number.isFinite(Number(repeatPause)) || Number(repeatPause) < 0)) {
  throw new Error('Invalid --repeat-pause')
}

const allClips = buildCatalog(
  baseUrl,
  profile,
  pipeline,
  durationSeconds,
  motion,
  motionPause,
  repeatPause,
)
const clips =
  setName === 'catalog'
    ? allClips
    : setName === 'hero'
      ? allClips.filter((clip) => heroIds.has(clip.id))
      : undefined

if (!clips) throw new Error(`Unknown --set=${setName}. Use "catalog" or "hero".`)
const filteredClips = clipFilter ? clips.filter((clip) => clip.id === clipFilter) : clips
const selectedClips = limit > 0 ? filteredClips.slice(0, limit) : filteredClips
if (selectedClips.length === 0) {
  throw new Error(
    `No clips selected for set "${setName}"${clipFilter ? ` and clip "${clipFilter}"` : ''}`,
  )
}

await mkdir(clipsDir, { recursive: true })
await mkdir(tmpDir, { recursive: true })

let server
let browser
try {
  server = await maybeStartServer(baseUrl)
  browser = await chromium.launch({
    headless: !hasArg('headed'),
    args:
      pipeline === 'tsl'
        ? [
            '--enable-unsafe-webgpu',
            '--ignore-gpu-blocklist',
            '--enable-features=WebGPU',
            '--use-angle=metal',
          ]
        : [],
  })

  const recorded = []
  for (let i = 0; i < selectedClips.length; i += 1) {
    const clip = selectedClips[i]
    process.stdout.write(`[${i + 1}/${selectedClips.length}] recording ${clip.id}\n`)
    const recording = await recordClip(browser, clip, {
      width,
      height,
      durationSeconds,
      fps,
      bitrate,
      capture,
      clipsDir,
      tmpDir,
      pipeline,
    })
    recorded.push({
      ...clip,
      file: recording.outputPath,
      relativeFile: `clips/${clip.id}.webm`,
      trimStartSeconds: recording.trimStartSeconds,
    })
  }

  const manifest = {
    package: pkg.name,
    set: setName,
    pipeline,
    capture,
    profile,
    baseUrl,
    width,
    height,
    fps,
    bitrate,
    durationSeconds,
    transitionSeconds,
    clips: recorded,
  }
  const manifestPath = join(outDir, 'manifest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  process.stdout.write(`Wrote ${manifestPath}\n`)
} finally {
  if (browser) await browser.close()
  if (server) server.stop()
}
