export type ExampleEngine = 'glsl' | 'tsl'
export type ExampleLevel = 'minimal' | 'full'

export type ExampleCase =
  | 'helloworld'
  | 'overlay'
  | 'distortion'
  | 'particles-trefoil'
  | 'particles-2d'
  | 'particles-3d'
  | 'combined'
  | 'mega'

export interface ExampleEntry {
  slug: string
  engine: ExampleEngine
  level: ExampleLevel
  caseId: ExampleCase
  order: number
  title: string
  shortTitle: string
  eyebrow: string
  description: string
  cardDescription: string
  stageLabel: string
  guideHref: string
  guideLabel: string
  walkthroughHref: string
  source: {
    ts: string
    js?: string
  }
  playgroundLinks: ExamplePlaygroundLink[]
  javascriptPlaygroundLinks: ExamplePlaygroundLink[]
}

export interface ExamplePlaygroundLink {
  label: 'CodeSandbox' | 'StackBlitz' | 'Gitpod' | 'GitHub.dev'
  href: string
}

export interface ExampleCaseSummary {
  id: ExampleCase
  title: string
  badge?: string
  description: string
}

export interface ExampleGroupMeta {
  engine: ExampleEngine
  level: ExampleLevel
  label: string
}

export interface ExampleGroupLink extends ExampleGroupMeta {
  href: string
  current: boolean
}

const REPO_OWNER = 'artcodev'
const REPO_NAME = 'three-fluid-fx'
const REPO_BRANCH = 'main'
const REPO_ROOT = `https://github.com/${REPO_OWNER}/${REPO_NAME}`
const REPO = `${REPO_ROOT}/blob/${REPO_BRANCH}`

export const exampleGroups: ExampleGroupMeta[] = [
  { engine: 'tsl', level: 'minimal', label: 'Minimal TSL Examples' },
  { engine: 'glsl', level: 'minimal', label: 'Minimal WebGL Examples' },
  { engine: 'tsl', level: 'full', label: 'Full TSL Examples' },
  { engine: 'glsl', level: 'full', label: 'Full WebGL Examples' },
]

const caseSummaries: ExampleCaseSummary[] = [
  {
    id: 'helloworld',
    title: 'Hello World',
    badge: 'Start here',
    description:
      "The smallest possible integration: density rendered straight to screen. Start here if you've never used the library before.",
  },
  {
    id: 'overlay',
    title: 'Fluid cursor overlay',
    description:
      'Paint interactive colored ink, smoke, oil, and neon trails over your existing three.js scene.',
  },
  {
    id: 'distortion',
    title: 'Screen distortion',
    description:
      'Melt, refract, and smear your scene using the fluid velocity field. Includes 5 built-in styles: simple smear, RGB shift, chromatic split, water, and caustic lens.',
  },
  {
    id: 'particles-2d',
    title: 'GPGPU Particles 2D',
    description:
      'Interactive, 3D-shaded liquid droplets driven by GPGPU velocity advection, springs, and drag.',
  },
  {
    id: 'particles-3d',
    title: 'GPGPU Particles 3D',
    description:
      'A camera-aware, volumetric particle cloud where 2D fluid motion translates into 3D lift and organic flow.',
  },
  {
    id: 'particles-trefoil',
    title: 'Simple Particles',
    description:
      'Dynamically bend procedural geometries using fluid winds, with zero GPGPU physics overhead.',
  },
  {
    id: 'combined',
    title: 'Combined demo',
    badge: 'TSL',
    description:
      'A combined WebGPU scene for checking TSL overlays, distortion and particles in one composition.',
  },
  {
    id: 'mega',
    title: 'Mega demo',
    badge: 'TSL',
    description:
      'A hero-style WebGPU scene with morphing GPGPU particles, fluid distortion, and art ink overlay.',
  },
]

const caseMeta: Record<
  ExampleCase,
  Pick<ExampleEntry, 'guideHref' | 'guideLabel' | 'stageLabel'> & {
    shortTitle: string
  }
> = {
  helloworld: {
    shortTitle: 'Hello World',
    guideHref: '/tutorials/getting-started/',
    guideLabel: 'Getting Started',
    stageLabel: 'Hello World fluid density canvas',
  },
  overlay: {
    shortTitle: 'Overlay',
    guideHref: '/tutorials/effects-guide/',
    guideLabel: 'Effects Guide',
    stageLabel: 'Fluid overlay canvas',
  },
  distortion: {
    shortTitle: 'Distortion',
    guideHref: '/tutorials/effects-guide/',
    guideLabel: 'Effects Guide',
    stageLabel: 'Fluid distortion canvas',
  },
  'particles-trefoil': {
    shortTitle: 'Simple Particles',
    guideHref: '/tutorials/particles-guide/',
    guideLabel: 'Particles Guide',
    stageLabel: 'Simple fluid-displaced particles canvas',
  },
  'particles-2d': {
    shortTitle: 'GPGPU Particles 2D',
    guideHref: '/tutorials/particles-guide/',
    guideLabel: 'Particles Guide',
    stageLabel: 'Fluid displaced GPGPU particles 2D canvas',
  },
  'particles-3d': {
    shortTitle: 'GPGPU Particles 3D',
    guideHref: '/tutorials/particles-guide/',
    guideLabel: 'Particles Guide',
    stageLabel: 'Fluid displaced GPGPU particles 3D canvas',
  },
  combined: {
    shortTitle: 'Combined Demo',
    guideHref: '/tutorials/glsl-vs-tsl/',
    guideLabel: 'GLSL vs TSL',
    stageLabel: 'TSL combined demo canvas',
  },
  mega: {
    shortTitle: 'Mega Demo',
    guideHref: '/tutorials/glsl-vs-tsl/',
    guideLabel: 'GLSL vs TSL',
    stageLabel: 'TSL mega morphing particle canvas',
  },
}

const descriptions: Record<ExampleCase, string> = {
  helloworld: 'Density rendered straight to screen.',
  overlay: 'Vibrant fluid paint and neon dye strokes composited over your scene.',
  distortion:
    'Realistic screen-space refraction, warping typography and objects using fluid momentum.',
  'particles-trefoil':
    "A procedural 3D knot dynamically stretched and displaced by the fluid's velocity field.",
  'particles-2d': 'Thousands of procedural 3D liquid droplets driven by a massive GPGPU swarm.',
  'particles-3d':
    'A volumetric GPGPU particle cloud that lifts and swirls in 3D space based on 2D fluid winds.',
  combined: 'A full TSL/WebGPU composition that combines the main effect families.',
  mega: 'A hero-style TSL/WebGPU composition with centered morphing particles and fluid post-processing.',
}

const cardDescriptions: Record<
  ExampleCase,
  Record<ExampleEngine, Partial<Record<ExampleLevel, string>>>
> = {
  helloworld: {
    glsl: {
      minimal: '~40 lines. No GUI, no scene: just the solver, resize, splats and density output.',
    },
    tsl: {
      minimal: 'The same minimal surface on the WGSL compute-backed solver.',
    },
  },
  overlay: {
    glsl: {
      minimal: 'Density composited as a colored trail.',
      full: '15 overlay styles, preset switching, background switcher and full solver controls.',
    },
    tsl: {
      minimal: 'Scene pass plus fluid tint through a TSL output node.',
      full: '15 overlay styles through RenderPipeline and TSL nodes.',
    },
  },
  distortion: {
    glsl: {
      minimal: 'Velocity field refracts an existing render.',
      full: 'Simple, RGB shift, chromatic, water and caustic distortion with live controls.',
    },
    tsl: {
      minimal: 'RenderPipeline output node refracts the scene pass.',
      full: 'All distortion styles on the WGSL solver with the same tuning surface.',
    },
  },
  'particles-trefoil': {
    glsl: {
      minimal: 'Vertex-shader formula; flow nudges positions at render time.',
      full: 'Shape, displacement, motion and fluid response exposed for tuning.',
    },
    tsl: {
      minimal: 'Procedural trefoil rendered as instanced billboards.',
      full: 'Shape, displacement, backgrounds and fluid tuning on the WebGPU path.',
    },
  },
  'particles-2d': {
    glsl: {
      minimal: 'GPGPU liquid droplets driven by velocity-field advection.',
      full: 'Spring physics, damping, drag, flow response and render controls.',
    },
    tsl: {
      minimal: 'WGSL compute swarm with a TSL 3D liquid droplet renderer.',
      full: 'Full particle physics controls and background switcher on WebGPU.',
    },
  },
  'particles-3d': {
    glsl: {
      minimal: 'Fibonacci-sphere cloud reacting to fluid flow.',
      full: 'Depth lift, side variation, rotation and full physics tuning.',
    },
    tsl: {
      minimal: 'Fibonacci cloud driven by the WGSL fluid velocity texture.',
      full: '3D lift, side variation, physics tuning and backgrounds.',
    },
  },
  combined: {
    glsl: {},
    tsl: {
      full: 'One WebGPU scene for testing overlay, distortion and particle composition together.',
    },
  },
  mega: {
    glsl: {},
    tsl: {
      full: 'Hero-style morphing particle sculpture with art ink overlay, fluid distortion, and full tuning controls.',
    },
  },
}

const orderByCase: Record<ExampleCase, number> = {
  helloworld: 0,
  overlay: 1,
  distortion: 2,
  'particles-trefoil': 5,
  'particles-2d': 3,
  'particles-3d': 4,
  combined: 6,
  mega: 7,
}

function makeEntry(
  engine: ExampleEngine,
  level: ExampleLevel,
  caseId: ExampleCase,
  title: string,
  eyebrow: string,
  hasJavaScriptSource = true,
): ExampleEntry {
  const slug = `${engine}/${level}/${caseId}`
  const meta = caseMeta[caseId]

  return {
    slug,
    engine,
    level,
    caseId,
    order: orderByCase[caseId],
    title,
    shortTitle: meta.shortTitle,
    eyebrow,
    description: descriptions[caseId],
    cardDescription: cardDescriptions[caseId][engine][level] ?? descriptions[caseId],
    stageLabel: meta.stageLabel,
    guideHref: meta.guideHref,
    guideLabel: meta.guideLabel,
    walkthroughHref: `/tutorials/${slug}/`,
    source: {
      ts: `${REPO}/examples/${slug}/main.ts`,
      js: hasJavaScriptSource ? `${REPO}/examples-js/${slug}/main.js` : undefined,
    },
    playgroundLinks: makePlaygroundLinks(slug),
    javascriptPlaygroundLinks: makePlaygroundLinks(slug, 'js'),
  }
}

function getPlaygroundId(slug: string): string {
  return slug.replaceAll('/', '-')
}

function makePlaygroundLinks(
  slug: string,
  language: 'ts' | 'js' = 'ts',
): ExamplePlaygroundLink[] {
  const id = getPlaygroundId(slug)
  const folder = language === 'ts' ? `playgrounds/${id}` : `playgrounds-js/${id}`
  const sourcePath =
    language === 'ts' ? `src/examples/${slug}/main.ts` : `src/examples-js/${slug}/main.js`
  const githubTree = `${REPO_ROOT}/tree/${REPO_BRANCH}/${folder}`

  return [
    {
      label: 'CodeSandbox',
      href: `https://codesandbox.io/p/github/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${folder}?file=${encodeURIComponent(`/${sourcePath}`)}`,
    },
    {
      label: 'StackBlitz',
      href: `https://stackblitz.com/github/${REPO_OWNER}/${REPO_NAME}/tree/${REPO_BRANCH}/${folder}?file=${encodeURIComponent(sourcePath)}&startScript=dev`,
    },
    {
      label: 'Gitpod',
      href: `https://app.gitpod.io/#${githubTree}`,
    },
    {
      label: 'GitHub.dev',
      href: `https://github.dev/${REPO_OWNER}/${REPO_NAME}/blob/${REPO_BRANCH}/${folder}/${sourcePath}`,
    },
  ]
}

export const examples: ExampleEntry[] = [
  makeEntry('glsl', 'minimal', 'helloworld', 'Hello World', 'Example 00'),
  makeEntry('glsl', 'minimal', 'overlay', 'Overlay', 'Minimal · Overlay'),
  makeEntry('glsl', 'minimal', 'distortion', 'Distortion', 'Minimal · Distortion'),
  makeEntry(
    'glsl',
    'minimal',
    'particles-trefoil',
    'Simple Particles',
    'Minimal · Simple Particles',
  ),
  makeEntry(
    'glsl',
    'minimal',
    'particles-2d',
    'GPGPU Particles 2D',
    'Minimal · GPGPU Particles 2D',
  ),
  makeEntry(
    'glsl',
    'minimal',
    'particles-3d',
    'GPGPU Particles 3D',
    'Minimal · GPGPU Particles 3D',
  ),

  makeEntry('glsl', 'full', 'overlay', 'Overlay', 'Example 01'),
  makeEntry('glsl', 'full', 'distortion', 'Distortion', 'Example 02'),
  makeEntry('glsl', 'full', 'particles-trefoil', 'Simple Particles', 'Full · Simple Particles'),
  makeEntry('glsl', 'full', 'particles-2d', 'GPGPU Particles 2D', 'Example 03'),
  makeEntry('glsl', 'full', 'particles-3d', 'GPGPU Particles 3D', 'Example 04'),

  makeEntry('tsl', 'minimal', 'helloworld', 'Hello World', 'TSL · Example 00'),
  makeEntry('tsl', 'minimal', 'overlay', 'Overlay', 'TSL · Minimal · Overlay'),
  makeEntry('tsl', 'minimal', 'distortion', 'Distortion', 'TSL · Minimal · Distortion'),
  makeEntry(
    'tsl',
    'minimal',
    'particles-trefoil',
    'Simple Particles',
    'TSL · Minimal · Simple Particles',
  ),
  makeEntry(
    'tsl',
    'minimal',
    'particles-2d',
    'GPGPU Particles 2D',
    'TSL · Minimal · GPGPU Particles 2D',
  ),
  makeEntry(
    'tsl',
    'minimal',
    'particles-3d',
    'GPGPU Particles 3D',
    'TSL · Minimal · GPGPU Particles 3D',
  ),

  makeEntry('tsl', 'full', 'overlay', 'Overlay', 'TSL · Example 01'),
  makeEntry('tsl', 'full', 'distortion', 'Distortion', 'Example 02 · TSL + WGSL'),
  makeEntry(
    'tsl',
    'full',
    'particles-trefoil',
    'Simple Particles',
    'TSL · Full · Simple Particles',
  ),
  makeEntry('tsl', 'full', 'particles-2d', 'GPGPU Particles 2D', 'TSL · Example 03'),
  makeEntry('tsl', 'full', 'particles-3d', 'GPGPU Particles 3D', 'TSL · Example 04'),
  makeEntry('tsl', 'full', 'combined', 'Combined Demo', 'TSL · Full · Combined'),
  makeEntry('tsl', 'full', 'mega', 'Mega Demo', 'TSL · Full · Mega'),
]

export const exampleCases = caseSummaries

export function getExampleBySlug(slug: string): ExampleEntry | undefined {
  return examples.find((example) => example.slug === slug)
}

export function getExampleGroup(entry: ExampleEntry): ExampleEntry[] {
  return examples
    .filter((example) => example.engine === entry.engine && example.level === entry.level)
    .sort((a, b) => a.order - b.order)
}

export function getExampleGroupLabel(entry: ExampleEntry): string {
  return (
    exampleGroups.find((group) => group.engine === entry.engine && group.level === entry.level)
      ?.label ?? `${formatLevel(entry.level)} ${formatEngine(entry.engine)} Examples`
  )
}

export function getExampleGroupLinks(entry: ExampleEntry): ExampleGroupLink[] {
  return exampleGroups.flatMap((group) => {
    const groupExamples = examples
      .filter((example) => example.engine === group.engine && example.level === group.level)
      .sort((a, b) => a.order - b.order)
    const target =
      groupExamples.find((example) => example.caseId === entry.caseId) ?? groupExamples[0]

    if (!target) return []

    return {
      ...group,
      href: `/examples/${target.slug}/`,
      current: group.engine === entry.engine && group.level === entry.level,
    }
  })
}

export function getExamplesByCase(caseId: ExampleCase): ExampleEntry[] {
  return examples
    .filter((example) => example.caseId === caseId)
    .sort((a, b) => {
      if (a.engine !== b.engine) return a.engine.localeCompare(b.engine)
      return a.level.localeCompare(b.level)
    })
}

export function formatEngine(engine: ExampleEngine): string {
  return engine === 'glsl' ? 'GLSL / WebGL' : 'TSL / WebGPU'
}

export function formatLevel(level: ExampleLevel): string {
  return level === 'minimal' ? 'Minimal' : 'Full'
}
