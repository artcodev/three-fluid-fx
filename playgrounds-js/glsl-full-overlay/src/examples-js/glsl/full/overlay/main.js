import '../../../../styles.css'
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
  ArtInkOverlayPass,
  attachPointerSplats,
  BurnOverlayPass,
  ColorfulOverlayPass,
  ColorWaterOverlayPass,
  DefaultOverlayPass,
  FluidSimulation,
  GlazeOverlayPass,
  LiquidLensOverlayPass,
  OilOverlayPass,
  RainbowFishOverlayPass,
  RainbowInkOverlayPass,
  SmokeOverlayPass,
  TrailOverlayPass,
  VelocityOverlayPass,
  VolumeCursorOverlayPass,
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
const PRESETS = {
  // Default — dye-driven haze with user-picked tint. Mirrors Smoke's fluid
  // preset (gentle curl, slow decay, vorticity on, walls open).
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
    intensity: 1.0,
  },
  // Volume Cursor — same dye plumbing, gradient-driven 3D shading.
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
    intensity: 1.0,
  },
  // Directional wake — sharp leading edge, long fading tail. Low curl, no
  // vorticity so the streak stays clean rather than swirling on itself.
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
  // Tight curling palette glow — Fedkiw-style vortices, walls reflect.
  // Slightly stiffer projection (10 iters, 0.85 carry) preserves the swirls.
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
  // FluidCursor-style soft waves leaving the screen.
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
  // Classic FluidCursor rainbow: vorticity ON for visible curls, walls
  // reflect to keep colour trapped on screen, slow density decay so the
  // hue bands persist long enough to interleave.
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
  // Rainbow ring per vortex: hue from velocity angle, brightness from speed.
  // Same vortex-friendly tuning as `colorful` so swirls are pronounced; lower
  // density dissipation doesn't matter here (overlay reads velocity, not dye).
  rainbowFish: {
    splatRadius: 12,
    splatForce: 3,
    pressureIterations: 6,
    curlStrength: 0.0,
    velocityDissipation: 0.96,
    densityDissipation: 0.935,
    pressureDissipation: 0.05,
    enableVorticity: false,
    reflectWalls: false,
    intensity: 0.6,
  },
  // Minimal additive density tint — calm, controlled. Looser projection
  // (6 iters, 0.78 carry) keeps the field gentle.
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
    intensity: 1.0,
  },
  // Ghostly fire fingers — small splats, strong curl, fast density decay.
  // Stiffer projection sharpens the finger silhouettes.
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
  // White cigarette smoke / steam. Mirrors Art Ink's preset family (gentle
  // curl, slow decay, vorticity on for visible plumes) so a drag produces a
  // softly curling plume instead of a fast-spreading puff. Walls don't
  // reflect — smoke drifts off-screen rather than piling up.
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
    intensity: 1.0,
  },
  // Art Ink — colourful strokes: per-stroke hue-cycling dye, gentle curl,
  // walls reflect to keep colour on screen, slow dye decay so strokes linger.
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
    intensity: 1.0,
  },
  // Rainbow Ink — same dye plumbing as Art Ink, but radial palette overrides
  // the per-stroke hue. Slightly larger splats so the gradient reads.
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
    intensity: 1.0,
  },
  // Color Water — under-projected fluid (4 Jacobi + aggressive pressure
  // dissipation) so splats relax outward instead of swirling tight; BFECC
  // off swaps sharp advection for smoother bilerp diffusion = soft outward
  // bloom; vorticity on for visible but gentle curl; open walls so plumes
  // drift off-screen instead of piling up. Dye decay is set explicitly
  // higher than density so the watercolour blot's colour outlives the
  // underlying flow.
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
  // Liquid Lens — UV refraction + multiplicative composite (dreamers-style).
  // Shares Color Water's soft fluid params but lower intensity since the
  // multiplicative tint can blow highlights faster than alpha-mix.
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
    intensity: 1.0,
  },
}
const DEFAULTS = {
  ...PRESETS.default, // initial values match the default style
  bfecc: true,
  opacity: 1,
  // Mirrors densityDissipation by default — gets overwritten when switching
  // to a preset (spread) that pins it to its own value.
  dyeDissipation: PRESETS.default.dyeDissipation ?? PRESETS.default.densityDissipation,
  overlayStyle: 'default',
  // Tweakpane reads `{r,g,b}` 0–1 as a float color when paired with
  // `color: { type: 'float' }`. Used by Trail and Default styles.
  cursorColor: { r: 0.85, g: 0.95, b: 1.0 },
  // Saturation boost on top of cursorColor — 0 leaves the picked colour
  // untouched, 1 doubles chroma away from luminance (clamped to [0,1]).
  // Applied by Trail / Default / Volume Cursor only.
  vibrance: 0,
  // Base hue family for Liquid Lens. Splat colour = liquidColor scaled by
  // motion magnitude, plus a small per-channel kick from motion direction
  // (horizontal → red, vertical → blue) so the dreamers-style gesture
  // signature still reads. Default leans pink/violet — close to dreamers'
  // baseline but the user can pick any hue from the GUI.
  liquidColor: { r: 0.85, g: 0.25, b: 1.0 },
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
const demo = setupDemoReel(`Overlay: ${OVERLAY_LABELS[requestedOverlayStyle]}`)
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
// — fluid + offscreen target for the overlay composite —
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
// Enable the dye channel so PDG-style coloured strokes accumulate.
fluid.enableDye = true
const clock = new Timer()
// — background switcher (dark / bright / slideshow) —
// Each overlay style has a paired background: most pair with `dark`, but
// `liquidLens` reads better over a bright backdrop, so it auto-switches
// when selected. `persist: false` keeps the per-style pairing stable
// across reloads instead of drifting via localStorage.
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
const controls = createControlsPane('Overlay', initialParams, (pane, p) => {
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
  // Styles that read uCursorColor — picker is hidden for everything else.
  const usesCursorColor = (s) => s === 'trail' || s === 'default' || s === 'volumeCursor'
  // Styles whose shader actually applies vibrant() to its output. Smoke
  // is monochrome white (vibrance is a no-op) and Velocity is a debug
  // glaze of raw RG vectors — both stay out.
  const usesVibrance = (s) => s !== 'smoke' && s !== 'velocity'
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
      // Each style has its own fluid + visual tuning. Apply the preset and
      // refresh the panel so the user sees the new values in the GUI.
      applyOverlayStyle(p, ev.value)
      cursorColorBinding.hidden = !usesCursorColor(ev.value)
      vibranceBinding.hidden = !usesVibrance(ev.value)
      liquidColorBinding.hidden = ev.value !== 'liquidLens'
      // Auto-switch backdrop to match the selected style.
      switcher.select(backgroundForStyle(ev.value))
      pane.refresh()
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
  const debug = pane.addFolder({ title: 'Debug', expanded: false })
  addProfileSwitcher(debug, profile)
})
// Two palette modes coexist:
//   • HSV-cycle (legacy `coloredStrokes`) — playful per-stroke rainbow, used
//     by Art Ink, Rainbow Ink, Color Water, Default, Smoke, Volume Cursor.
//   • `colorize` override — kicks in only for Liquid Lens. User picks the
//     base hue (`liquidColor`); motion magnitude scales overall brightness;
//     motion direction adds a small per-channel kick (horizontal → red,
//     vertical → blue) so the trail visibly responds to gesture direction
//     in the dreamers signature without leaving the picked hue family.
const liquidLensColorize = (dx, dy) => {
  if (controls.params.overlayStyle !== 'liquidLens') return undefined
  const lc = controls.params.liquidColor
  // Per-event motion (CSS px) → 0..1 saturation per axis. Threshold 25 px
  // ≈ a moderate pointer move; faster moves saturate the kick.
  const sx = Math.min(Math.abs(dx) / 25, 1)
  const sy = Math.min(Math.abs(dy) / 25, 1)
  const speed = Math.hypot(sx, sy)
  // User's hue dominates: lc * (0.4 base + speed-driven 0.6 boost). The
  // sx/sy *0.5 terms are a *small* per-channel kick on top — visible but
  // not enough to pull the colour out of the picked hue family. Final
  // *0.3 is the same dye-amplitude calibration as the HSV-cycle path.
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
const overlays = {
  default: new DefaultOverlayPass(fluid),
  volumeCursor: new VolumeCursorOverlayPass(fluid),
  trail: new TrailOverlayPass(fluid),
  oil: new OilOverlayPass(fluid),
  velocity: new VelocityOverlayPass(fluid),
  colorful: new ColorfulOverlayPass(fluid),
  rainbowFish: new RainbowFishOverlayPass(fluid),
  glaze: new GlazeOverlayPass(fluid),
  burn: new BurnOverlayPass(fluid),
  smoke: new SmokeOverlayPass(fluid),
  artInk: new ArtInkOverlayPass(fluid),
  rainbowInk: new RainbowInkOverlayPass(fluid),
  colorWater: new ColorWaterOverlayPass(fluid),
  liquidLens: new LiquidLensOverlayPass(fluid),
}
// EffectComposer pipeline: RenderPass draws the scene (background + any
// future 3D content) into the composer's read buffer, then the active
// overlay reads that and writes the next stage. All 14 overlays live in
// the chain; only one is enabled per frame, the rest short-circuit via
// `pass.enabled = false`. OutputPass is the canonical final pass —
// applies the renderer's tone mapping (ACES Filmic) and converts linear
// HDR back to the screen's sRGB output. EffectComposer auto-sets
// `renderToScreen` on the last enabled pass (= OutputPass here).
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
for (const effect of Object.values(overlays)) {
  effect.enabled = false
  composer.addPass(effect)
}
composer.addPass(new OutputPass())
// — resize: keep renderer, camera, composer and fluid in sync with the stage —
const resize = () => {
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
// Push the current GUI values into `fluid` and the active overlay effect.
// Called once per frame from the loop. `time` is set in the loop itself
// because it's per-frame by definition (animated effects); everything else
// here mirrors panel state that only changes on user input.
const syncParams = (activeOverlay) => {
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
  activeOverlay.intensity = p.intensity
  activeOverlay.opacity = p.opacity
  // Each effect ignores fields it doesn't have. Set everything that *might*
  // apply — the static type filters out unsupported writes per case.
  if ('vibrance' in activeOverlay) activeOverlay.vibrance = p.vibrance
  if ('cursorColor' in activeOverlay) {
    activeOverlay.cursorColor.setRGB(p.cursorColor.r, p.cursorColor.g, p.cursorColor.b)
  }
}
renderer.setAnimationLoop(() => {
  clock.update()
  const dt = Math.min(Math.max(clock.getDelta(), 1e-6), 1 / 30)
  const fluidDt = Math.min(dt, 1 / 60)
  const elapsed = clock.getElapsed()
  const activeOverlay = overlays[controls.params.overlayStyle]
  for (const effect of Object.values(overlays)) effect.enabled = effect === activeOverlay
  syncParams(activeOverlay)
  if ('time' in activeOverlay) activeOverlay.time = elapsed
  if (demo.enabled) driveDemoSplats(demo.elapsed())
  fluid.step(fluidDt)
  switcher.update(dt, elapsed)
  composer.render(dt)
})
window.addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null)
  window.removeEventListener('resize', resize)
  composer.dispose()
  for (const effect of Object.values(overlays)) effect.dispose()
  detachPointerSplats?.()
  switcher.dispose()
  controls.dispose()
  fluid.dispose()
  renderer.dispose()
  renderer.domElement.remove()
})
