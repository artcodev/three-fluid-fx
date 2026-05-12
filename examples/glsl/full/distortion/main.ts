import '../../../../src/styles.css'
import {
  ACESFilmicToneMapping,
  Color,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { addProfileSwitcher, createControlsPane } from '../../../extras/controls/createControlsPane'
import {
  attachPointerSplats,
  ChromaticDistortionPass,
  FluidSimulation,
  RGBShiftDistortionPass,
  SimpleDistortionPass,
  WaterCausticsDistortionPass,
  WaterDistortionPass,
} from 'three-fluid-fx'
import { RANGES, SCALE } from '../../../extras/controls/paramRanges'
import { Backdrop } from '../../../extras/backgrounds/glsl/Backdrop'
import { Slideshow } from '../../../extras/backgrounds/glsl/Slideshow'
import { DEFAULT_SLIDESHOW_PATHS } from '../../../extras/backgrounds/defaults'
import { attachBackgroundSwitcher } from '../../../extras/backgrounds/attachBackgroundSwitcher'
import { resolveBackground } from '../../../extras/backgrounds/resolveBackground'
import { resolveProfile } from '../../../extras/resolveProfile'
import {
  attachDemoManualTakeover,
  createDemoSplatDriver,
  resolveDemoChoice,
  setupDemoReel,
} from '../../../extras/demo/reel'

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) {
  throw new Error('Missing #stage element')
}

type DistortionStyle = 'simple' | 'rgbShift' | 'chromatic' | 'water' | 'waterCaustics'

// Each style ships its own preset of fluid + visual parameters. Selecting a
// style in the GUI overwrites these fields on `controls.params` and refreshes
// the panel — the underlying simulation instance (`core.fluid`) is shared,
// only its tuning changes. Mirrors the pattern in overlay.ts.
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
  // Simple — plain UV warp by velocity. Subtle by design; example baseline.
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
  // RGB Shift — directional smear + chromatic split scales with speed.
  // Punchier splat force and active vorticity make the chromatic spread
  // pronounced; walls reflect to keep motion on screen.
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
  // Chromatic — iridescent oil-slick: each channel shifted by its own
  // component. Wants long-lingering density (slow dissipation) so the
  // rainbow trails persist; vorticity gives the shimmer its swirl.
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
  // Water — refraction through density-as-height. Larger softer splats so
  // the surface has visible bumps, slow density decay so ripples linger,
  // gentle curl + vorticity to feel like a calm pool surface.
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
  // Water + Caustics — same as Water but a touch larger so the caustic
  // mask covers more of the scene. Caustics need active density to render.
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
const demo = setupDemoReel(`Distortion: ${DISTORTION_LABELS[requestedDistortionStyle]}`)

// — renderer + scene + camera —
const profile = resolveProfile('balanced')
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.outputColorSpace = SRGBColorSpace
renderer.toneMapping = ACESFilmicToneMapping
renderer.toneMappingExposure = 1
renderer.setClearColor(new Color('#07080b'), 1)
stage.appendChild(renderer.domElement)

const scene = new Scene()
const camera = new PerspectiveCamera(45, 1, 0.1, 100)
camera.position.set(0, 0, 5)

// — fluid + offscreen target for the distortion composite —
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
const clock = new Timer()

const detachPointerSplats = demo.enabled
  ? attachDemoManualTakeover(demo, renderer.domElement, () =>
      attachPointerSplats(renderer.domElement, fluid),
    )
  : attachPointerSplats(renderer.domElement, fluid)
const driveDemoSplats = createDemoSplatDriver(fluid)

// — background switcher (dark / bright / slideshow) —
// `persist: false` means user clicks don't bleed into other examples via
// localStorage; reload always lands on the example's hardcoded default.
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

// — controls —
const controls = createControlsPane('Distortion', initialParams, (pane, p) => {
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
    })
  render.addBinding(p, 'intensity', RANGES.intensity)

  const debug = pane.addFolder({ title: 'Debug', expanded: false })
  addProfileSwitcher(debug, profile)
})

// Each distortion style is a `Pass` subclass — see `src/lib/effects/distortion/*`.
// All five share the same shape: read scene + fluid textures, write the
// distorted result. They can also be plugged into a three.js `EffectComposer`.
type DistortionEffect =
  | SimpleDistortionPass
  | RGBShiftDistortionPass
  | ChromaticDistortionPass
  | WaterDistortionPass
  | WaterCausticsDistortionPass

const distortions: Record<DistortionStyle, DistortionEffect> = {
  simple: new SimpleDistortionPass(fluid),
  rgbShift: new RGBShiftDistortionPass(fluid),
  chromatic: new ChromaticDistortionPass(fluid),
  water: new WaterDistortionPass(fluid),
  waterCaustics: new WaterCausticsDistortionPass(fluid),
}

// EffectComposer pipeline: RenderPass draws the scene (background + any
// future 3D content) into the composer's read buffer, then the active
// distortion pass reads that and writes the next stage. All five distortions
// live in the chain; only one is enabled per frame, the rest short-circuit
// via `pass.enabled = false`. OutputPass is the canonical final pass —
// applies the renderer's tone mapping (ACES Filmic) and converts linear
// HDR back to the screen's sRGB output. EffectComposer auto-sets
// `renderToScreen` on the last enabled pass (= OutputPass here).
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
for (const effect of Object.values(distortions)) {
  effect.enabled = false
  composer.addPass(effect)
}
composer.addPass(new OutputPass())

// — resize: keep renderer, camera, composer and fluid in sync with the stage —
const resize = (): void => {
  const w = Math.max(1, stage.clientWidth)
  const h = Math.max(1, stage.clientHeight)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(dpr)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  composer.setPixelRatio(dpr)
  composer.setSize(w, h)
  fluid.resize(w, h)
}
resize()
window.addEventListener('resize', resize)

// Push the current GUI values into `fluid` and the active distortion effect.
// Called once per frame from the loop; could be event-driven via Tweakpane
// `.on('change')` instead, but per-frame is simpler and the cost is trivial.
const syncParams = (activeDistortion: DistortionEffect): void => {
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
  activeDistortion.intensity = p.intensity
}

// — loop: advance state, then `composer.render()` runs RenderPass + active distortion.
renderer.setAnimationLoop(() => {
  clock.update()
  const dt = Math.min(Math.max(clock.getDelta(), 1e-6), 1 / 30)
  const fluidDt = Math.min(dt, 1 / 60)
  const elapsed = clock.getElapsed()
  const activeDistortion = distortions[controls.params.distortionStyle]

  for (const effect of Object.values(distortions)) effect.enabled = effect === activeDistortion
  syncParams(activeDistortion)
  if (activeDistortion instanceof WaterCausticsDistortionPass) activeDistortion.time = elapsed
  if (demo.enabled) driveDemoSplats(demo.elapsed())
  fluid.step(fluidDt)
  switcher.update(dt, elapsed)

  composer.render(dt)
})

window.addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null)
  window.removeEventListener('resize', resize)
  composer.dispose()
  for (const effect of Object.values(distortions)) effect.dispose()
  detachPointerSplats?.()
  switcher.dispose()
  controls.dispose()
  fluid.dispose()
  renderer.dispose()
  renderer.domElement.remove()
})
