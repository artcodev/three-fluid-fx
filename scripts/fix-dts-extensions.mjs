import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { extname, join } from 'node:path'

const root = fileURLToPath(new URL('../dist-lib/', import.meta.url))

const RELATIVE_EXPORT_RE =
  /\b(from\s+['"])(\.{1,2}\/[^'"]+?)(['"])/g

const hasKnownExtension = (specifier) => extname(specifier) !== ''

const fixFile = async (path) => {
  const source = await readFile(path, 'utf8')
  const fixed = source.replace(RELATIVE_EXPORT_RE, (match, prefix, specifier, suffix) => {
    if (hasKnownExtension(specifier)) return match
    return `${prefix}${specifier}.js${suffix}`
  })

  if (fixed !== source) {
    await writeFile(path, fixed)
  }
}

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.isFile() && path.endsWith('.d.ts')) {
        await fixFile(path)
      }
    }),
  )
}

await walk(root)
