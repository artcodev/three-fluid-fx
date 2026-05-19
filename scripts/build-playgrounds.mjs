import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const examplesDir = path.join(rootDir, 'examples')
const examplesJsDir = path.join(rootDir, 'examples-js')
const playgroundsDir = path.join(rootDir, 'playgrounds')
const playgroundsJsDir = path.join(rootDir, 'playgrounds-js')
const rootPackage = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'))

const REPO_OWNER = 'artcodev'
const REPO_NAME = 'three-fluid-fx'
const BRANCH = 'main'

const importSpecifierPattern =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s*)?['"]([^'"]+)['"]/g

const titleByCase = {
  helloworld: 'Hello World',
  overlay: 'Overlay',
  distortion: 'Distortion',
  'particles-trefoil': 'Simple Particles',
  'particles-2d': 'GPGPU Particles 2D',
  'particles-3d': 'GPGPU Particles 3D',
  combined: 'Combined Demo',
  mega: 'Mega Demo',
  'fluid-text': 'Fluid Text',
}

const playgroundSpecs = [
  {
    language: 'ts',
    label: 'TypeScript',
    sourceDir: examplesDir,
    outputDir: playgroundsDir,
    outputFolder: 'playgrounds',
    copiedSourceDir: 'examples',
    extension: 'ts',
    entryName: 'main.ts',
    runtimeName: 'playground-runtime.ts',
    viteConfigName: 'vite.config.ts',
    includeTsconfig: true,
    packageNamePrefix: 'three-fluid-fx-playground',
  },
  {
    language: 'js',
    label: 'JavaScript',
    sourceDir: examplesJsDir,
    outputDir: playgroundsJsDir,
    outputFolder: 'playgrounds-js',
    copiedSourceDir: 'examples-js',
    extension: 'js',
    entryName: 'main.js',
    runtimeName: 'playground-runtime.js',
    viteConfigName: 'vite.config.mjs',
    includeTsconfig: false,
    packageNamePrefix: 'three-fluid-fx-playground-js',
  },
]

function asPosix(value) {
  return value.split(path.sep).join('/')
}

function relativeImport(fromDir, target) {
  let value = asPosix(path.relative(fromDir, target))
  if (!value.startsWith('.')) value = `./${value}`
  return value
}

function getPackageVersion(name, fallback = undefined) {
  return (
    rootPackage.dependencies?.[name] ??
    rootPackage.devDependencies?.[name] ??
    rootPackage.peerDependencies?.[name] ??
    fallback
  )
}

function playgroundIdFromSlug(slug) {
  return slug.replaceAll('/', '-')
}

function titleFromSlug(slug) {
  const [engine, level, caseId] = slug.split('/')
  const caseTitle = titleByCase[caseId] ?? caseId
  return `${caseTitle} ${engine.toUpperCase()} ${level}`
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

async function copyDirectoryFiltered(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true })
  const entries = await readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue

    const source = path.join(sourceDir, entry.name)
    const target = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      await copyDirectoryFiltered(source, target)
    } else {
      await cp(source, target)
    }
  }
}

async function resolveRelativeModule(fromFile, specifier, spec) {
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [
    base,
    `${base}.${spec.extension}`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, `index.${spec.extension}`),
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ]

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }

  throw new Error(`Could not resolve "${specifier}" from ${path.relative(rootDir, fromFile)}`)
}

async function collectDependencies(entryFile, spec) {
  const pending = [entryFile]
  const files = new Set()
  let usesBackdrops = false

  while (pending.length > 0) {
    const file = pending.pop()
    if (!file || files.has(file)) continue

    files.add(file)
    if (file === path.join(spec.sourceDir, `extras/backgrounds/defaults.${spec.extension}`)) {
      usesBackdrops = true
    }

    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(importSpecifierPattern)) {
      const importSpecifier = match[1]
      if (!importSpecifier.startsWith('.')) continue

      const resolved = await resolveRelativeModule(file, importSpecifier, spec)
      if (resolved === path.join(rootDir, 'src/styles.css')) continue

      if (!resolved.startsWith(spec.sourceDir + path.sep)) {
        throw new Error(
          `Unexpected local import outside ${path.relative(rootDir, spec.sourceDir)}/: ${path.relative(rootDir, resolved)}`,
        )
      }

      pending.push(resolved)
    }
  }

  return { files: Array.from(files).sort(), usesBackdrops }
}

async function copyDependencyFile(file, spec, playgroundSrcDir) {
  const relative = path.relative(spec.sourceDir, file)
  const output = path.join(playgroundSrcDir, spec.copiedSourceDir, relative)
  const outputDir = path.dirname(output)
  await mkdir(outputDir, { recursive: true })

  let source = await readFile(file, 'utf8')
  const styleImport = relativeImport(outputDir, path.join(playgroundSrcDir, 'styles.css'))
  source = source
    .replaceAll("'../../../../src/styles.css'", `'${styleImport}'`)
    .replaceAll('"../../../../src/styles.css"', `"${styleImport}"`)

  await writeFile(output, source)
}

function packageJsonForPlayground(slug, title, spec) {
  const devDependencies = {
    '@tailwindcss/typography': getPackageVersion('@tailwindcss/typography'),
    '@tailwindcss/vite': getPackageVersion('@tailwindcss/vite'),
    tailwindcss: getPackageVersion('tailwindcss'),
    vite: getPackageVersion('vite'),
  }

  if (spec.language === 'ts') {
    devDependencies['@types/node'] = getPackageVersion('@types/node')
    devDependencies['@types/three'] = getPackageVersion('@types/three')
    devDependencies.typescript = getPackageVersion('typescript')
  }

  return {
    name: `${spec.packageNamePrefix}-${playgroundIdFromSlug(slug)}`,
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite --host 0.0.0.0',
      build: 'vite build',
      preview: 'vite preview --host 0.0.0.0',
    },
    dependencies: {
      '@tweakpane/core': getPackageVersion('@tweakpane/core'),
      three: getPackageVersion('three'),
      'three-fluid-fx': `^${rootPackage.version}`,
      tweakpane: getPackageVersion('tweakpane'),
    },
    devDependencies,
    stackblitz: {
      title: `${title} (${spec.label})`,
      startCommand: 'npm run dev',
    },
  }
}

function indexHtmlForPlayground(title, spec) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} - three-fluid-fx ${spec.label} playground</title>
  </head>
  <body>
    <div class="app-shell">
      <main id="stage" class="stage" aria-label="${title} canvas"></main>
    </div>
    <script type="module" src="/src/${spec.entryName}"></script>
  </body>
</html>
`
}

function mainForPlayground(slug, spec) {
  return `import './${spec.runtimeName}'
import './${spec.copiedSourceDir}/${slug}/main.${spec.extension}'
`
}

function runtimeTsForPlayground() {
  return `interface BackgroundChoiceItem {
  value: string
  label: string
}

interface BackgroundControlRegistration {
  choices: readonly BackgroundChoiceItem[]
  active: string
  onSelect: (choice: string) => void
}

interface BackgroundControlHandle {
  setActive: (choice: string) => void
  dispose: () => void
}

interface ExamplePageRuntime {
  registerBackgroundControl: (
    registration: BackgroundControlRegistration,
  ) => BackgroundControlHandle
  setDemoMode: (label: string) => void
}

declare global {
  interface Window {
    __fluidExamplePage?: ExamplePageRuntime
  }
}

const params = new URLSearchParams(window.location.search)
const hiddenUiClass = 'is-example-ui-hidden'

function isEnabled(value: string | null): boolean {
  return value === '1' || value === 'true'
}

function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true

  const target = event.target
  if (!(target instanceof HTMLElement)) return false

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

if (isEnabled(params.get('iframe'))) {
  document.body.classList.add('is-iframe-embed')
}

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Backquote' || shouldIgnoreShortcut(event)) return

  event.preventDefault()
  document.body.classList.toggle(hiddenUiClass)
})

let backgroundContainer: HTMLDivElement | null = null
let demoLabel: HTMLDivElement | null = null

function ensureBackgroundContainer(): HTMLDivElement {
  if (backgroundContainer) return backgroundContainer
  backgroundContainer = document.createElement('div')
  backgroundContainer.className = 'bg-switcher'
  backgroundContainer.setAttribute('aria-label', 'Background')
  document.body.appendChild(backgroundContainer)
  return backgroundContainer
}

window.__fluidExamplePage = {
  registerBackgroundControl(registration) {
    const container = ensureBackgroundContainer()
    container.replaceChildren()

    const buttons = new Map<string, HTMLButtonElement>()
    const setActive = (choice: string): void => {
      for (const [value, button] of buttons) {
        button.classList.toggle('is-active', value === choice)
      }
    }

    for (const choice of registration.choices) {
      const button = document.createElement('button')
      button.className = 'toggle'
      button.type = 'button'
      button.textContent = choice.label
      button.addEventListener('click', () => registration.onSelect(choice.value))
      container.appendChild(button)
      buttons.set(choice.value, button)
    }

    setActive(registration.active)

    return {
      setActive,
      dispose() {
        container.replaceChildren()
        if (backgroundContainer === container) {
          backgroundContainer.remove()
          backgroundContainer = null
        }
      },
    }
  },

  setDemoMode(label) {
    document.body.classList.add('is-demo-reel')
    if (demoLabel) {
      demoLabel.textContent = label
      return
    }

    demoLabel = document.createElement('div')
    demoLabel.className = 'demo-reel-label'
    demoLabel.textContent = label
    document.body.appendChild(demoLabel)
  },
}

export {}
`
}

function runtimeJsForPlayground() {
  return `const params = new URLSearchParams(window.location.search)
const hiddenUiClass = 'is-example-ui-hidden'

function isEnabled(value) {
  return value === '1' || value === 'true'
}

function shouldIgnoreShortcut(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return true

  const target = event.target
  if (!(target instanceof HTMLElement)) return false

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

if (isEnabled(params.get('iframe'))) {
  document.body.classList.add('is-iframe-embed')
}

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Backquote' || shouldIgnoreShortcut(event)) return

  event.preventDefault()
  document.body.classList.toggle(hiddenUiClass)
})

let backgroundContainer = null
let demoLabel = null

function ensureBackgroundContainer() {
  if (backgroundContainer) return backgroundContainer
  backgroundContainer = document.createElement('div')
  backgroundContainer.className = 'bg-switcher'
  backgroundContainer.setAttribute('aria-label', 'Background')
  document.body.appendChild(backgroundContainer)
  return backgroundContainer
}

window.__fluidExamplePage = {
  registerBackgroundControl(registration) {
    const container = ensureBackgroundContainer()
    container.replaceChildren()

    const buttons = new Map()
    const setActive = (choice) => {
      for (const [value, button] of buttons) {
        button.classList.toggle('is-active', value === choice)
      }
    }

    for (const choice of registration.choices) {
      const button = document.createElement('button')
      button.className = 'toggle'
      button.type = 'button'
      button.textContent = choice.label
      button.addEventListener('click', () => registration.onSelect(choice.value))
      container.appendChild(button)
      buttons.set(choice.value, button)
    }

    setActive(registration.active)

    return {
      setActive,
      dispose() {
        container.replaceChildren()
        if (backgroundContainer === container) {
          backgroundContainer.remove()
          backgroundContainer = null
        }
      },
    }
  },

  setDemoMode(label) {
    document.body.classList.add('is-demo-reel')
    if (demoLabel) {
      demoLabel.textContent = label
      return
    }

    demoLabel = document.createElement('div')
    demoLabel.className = 'demo-reel-label'
    demoLabel.textContent = label
    document.body.appendChild(demoLabel)
  },
}

export {}
`
}

function runtimeForPlayground(spec) {
  return spec.language === 'ts' ? runtimeTsForPlayground() : runtimeJsForPlayground()
}

function viteConfigForPlayground() {
  return `import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const useLocalLibrary = process.env.THREE_FLUID_FX_LOCAL === '1'

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: useLocalLibrary
      ? [
          { find: /^three-fluid-fx\\/tsl$/, replacement: resolve(here, '../../src/core/tsl/index.ts') },
          { find: /^three-fluid-fx$/, replacement: resolve(here, '../../src/core/glsl/index.ts') },
        ]
      : [],
  },
})
`
}

function tsconfigForPlayground() {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["src", "vite.config.ts"]
}
`
}

function readmeForPlayground(slug, title, spec) {
  return `# ${title} (${spec.label})

Standalone Vite playground generated from \`${spec.copiedSourceDir}/${slug}/main.${spec.extension}\`.

## Run

\`\`\`sh
pnpm install
pnpm dev
\`\`\`

The package imports \`three-fluid-fx\` from npm so this folder can be opened by itself in StackBlitz or another cloud IDE.

For local repository development before publishing a matching npm package:

\`\`\`sh
THREE_FLUID_FX_LOCAL=1 pnpm dev
\`\`\`
`
}

async function writePlayground({ slug, entryFile }, spec) {
  const id = playgroundIdFromSlug(slug)
  const title = titleFromSlug(slug)
  const outputDir = path.join(spec.outputDir, id)
  const srcDir = path.join(outputDir, 'src')
  const { files, usesBackdrops } = await collectDependencies(entryFile, spec)

  await mkdir(srcDir, { recursive: true })
  await writeFile(
    path.join(outputDir, 'package.json'),
    `${JSON.stringify(packageJsonForPlayground(slug, title, spec), null, 2)}\n`,
  )
  await writeFile(path.join(outputDir, 'index.html'), indexHtmlForPlayground(title, spec))
  await writeFile(path.join(outputDir, spec.viteConfigName), viteConfigForPlayground())
  if (spec.includeTsconfig) {
    await writeFile(path.join(outputDir, 'tsconfig.json'), tsconfigForPlayground())
  }
  await writeFile(path.join(outputDir, 'README.md'), readmeForPlayground(slug, title, spec))
  await writeFile(path.join(srcDir, spec.entryName), mainForPlayground(slug, spec))
  await writeFile(path.join(srcDir, spec.runtimeName), runtimeForPlayground(spec))
  await cp(path.join(rootDir, 'src/styles.css'), path.join(srcDir, 'styles.css'))

  for (const file of files) {
    await copyDependencyFile(file, spec, srcDir)
  }

  if (usesBackdrops) {
    await copyDirectoryFiltered(
      path.join(rootDir, 'public/backdrops'),
      path.join(outputDir, 'public/backdrops'),
    )
  }

  return { id, slug, title, files: files.length, usesBackdrops }
}

async function discoverExamples(spec) {
  const files = await walk(spec.sourceDir)
  return files
    .filter((file) => file.endsWith(`${path.sep}main.${spec.extension}`))
    .map((entryFile) => ({
      entryFile,
      slug: asPosix(path.relative(spec.sourceDir, path.dirname(entryFile))),
    }))
    .filter(({ slug }) => slug.split('/').length === 3)
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

function stackBlitzHref(item, spec) {
  return `https://stackblitz.com/github/${REPO_OWNER}/${REPO_NAME}/tree/${BRANCH}/${spec.outputFolder}/${item.id}?file=src/${spec.copiedSourceDir}/${item.slug}/main.${spec.extension}&startScript=dev`
}

function rootReadmeForPlaygrounds(items, spec) {
  const rows = items
    .map(
      (item) =>
        `| ${item.title} | \`${item.id}\` | [StackBlitz](${stackBlitzHref(item, spec)}) |`,
    )
    .join('\n')

  return `# three-fluid-fx ${spec.label} playgrounds

Each folder is a standalone Vite project for one example. Shared helpers are duplicated into the playground so cloud IDEs can import only that folder.

Regenerate after changing \`${spec.copiedSourceDir}/**\`:

\`\`\`sh
pnpm build:playgrounds
\`\`\`

| Example | Folder | Open |
| --- | --- | --- |
${rows}
`
}

async function buildPlaygrounds(spec) {
  const examples = await discoverExamples(spec)
  await rm(spec.outputDir, { recursive: true, force: true })
  await mkdir(spec.outputDir, { recursive: true })

  const written = []
  for (const example of examples) {
    written.push(await writePlayground(example, spec))
  }

  await writeFile(path.join(spec.outputDir, 'README.md'), rootReadmeForPlaygrounds(written, spec))
  return written.length
}

const counts = []
for (const spec of playgroundSpecs) {
  counts.push({ spec, count: await buildPlaygrounds(spec) })
}

const summary = counts.map(({ spec, count }) => `${count} ${spec.label}`).join(' and ')
console.log(`Generated ${summary} standalone playgrounds.`)
