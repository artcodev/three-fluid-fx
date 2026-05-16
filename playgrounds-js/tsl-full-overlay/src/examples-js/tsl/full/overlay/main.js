// TSL/WebGPU counterpart of `examples/glsl/full/overlay/main.ts`.
// The solver runs through WGSL compute; the visual overlay is a TSL output
// graph rendered by `RenderPipeline`, with no EffectComposer/WebGL fallback.
import '../../../../styles.css'
import {
  ACESFilmicToneMapping,
  Color,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector2,
} from 'three'
import { RenderPipeline, WebGPURenderer } from 'three/webgpu'
import { pass, uniform } from 'three/tsl'
import { attachPointerSplats, FluidSimulation, fluidOverlay } from 'three-fluid-fx/tsl'
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
import { asNode, asTsl, setPipelineOutput } from '../../shared/nodeInterop'
const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage element')
if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
  stage.textContent =
    'WebGPU is not available in this browser. The TSL example needs a WebGPU-capable browser.'
  throw new Error('WebGPU unavailable')
}
const PRESETS = {
  default: {
    splatRadius: 16,
    splatForce: 6,
    pressureIterations: 12,
    curlStrength: 0.5,
    velocityDissipation: 0.985,
    densityDissipation: 0.95,
    pressureDissipation: 0.85,
    enableVorticity: true,
    reflectWalls: false,
    intensity: 1,
  },
  volumeCursor: {
    splatRadius: 16,
    splatForce: 6,
    pressureIterations: 12,
    curlStrength: 0.5,
    velocityDissipation: 0.985,
    densityDissipation: 0.95,
    pressureDissipation: 0.85,
    enableVorticity: true,
    reflectWalls: false,
    intensity: 1,
  },
  trail: {
    splatRadius: 10,
    splatForce: 7,
    pressureIterations: 8,
    curlStrength: 0.25,
    velocityDissipation: 0.985,
    densityDissipation: 0.94,
    pressureDissipation: 0.8,
    enableVorticity: false,
    reflectWalls: true,
    intensity: 1.2,
  },
  oil: {
    splatRadius: 12,
    splatForce: 6,
    pressureIterations: 10,
    curlStrength: 0.62,
    velocityDissipation: 0.986,
    densityDissipation: 0.915,
    pressureDissipation: 0.85,
    enableVorticity: true,
    reflectWalls: true,
    intensity: 1.35,
  },
  velocity: {
    splatRadius: 20,
    splatForce: 3,
    pressureIterations: 3,
    curlStrength: 0,
    velocityDissipation: 0.965,
    densityDissipation: 0.985,
    pressureDissipation: 0.05,
    enableVorticity: false,
    reflectWalls: false,
    intensity: 0.25,
  },
  colorful: {
    splatRadius: 15,
    splatForce: 7,
    pressureIterations: 10,
    curlStrength: 1.55,
    velocityDissipation: 0.985,
    densityDissipation: 0.94,
    pressureDissipation: 0.9,
    enableVorticity: true,
    reflectWalls: true,
    intensity: 1.2,
  },
  rainbowFish: {
    splatRadius: 12,
    splatForce: 3,
    pressureIterations: 6,
    curlStrength: 0,
    velocityDissipation: 0.96,
    densityDissipation: 0.935,
    pressureDissipation: 0.05,
    enableVorticity: false,
    reflectWalls: false,
    intensity: 0.6,
  },
  glaze: {
    splatRadius: 18,
    splatForce: 6,
    pressureIterations: 6,
    curlStrength: 0.5,
    velocityDissipation: 0.98,
    densityDissipation: 0.92,
    pressureDissipation: 0.78,
    enableVorticity: false,
    reflectWalls: true,
    intensity: 1,
  },
  burn: {
    splatRadius: 14,
    splatForce: 6,
    pressureIterations: 10,
    curlStrength: 0.7,
    velocityDissipation: 0.985,
    densityDissipation: 0.9,
    pressureDissipation: 0.85,
    enableVorticity: true,
    reflectWalls: false,
    intensity: 1.5,
  },
  smoke: {
    splatRadius: 16,
    splatForce: 6,
    pressureIterations: 12,
    curlStrength: 0.5,
    velocityDissipation: 0.985,
    densityDissipation: 0.95,
    pressureDissipation: 0.85,
    enableVorticity: true,
    reflectWalls: false,
    intensity: 1,
  },
  artInk: {
    splatRadius: 16,
    splatForce: 6,
    pressureIterations: 12,
    curlStrength: 0.5,
    velocityDissipation: 0.985,
    densityDissipation: 0.95,
    pressureDissipation: 0.85,
    enableVorticity: true,
    reflectWalls: true,
    intensity: 1,
  },
  rainbowInk: {
    splatRadius: 18,
    splatForce: 6,
    pressureIterations: 12,
    curlStrength: 0.5,
    velocityDissipation: 0.985,
    densityDissipation: 0.95,
    pressureDissipation: 0.85,
    enableVorticity: true,
    reflectWalls: true,
    intensity: 1,
  },
  colorWater: {
    splatRadius: 15,
    splatForce: 5,
    pressureIterations: 4,
    curlStrength: 0.5,
    velocityDissipation: 0.977,
    densityDissipation: 0.98,
    pressureDissipation: 0.16,
    enableVorticity: true,
    reflectWalls: false,
    bfecc: true,
    dyeDissipation: 0.989,
    intensity: 1.4,
  },
  liquidLens: {
    splatRadius: 22,
    splatForce: 5,
    pressureIterations: 4,
    curlStrength: 0.5,
    velocityDissipation: 0.99,
    densityDissipation: 0.98,
    pressureDissipation: 0.16,
    enableVorticity: true,
    reflectWalls: false,
    bfecc: false,
    dyeDissipation: 0.992,
    intensity: 1,
  },
}
const DEFAULTS = {
  ...PRESETS.default,
  bfecc: true,
  opacity: 1,
  dyeDissipation: PRESETS.default.dyeDissipation ?? PRESETS.default.densityDissipation,
  overlayStyle: 'default',
  cursorColor: { r: 0.85, g: 0.95, b: 1 },
  vibrance: 0,
  liquidColor: { r: 0.85, g: 0.25, b: 1 },
}
const OVERLAY_LABELS = {
  default: 'Default',
  volumeCursor: 'Volume Cursor',
  trail: 'Trail',
  oil: 'Oil',
  velocity: 'Velocity',
  colorful: 'Colorful',
  rainbowFish: 'Rainbow Fish',
  glaze: 'Glaze',
  burn: 'Burn',
  smoke: 'Smoke',
  artInk: 'Art Ink',
  rainbowInk: 'Rainbow Ink',
  colorWater: 'Color Water',
  liquidLens: 'Liquid Lens',
}
const OVERLAY_STYLES = Object.keys(PRESETS)
const requestedOverlayStyle = resolveDemoChoice('style', OVERLAY_STYLES, DEFAULTS.overlayStyle)
const initialParams = {
  ...DEFAULTS,
  cursorColor: { ...DEFAULTS.cursorColor },
  liquidColor: { ...DEFAULTS.liquidColor },
}
const applyOverlayStyle = (p, style) => {
  const preset = PRESETS[style]
  Object.assign(p, preset)
  p.overlayStyle = style
  p.bfecc = preset.bfecc ?? DEFAULTS.bfecc
  p.dyeDissipation = preset.dyeDissipation ?? preset.densityDissipation
}
applyOverlayStyle(initialParams, requestedOverlayStyle)
const demo = setupDemoReel(`TSL Overlay: ${OVERLAY_LABELS[requestedOverlayStyle]}`)
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
const backgroundForStyle = (style) => (style === 'liquidLens' ? 'bright' : 'dark')
const switcher = attachBackgroundSwitcher({
  scene,
  initial: resolveBackground(backgroundForStyle(initialParams.overlayStyle), { skipStorage: true }),
  persist: false,
  factories: {
    dark: () => new Backdrop(camera, 'dark'),
    bright: () => new Backdrop(camera, 'bright'),
    slideshow: () => new Slideshow({ camera, paths: DEFAULT_SLIDESHOW_PATHS }),
  },
})
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
fluid.enableDye = true
const intensity = uniform(initialParams.intensity)
const opacity = uniform(initialParams.opacity)
const elapsedTime = uniform(0)
const dyeTexel = uniform(new Vector2(1 / 512, 1 / 512))
const cursorColor = uniform(
  new Color(initialParams.cursorColor.r, initialParams.cursorColor.g, initialParams.cursorColor.b),
)
const vibrance = uniform(initialParams.vibrance)
const scenePass = pass(scene, camera)
function buildOutput(style) {
  return fluidOverlay(
    style,
    asNode(scenePass),
    asNode(fluid.densityNode),
    asNode(fluid.dyeNode),
    asNode(fluid.velocityNode),
    {
      intensity: asNode(intensity),
      opacity: asNode(opacity),
      time: asNode(elapsedTime),
      texel: asNode(dyeTexel),
      cursorColor: asNode(cursorColor),
      vibrance: asNode(vibrance),
    },
  )
}
const pipeline = new RenderPipeline(renderer)
setPipelineOutput(pipeline, buildOutput(initialParams.overlayStyle))
function setOutput(style) {
  setPipelineOutput(pipeline, buildOutput(style))
}
const usesCursorColor = (style) =>
  style === 'trail' || style === 'default' || style === 'volumeCursor'
const usesVibrance = (style) => style !== 'smoke' && style !== 'velocity'
const controls = createControlsPane('TSL · Overlay', initialParams, (pane, p) => {
  const splat = pane.addFolder({ title: 'Splat' })
  splat.addBinding(p, 'splatRadius', { ...RANGES.splatRadius, label: 'radius' })
  splat.addBinding(p, 'splatForce', { ...RANGES.splatForce, label: 'force' })
  const sim = pane.addFolder({ title: 'Fluid sim' })
  sim.addBinding(p, 'pressureIterations', { ...RANGES.pressureIterations, label: 'pressure' })
  sim.addBinding(p, 'curlStrength', { ...RANGES.curlStrength, label: 'curl' })
  sim.addBinding(p, 'velocityDissipation', { ...RANGES.velocityDissipation, label: 'vel diss' })
  sim.addBinding(p, 'densityDissipation', { ...RANGES.densityDissipation, label: 'dens diss' })
  sim.addBinding(p, 'dyeDissipation', { ...RANGES.densityDissipation, label: 'dye diss' })
  sim.addBinding(p, 'pressureDissipation', { ...RANGES.pressureDissipation, label: 'pres diss' })
  sim.addBinding(p, 'enableVorticity', { label: 'vorticity' })
  sim.addBinding(p, 'bfecc', { label: 'BFECC' })
  sim.addBinding(p, 'reflectWalls', { label: 'reflect walls' })
  const render = pane.addFolder({ title: 'Render' })
  render
    .addBinding(p, 'overlayStyle', {
      label: 'style',
      options: {
        Default: 'default',
        'Volume Cursor': 'volumeCursor',
        Trail: 'trail',
        Oil: 'oil',
        Velocity: 'velocity',
        Colorful: 'colorful',
        'Rainbow Fish': 'rainbowFish',
        Glaze: 'glaze',
        Burn: 'burn',
        Smoke: 'smoke',
        'Art Ink': 'artInk',
        'Rainbow Ink': 'rainbowInk',
        'Color Water': 'colorWater',
        'Liquid Lens': 'liquidLens',
      },
    })
    .on('change', (ev) => {
      const style = ev.value
      applyOverlayStyle(p, style)
      cursorColorBinding.hidden = !usesCursorColor(style)
      vibranceBinding.hidden = !usesVibrance(style)
      liquidColorBinding.hidden = style !== 'liquidLens'
      switcher.select(backgroundForStyle(style))
      pane.refresh()
      setOutput(style)
    })
  render.addBinding(p, 'intensity', { ...RANGES.intensity, max: 3 })
  render.addBinding(p, 'opacity', RANGES.opacity)
  const cursorColorBinding = render.addBinding(p, 'cursorColor', {
    label: 'cursor color',
    color: { type: 'float' },
  })
  cursorColorBinding.hidden = !usesCursorColor(p.overlayStyle)
  const vibranceBinding = render.addBinding(p, 'vibrance', {
    label: 'vibrance',
    min: 0,
    max: 1,
    step: 0.01,
  })
  vibranceBinding.hidden = !usesVibrance(p.overlayStyle)
  const liquidColorBinding = render.addBinding(p, 'liquidColor', {
    label: 'liquid color',
    color: { type: 'float' },
  })
  liquidColorBinding.hidden = p.overlayStyle !== 'liquidLens'
})
const liquidLensColorize = (dx, dy) => {
  if (controls.params.overlayStyle !== 'liquidLens') return undefined
  const lc = controls.params.liquidColor
  const sx = Math.min(Math.abs(dx) / 25, 1)
  const sy = Math.min(Math.abs(dy) / 25, 1)
  const speed = Math.hypot(sx, sy)
  const base = 0.4 + speed * 0.6
  return [(lc.r * base + sx * 0.5) * 0.3, lc.g * base * 0.3, (lc.b * base + sy * 0.5) * 0.3]
}
const detachPointerSplats = demo.enabled
  ? attachDemoManualTakeover(demo, renderer.domElement, () =>
      attachPointerSplats(renderer.domElement, fluid, {
        coloredStrokes: true,
        colorize: liquidLensColorize,
      }),
    )
  : attachPointerSplats(renderer.domElement, fluid, {
      coloredStrokes: true,
      colorize: liquidLensColorize,
    })
const driveDemoSplats = createDemoSplatDriver(fluid, { colorize: liquidLensColorize })
function syncParams() {
  const p = controls.params
  fluid.splatRadius = p.splatRadius * SCALE.splatRadius
  fluid.splatForce = p.splatForce
  fluid.pressureIterations = p.pressureIterations
  fluid.curlStrength = p.curlStrength
  fluid.velocityDissipation = p.velocityDissipation
  fluid.densityDissipation = p.densityDissipation
  fluid.dyeDissipation = p.dyeDissipation
  fluid.pressureDissipation = p.pressureDissipation
  fluid.enableVorticity = p.enableVorticity
  fluid.bfecc = p.bfecc
  fluid.reflectWalls = p.reflectWalls
  asTsl(intensity).value = p.intensity
  asTsl(opacity).value = p.opacity
  asTsl(vibrance).value = p.vibrance
  asTsl(cursorColor).value.setRGB(p.cursorColor.r, p.cursorColor.g, p.cursorColor.b)
}
function syncDyeTexel() {
  const img = fluid.dyeTexture.image
  const w = img.width ?? 512
  const h = img.height ?? 512
  asTsl(dyeTexel).value.set(1 / w, 1 / h)
}
const resize = () => {
  const w = Math.max(1, stage.clientWidth)
  const h = Math.max(1, stage.clientHeight)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(dpr)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  fluid.resize(w, h)
  syncDyeTexel()
}
resize()
window.addEventListener('resize', resize)
const clock = new Timer()
const FIXED_FLUID_DT = 1 / 60
const MAX_FLUID_SUBSTEPS = 4
let fluidAccumulator = 0
renderer.setAnimationLoop(() => {
  clock.update()
  const frameDt = Math.min(Math.max(clock.getDelta(), 1e-6), FIXED_FLUID_DT * MAX_FLUID_SUBSTEPS)
  const elapsed = clock.getElapsed()
  asTsl(elapsedTime).value = elapsed
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
