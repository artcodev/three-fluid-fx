import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argValue(name, fallback) {
  const prefix = `--${name}=`
  const exact = `--${name}`
  const index = process.argv.indexOf(exact)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  return inline ? inline.slice(prefix.length) : fallback
}

function ensureCommand(command) {
  const result = spawnSync(command, ['-version'], { stdio: 'ignore' })
  if (result.status !== 0) throw new Error(`${command} is required for stitching demo videos`)
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', rejectRun)
    child.on('exit', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} exited with code ${code}`))
    })
  })
}

function seconds(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function escapeDrawtext(text) {
  return String(text)
    .replaceAll('\\', '\\\\')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'")
    .replaceAll(',', '\\,')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
}

function buildFilter(manifest, options) {
  const width = Number(manifest.width)
  const height = Number(manifest.height)
  const fps = Number(manifest.fps)
  const duration = seconds(manifest.durationSeconds, 4.8)
  const transition = seconds(manifest.transitionSeconds, 0.55)
  const filters = manifest.clips.map((clip, index) => {
    const trimStart = seconds(clip.trimStartSeconds, 0)
    const label = options.labels
      ? `,drawtext=text='${escapeDrawtext(clip.title ?? clip.id)}':x=30:y=h-58:` +
        'fontsize=26:fontcolor=0xf3f0e8:box=1:boxcolor=0x07080b@0.62:boxborderw=10'
      : ''
    return (
      `[${index}:v]trim=start=${trimStart}:duration=${duration},setpts=PTS-STARTPTS,fps=${fps},` +
      `scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height},format=rgba${label}[v${index}]`
    )
  })

  if (manifest.clips.length === 1) {
    filters.push('[v0]format=yuv420p[outv]')
    return filters.join(';')
  }

  let current = '[v0]'
  for (let i = 1; i < manifest.clips.length; i += 1) {
    const output = i === manifest.clips.length - 1 ? '[outv]' : `[x${i}]`
    const offset = (duration - transition) * i
    filters.push(
      `${current}[v${i}]xfade=transition=fade:duration=${transition}:offset=${offset.toFixed(3)}${output}`,
    )
    current = output
  }

  return filters.join(';')
}

const setName = argValue('set', process.env.FLUID_DEMO_SET ?? 'catalog')
const outDir = resolve(
  repoRoot,
  argValue('out', process.env.FLUID_DEMO_OUT ?? `demo-output/${setName}`),
)
const manifestPath = resolve(repoRoot, argValue('manifest', join(outDir, 'manifest.json')))
const outputPath = resolve(repoRoot, argValue('video', join(outDir, `${setName}-demo-reel.mp4`)))
const crf = argValue('crf', process.env.FLUID_DEMO_CRF ?? '18')
const preset = argValue('preset', process.env.FLUID_DEMO_PRESET ?? 'medium')
const ffmpegLogLevel = argValue('ffmpeg-loglevel', process.env.FFMPEG_LOGLEVEL ?? 'error')
const labels = !process.argv.includes('--no-labels')

ensureCommand('ffmpeg')

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (!Array.isArray(manifest.clips) || manifest.clips.length === 0) {
  throw new Error(`No clips found in ${manifestPath}`)
}

const inputArgs = manifest.clips.flatMap((clip) => [
  '-i',
  resolve(dirname(manifestPath), clip.relativeFile),
])
const filter = buildFilter(manifest, { labels })
const args = [
  '-hide_banner',
  '-loglevel',
  ffmpegLogLevel,
  '-y',
  ...inputArgs,
  '-filter_complex',
  filter,
  '-map',
  '[outv]',
  '-an',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-preset',
  preset,
  '-crf',
  crf,
  outputPath,
]

await run('ffmpeg', args)
process.stdout.write(`Wrote ${outputPath}\n`)
