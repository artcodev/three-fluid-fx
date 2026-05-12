import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const sourcePath = join(repoRoot, 'examples/extras/demo/reel.ts')
const astroDir = join(repoRoot, 'dist/_astro')
const distLibDir = join(repoRoot, 'dist-lib')

const limits = {
  demoSourceRaw: 24 * 1024,
  demoSourceGzip: 6 * 1024,
  reelChunkGzip: 42 * 1024,
}

const markerPattern =
  /Click to take control|sSweep|spiralBloom|softWhip|breathingOrbit|diagonalReveal|sweepSpiral|motionPause/

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function fileSize(filePath) {
  const bytes = readFileSync(filePath)
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes).length,
    text: bytes.toString('utf8'),
  }
}

function walkFiles(dirPath) {
  if (!existsSync(dirPath)) return []
  const entries = readdirSync(dirPath, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const entryPath = join(dirPath, entry.name)
    if (entry.isDirectory()) return walkFiles(entryPath)
    if (!entry.isFile()) return []
    return entryPath
  })
}

function findReelChunk() {
  if (!existsSync(astroDir)) return undefined
  return readdirSync(astroDir)
    .filter((name) => /^reel\..*\.js$/.test(name))
    .map((name) => join(astroDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

function assertBudget(label, value, limit, failures) {
  const status = value <= limit ? 'ok' : 'over'
  console.log(`${status.padEnd(4)} ${label.padEnd(24)} ${formatBytes(value)} / ${formatBytes(limit)}`)
  if (value > limit) failures.push(`${label}: ${formatBytes(value)} > ${formatBytes(limit)}`)
}

const failures = []
const source = fileSize(sourcePath)

assertBudget('demo source raw', source.raw, limits.demoSourceRaw, failures)
assertBudget('demo source gzip', source.gzip, limits.demoSourceGzip, failures)

const reelChunk = findReelChunk()
if (!reelChunk) {
  failures.push('missing dist/_astro/reel.*.js; run npm run build first')
} else {
  const chunk = fileSize(reelChunk)
  assertBudget('reel chunk gzip', chunk.gzip, limits.reelChunkGzip, failures)
  console.log(`info ${reelChunk.replace(`${repoRoot}/`, '')} raw ${formatBytes(chunk.raw)}`)
}

const libHits = walkFiles(distLibDir)
  .filter((filePath) => filePath.endsWith('.js'))
  .filter((filePath) => markerPattern.test(readFileSync(filePath, 'utf8')))

if (libHits.length > 0) {
  const files = libHits.map((file) => file.replace(`${repoRoot}/`, '')).join(', ')
  failures.push(`demo markers leaked into dist-lib: ${files}`)
} else {
  console.log('ok   dist-lib isolation       no demo gesture markers')
}

if (failures.length > 0) {
  console.error('\nDemo bundle size check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
