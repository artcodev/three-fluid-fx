// TSL counterpart of `examples/glsl/full/distortion/main.ts`. Same visible
// output: a slideshow image fills the viewport, pointer movement stirs the
// fluid, the active distortion effect refracts the image. Only the rendering
// pipeline differs — `WebGPURenderer` + `RenderPipeline` + TSL effect nodes
// instead of `WebGLRenderer` + `EffectComposer` + `*Pass` classes.

import '../../../../styles.css'
import {
  ACESFilmicToneMapping,
  Color,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
} from 'three'
import { RenderPipeline, WebGPURenderer } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { pass, uniform } from 'three/tsl'
import {
  attachPointerSplats,
  chromaticDistortion,
  FluidSimulation,
  rgbShiftDistortion,
  simpleDistortion,
  waterCausticsDistortion,
  waterDistortion,
} from 'three-fluid-fx/tsl'
import { Backdrop } from '../../../extras/backgrounds/tsl/Backdrop'
import { Slideshow } from '../../../extras/backgrounds/tsl/Slideshow'
import { DEFAULT_SLIDESHOW_PATHS } from '../../../extras/backgrounds/defaults'
import { attachBackgroundSwitcher } from '../../../extras/backgrounds/attachBackgroundSwitcher'
import { resolveBackground } from '../../../extras/backgrounds/resolveBackground'
import { createControlsPane } from '../../../extras/controls/createControlsPane'
import { RANGES, SCALE } from '../../../extras/controls/paramRanges'
import { resolveProfile } from '../../../extras/resolveProfile'
import {
  attachDemoManualTakeover,
  createDemoSplatDriver,
  resolveDemoChoice,
  setupDemoReel,
} from '../../../extras/demo/reel'
import { asNode, asTsl, setPipelineOutput, type UniformValue } from '../../shared/nodeInterop'

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage element')

if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
  stage.textContent =
    'WebGPU is not available in this browser. The TSL example needs a WebGPU-capable browser (Chrome ≥113, Edge ≥113, recent Safari Technology Preview).'
  throw new Error('WebGPU unavailable')
}

const renderer = new WebGPURenderer({ antialias: true, forceWebGL: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.outputColorSpace = SRGBColorSpace
renderer.toneMapping = ACESFilmicToneMapping
renderer.toneMappingExposure = 1
renderer.setClearColor(new Color('#07080b'), 1)
renderer.domElement.style.position = 'absolute'
renderer.domElement.style.inset = '0'
stage.appendChild(renderer.domElement)

await renderer.init()

const scene = new Scene()
const camera = new PerspectiveCamera(45, 1, 0.1, 100)
camera.position.set(0, 0, 5)

const switcher = attachBackgroundSwitcher({
  scene,
  initial: resolveBackground('slideshow', { skipStorage: true }),
  persist: false,
  factories: {
    dark: () => new Backdrop(camera, 'dark'),
    bright: () => new Backdrop(camera, 'bright'),
    slideshow: () => new Slideshow({ camera, paths: DEFAULT_SLIDESHOW_PATHS }),
  },
})

// ---- fluid + distortion presets (mirror the GLSL `distortion.ts` presets)
type DistortionStyle = 'simple' | 'rgbShift' | 'chromatic' | 'water' | 'waterCaustics'

interface DistortionPreset {
  splatRadius: number
  splatForce: number
  pressureIterations: number
  curlStrength: number
  velocityDissipation: number
  densityDissipation: number
  pressureDissipation: number
  enableVorticity: boolean
  reflectWalls: boolean
  intensity: number
}

const PRESETS: Record<DistortionStyle, DistortionPreset> = {
  simple: {
    splatRadius: 40,
    splatForce: 6,
    pressureIterations: 10,
    curlStrength: 0.72,
    velocityDissipation: 0.99,
    densityDissipation: 0.95,
    pressureDissipation: 0.8,
    enableVorticity: false,
    reflectWalls: true,
    intensity: 1,
  },
  rgbShift: {
    splatRadius: 30,
    splatForce: 10,
    pressureIterations: 8,
    curlStrength: 1.1,
    velocityDissipation: 0.992,
    densityDissipation: 0.98,
    pressureDissipation: 0.8,
    enableVorticity: true,
    reflectWalls: true,
    intensity: 1.2,
  },
  chromatic: {
    splatRadius: 45,
    splatForce: 4,
    pressureIterations: 6,
    curlStrength: 1.0,
    velocityDissipation: 0.99,
    densityDissipation: 0.97,
    pressureDissipation: 0.85,
    enableVorticity: true,
    reflectWalls: true,
    intensity: 0.1,
  },
  water: {
    splatRadius: 29,
    splatForce: 4.5,
    pressureIterations: 8,
    curlStrength: 0.6,
    velocityDissipation: 0.99,
    densityDissipation: 0.97,
    pressureDissipation: 0.85,
    enableVorticity: true,
    reflectWalls: true,
    intensity: 1.1,
  },
  waterCaustics: {
    splatRadius: 35,
    splatForce: 3.0,
    pressureIterations: 8,
    curlStrength: 0.6,
    velocityDissipation: 0.99,
    densityDissipation: 0.97,
    pressureDissipation: 0.85,
    enableVorticity: true,
    reflectWalls: true,
    intensity: 1.1,
  },
}

const DEFAULTS = {
  ...PRESETS.simple,
  bfecc: true,
  distortionStyle: 'simple' as DistortionStyle,
}

const DISTORTION_LABELS: Record<DistortionStyle, string> = {
  simple: 'Simple',
  rgbShift: 'RGB Shift',
  chromatic: 'Chromatic',
  water: 'Water',
  waterCaustics: 'Water + Caustics',
}

const DISTORTION_STYLES = Object.keys(PRESETS) as DistortionStyle[]
const requestedDistortionStyle = resolveDemoChoice(
  'style',
  DISTORTION_STYLES,
  DEFAULTS.distortionStyle,
)
const initialParams = { ...DEFAULTS }

const applyDistortionStyle = (p: typeof DEFAULTS, style: DistortionStyle): void => {
  Object.assign(p, PRESETS[style])
  p.distortionStyle = style
}

applyDistortionStyle(initialParams, requestedDistortionStyle)
const demo = setupDemoReel(`TSL Distortion: ${DISTORTION_LABELS[requestedDistortionStyle]}`)

const profile = resolveProfile('balanced')
const fluid = new FluidSimulation(renderer, {
  profile,
  splatRadius: initialParams.splatRadius * SCALE.splatRadius,
  splatForce: initialParams.splatForce,
  pressureIterations: initialParams.pressureIterations,
  curlStrength: initialParams.curlStrength,
  velocityDissipation: initialParams.velocityDissipation,
  densityDissipation: initialParams.densityDissipation,
  pressureDissipation: initialParams.pressureDissipation,
  enableVorticity: initialParams.enableVorticity,
  bfecc: initialParams.bfecc,
  reflectWalls: initialParams.reflectWalls,
})
const detachPointerSplats = demo.enabled
  ? attachDemoManualTakeover(demo, renderer.domElement, () =>
      attachPointerSplats(renderer.domElement, fluid),
    )
  : attachPointerSplats(renderer.domElement, fluid)
const driveDemoSplats = createDemoSplatDriver(fluid)

// ---- output graph: active distortion style on top of the scene pass.
const intensity = uniform(initialParams.intensity)
const elapsedTime = uniform(0)
const scenePass = pass(scene, camera)

function buildOutput(style: DistortionStyle): Node {
  const fluidNode = asNode(fluid.densityNode)
  const sceneNode = asNode(scenePass)
  const i = asNode(intensity)
  const t = asNode(elapsedTime)
  switch (style) {
    case 'simple':
      return simpleDistortion(sceneNode, fluidNode, i)
    case 'rgbShift':
      return rgbShiftDistortion(sceneNode, fluidNode, i)
    case 'chromatic':
      return chromaticDistortion(sceneNode, fluidNode, i)
    case 'water':
      return waterDistortion(sceneNode, fluidNode, i)
    case 'waterCaustics':
      return waterCausticsDistortion(sceneNode, fluidNode, i, t)
  }
}

const pipeline = new RenderPipeline(renderer)
setPipelineOutput(pipeline, buildOutput(initialParams.distortionStyle))

function setOutput(style: DistortionStyle): void {
  setPipelineOutput(pipeline, buildOutput(style))
}

// ---- GUI: Tweakpane. Same structure as the GLSL example.
const controls = createControlsPane('TSL · Distortion', initialParams, (pane, p) => {
  const splat = pane.addFolder({ title: 'Splat' })
  splat.addBinding(p, 'splatRadius', { ...RANGES.splatRadius, label: 'radius' })
  splat.addBinding(p, 'splatForce', { ...RANGES.splatForce, label: 'force' })

  const sim = pane.addFolder({ title: 'Fluid sim' })
  sim.addBinding(p, 'pressureIterations', { ...RANGES.pressureIterations, label: 'pressure' })
  sim.addBinding(p, 'curlStrength', { ...RANGES.curlStrength, label: 'curl' })
  sim.addBinding(p, 'velocityDissipation', { ...RANGES.velocityDissipation, label: 'vel diss' })
  sim.addBinding(p, 'densityDissipation', { ...RANGES.densityDissipation, label: 'dens diss' })
  sim.addBinding(p, 'pressureDissipation', { ...RANGES.pressureDissipation, label: 'pres diss' })
  sim.addBinding(p, 'enableVorticity', { label: 'vorticity' })
  sim.addBinding(p, 'bfecc', { label: 'BFECC' })
  sim.addBinding(p, 'reflectWalls', { label: 'reflect walls' })

  const render = pane.addFolder({ title: 'Render' })
  render
    .addBinding(p, 'distortionStyle', {
      label: 'style',
      options: {
        Simple: 'simple',
        'RGB Shift': 'rgbShift',
        Chromatic: 'chromatic',
        Water: 'water',
        'Water + Caustics': 'waterCaustics',
      },
    })
    .on('change', (ev) => {
      applyDistortionStyle(p, ev.value as DistortionStyle)
      pane.refresh()
      setOutput(p.distortionStyle)
    })
  render.addBinding(p, 'intensity', RANGES.intensity)
})

// ---- per-frame: push GUI values into `fluid` + `intensity` uniform.
function syncParams(): void {
  const p = controls.params
  fluid.splatRadius = p.splatRadius * SCALE.splatRadius
  fluid.splatForce = p.splatForce
  fluid.pressureIterations = p.pressureIterations
  fluid.curlStrength = p.curlStrength
  fluid.velocityDissipation = p.velocityDissipation
  fluid.densityDissipation = p.densityDissipation
  fluid.pressureDissipation = p.pressureDissipation
  fluid.enableVorticity = p.enableVorticity
  fluid.bfecc = p.bfecc
  fluid.reflectWalls = p.reflectWalls
  asTsl<UniformValue<number>>(intensity).value = p.intensity
}

// ---- resize
const resize = (): void => {
  const w = Math.max(1, stage.clientWidth)
  const h = Math.max(1, stage.clientHeight)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(dpr)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  fluid.resize(w, h)
}
resize()
window.addEventListener('resize', resize)

// ---- animation loop
const clock = new Timer()
const FIXED_FLUID_DT = 1 / 60
const MAX_FLUID_SUBSTEPS = 4
let fluidAccumulator = 0

renderer.setAnimationLoop(() => {
  clock.update()
  const frameDt = Math.min(Math.max(clock.getDelta(), 1e-6), FIXED_FLUID_DT * MAX_FLUID_SUBSTEPS)
  const elapsed = clock.getElapsed()
  asTsl<UniformValue<number>>(elapsedTime).value = elapsed
  syncParams()
  if (demo.enabled) driveDemoSplats(demo.elapsed())
  fluidAccumulator += frameDt
  let substeps = 0
  while (fluidAccumulator >= FIXED_FLUID_DT && substeps < MAX_FLUID_SUBSTEPS) {
    fluid.step(FIXED_FLUID_DT)
    fluidAccumulator -= FIXED_FLUID_DT
    substeps += 1
  }
  if (substeps === MAX_FLUID_SUBSTEPS) fluidAccumulator = 0
  switcher.update(frameDt, elapsed)
  pipeline.render()
})

window.addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null)
  window.removeEventListener('resize', resize)
  detachPointerSplats?.()
  switcher.dispose()
  controls.dispose()
  fluid.dispose()
  renderer.dispose()
  renderer.domElement.remove()
})
