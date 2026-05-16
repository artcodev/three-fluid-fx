import '../../../../styles.css'
import {
  ACESFilmicToneMapping,
  Color,
  Matrix3,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector3,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { addProfileSwitcher, createControlsPane } from '../../../extras/controls/createControlsPane'
import { createFlowParticles } from '../../../extras/particles/glsl/flowParticles'
import { attachPointerSplats, DensityTintOverlayPass, FluidSimulation } from 'three-fluid-fx'
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
  setupDemoReel,
} from '../../../extras/demo/reel'

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) {
  throw new Error('Missing #stage element')
}

const DEFAULTS = {
  splatRadius: 10,
  splatForce: 6,
  pressureIterations: 8,
  curlStrength: 0.05,
  velocityDissipation: 0.992,
  densityDissipation: 0.9,
  pressureDissipation: 0.8,
  enableVorticity: false,
  bfecc: true,
  reflectWalls: true,
  flowStrength: 1.05,
  depthLift: 0.95,
  flowThreshold: 50,
  maxFlowSpeed: 12,
  responseGamma: 4,
  perpendicularAngle: 1.25,
  sideVariation: 1,
  depthAttenuationScale: 2,
  spring: 4.0,
  zeta: 1.15,
  dragLin: 0.28,
  dragQuad: 0.05,
  aMax: 24,
  vMaxScale: 1,
  pointSize: 10,
  rotationSpeed: 0.07,
}

const demo = setupDemoReel('Particles 3D')

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
camera.position.set(0, 0, 6.4)
const cameraRight = new Vector3()
const cameraUp = new Vector3()

// — fluid + offscreen target for the composite —
const fluid = new FluidSimulation(renderer, {
  profile,
  splatRadius: DEFAULTS.splatRadius * SCALE.splatRadius,
  splatForce: DEFAULTS.splatForce,
  pressureIterations: DEFAULTS.pressureIterations,
  curlStrength: DEFAULTS.curlStrength,
  velocityDissipation: DEFAULTS.velocityDissipation,
  densityDissipation: DEFAULTS.densityDissipation,
  pressureDissipation: DEFAULTS.pressureDissipation,
  enableVorticity: DEFAULTS.enableVorticity,
  bfecc: DEFAULTS.bfecc,
  reflectWalls: DEFAULTS.reflectWalls,
})
const clock = new Timer()

const particles = createFlowParticles(renderer, { mode: 'cloud3d', size: 64 })
scene.add(particles.points)

// — background switcher (dark / bright / slideshow) —
const switcher = attachBackgroundSwitcher({
  scene,
  initial: resolveBackground('dark', { skipStorage: true }),
  persist: false,
  factories: {
    dark: () => new Backdrop(camera, 'dark'),
    bright: () => new Backdrop(camera, 'bright'),
    slideshow: () => new Slideshow({ camera, paths: DEFAULT_SLIDESHOW_PATHS }),
  },
})

const controls = createControlsPane('Particles 3D', { ...DEFAULTS }, (pane, p) => {
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

  const influence = pane.addFolder({ title: 'Influence' })
  influence.addBinding(p, 'flowStrength', { ...RANGES.flowStrength, label: 'flow' })
  influence.addBinding(p, 'depthLift', { ...RANGES.depthLift, label: '3D lift' })
  influence.addBinding(p, 'flowThreshold', { ...RANGES.flowThreshold, label: 'thresh' })
  influence.addBinding(p, 'maxFlowSpeed', { ...RANGES.maxFlowSpeed, label: 'max speed' })
  influence.addBinding(p, 'responseGamma', { ...RANGES.responseGamma, label: 'response γ' })

  influence.addBinding(p, 'depthAttenuationScale', {
    ...RANGES.depthAttenuationScale,
    label: 'depth scale',
  })
  influence.addBinding(p, 'perpendicularAngle', {
    ...RANGES.perpendicularAngle,
    label: 'perp angle',
  })
  influence.addBinding(p, 'sideVariation', { ...RANGES.sideVariation, label: 'side var' })

  const physics = pane.addFolder({ title: 'Particle physics' })
  physics.addBinding(p, 'spring', { ...RANGES.spring, label: 'spring ω' })
  physics.addBinding(p, 'zeta', { ...RANGES.zeta, label: 'damping ζ' })
  physics.addBinding(p, 'dragLin', { ...RANGES.dragLin, label: 'drag lin' })
  physics.addBinding(p, 'dragQuad', { ...RANGES.dragQuad, label: 'drag quad' })
  physics.addBinding(p, 'aMax', { ...RANGES.aMax, label: 'a max' })
  physics.addBinding(p, 'vMaxScale', { ...RANGES.vMaxScale, label: 'v max ×' })

  const motion = pane.addFolder({ title: 'Motion' })
  motion.addBinding(p, 'rotationSpeed', { ...RANGES.rotationSpeed, label: 'spin (rad/s)' })

  const render = pane.addFolder({ title: 'Render' })
  render.addBinding(p, 'pointSize', { ...RANGES.pointSize, label: 'point size' })

  const debug = pane.addFolder({ title: 'Debug', expanded: false })
  addProfileSwitcher(debug, profile)
})

const detachPointerSplats = demo.enabled
  ? attachDemoManualTakeover(demo, renderer.domElement, () =>
      attachPointerSplats(renderer.domElement, fluid),
    )
  : attachPointerSplats(renderer.domElement, fluid)
const driveDemoSplats = createDemoSplatDriver(fluid)

// EffectComposer pipeline: RenderPass draws the scene (background + the
// particle cloud) into the composer's read buffer, then DensityTintOverlayPass
// adds a faint teal tint by fluid density. OutputPass closes the chain with
// the renderer's tone mapping + sRGB conversion to screen. Slightly darker
// tint + higher intensity than the 2D example for the cloudier 3D feel.
const tint = new DensityTintOverlayPass(fluid)
tint.color.setRGB(0.08, 0.3, 0.32)
tint.intensity = 0.18

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(tint)
composer.addPass(new OutputPass())

const modelRotation = new Matrix3()
let spinAngle = 0

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

// Push the current GUI values into `fluid`. Called once per frame from the
// loop. Particle physics params don't need this — they're read directly off
// `controls.params` inside the `particles.step({...})` call.
const syncFluidParams = (): void => {
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
}

renderer.setAnimationLoop(() => {
  clock.update()
  const dt = Math.min(Math.max(clock.getDelta(), 1e-6), 1 / 30)
  const fluidDt = Math.min(dt, 1 / 60)
  const elapsed = clock.getElapsed()
  const dpr = renderer.getPixelRatio()
  const p = controls.params

  spinAngle += p.rotationSpeed * dt
  particles.points.rotation.y = spinAngle
  particles.points.updateMatrixWorld(true)
  modelRotation.setFromMatrix4(particles.points.matrixWorld)

  syncFluidParams()
  if (demo.enabled) driveDemoSplats(demo.elapsed())
  fluid.step(fluidDt)
  cameraRight.setFromMatrixColumn(camera.matrixWorld, 0)
  cameraUp.setFromMatrixColumn(camera.matrixWorld, 1)
  particles.step({
    dt,
    dpr,
    velocityField: fluid.velocityTexture,
    viewMatrix: camera.matrixWorldInverse,
    projectionMatrix: camera.projectionMatrix,
    cameraRight: cameraRight,
    cameraUp: cameraUp,
    modelRotation,
    pointSize: p.pointSize,
    spring: p.spring,
    zeta: p.zeta,
    dragLin: p.dragLin,
    dragQuad: p.dragQuad,
    aMax: p.aMax,
    vMaxScale: p.vMaxScale,
    flowStrength: p.flowStrength,
    depthLift: p.depthLift,
    flowThreshold: p.flowThreshold * SCALE.flowThreshold,
    maxFlowSpeed: p.maxFlowSpeed,
    responseGamma: p.responseGamma,
    perpendicularAngle: p.perpendicularAngle,
    sideVariation: p.sideVariation,
    depthAttenuationScale: p.depthAttenuationScale,
  })

  switcher.update(dt, elapsed)
  composer.render(dt)
})

window.addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null)
  window.removeEventListener('resize', resize)
  composer.dispose()
  scene.remove(particles.points)
  particles.dispose()
  tint.dispose()
  detachPointerSplats?.()
  switcher.dispose()
  controls.dispose()
  fluid.dispose()
  renderer.dispose()
  renderer.domElement.remove()
})
