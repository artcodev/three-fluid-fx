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
} from 'three'
import { RenderPipeline, WebGPURenderer } from 'three/webgpu'
import { pass, vec3 } from 'three/tsl'
import { attachPointerSplats, densityTintOverlay, FluidSimulation } from 'three-fluid-fx/tsl'
import { Backdrop } from '../../../extras/backgrounds/tsl/Backdrop'
import { Slideshow } from '../../../extras/backgrounds/tsl/Slideshow'
import { DEFAULT_SLIDESHOW_PATHS } from '../../../extras/backgrounds/defaults'
import { attachBackgroundSwitcher } from '../../../extras/backgrounds/attachBackgroundSwitcher'
import { resolveBackground } from '../../../extras/backgrounds/resolveBackground'
import { createControlsPane } from '../../../extras/controls/createControlsPane'
import { RANGES, SCALE } from '../../../extras/controls/paramRanges'
import { createTrefoilParticles } from '../../../extras/particles/tsl/TrefoilParticles'
import { resolveProfile } from '../../../extras/resolveProfile'
import {
  attachDemoManualTakeover,
  createDemoSplatDriver,
  setupDemoReel,
} from '../../../extras/demo/reel'
import { asNode, setPipelineOutput } from '../../shared/nodeInterop'

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage element')
const demo = setupDemoReel('TSL Trefoil Particles')

if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
  stage.textContent =
    'WebGPU is not available in this browser. The TSL example needs a WebGPU-capable browser.'
  throw new Error('WebGPU unavailable')
}

const COUNT = 4000

const DEFAULTS = {
  tubeRadius: 0.3,
  scale: 0.55,
  pointSize: 6,
  rotationSpeed: 0.2,
  displacement: 1,
  dispThreshold: 0.08,
  dispRange: 0.3,
  dragStrength: 0.1,
  maxFlowSpeed: 10,
  splatRadius: 25,
  splatForce: 10,
  pressureIterations: 15,
  curlStrength: 0.2,
  velocityDissipation: 0.99,
  densityDissipation: 0.98,
  pressureDissipation: 0.8,
  enableVorticity: false,
  bfecc: true,
  reflectWalls: false,
}

const profile = resolveProfile('balanced')
const renderer = new WebGPURenderer({ antialias: true, forceWebGL: false })
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
camera.position.set(0, 0, 5.5)
camera.updateMatrixWorld(true)

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
const detachPointerSplats = demo.enabled
  ? attachDemoManualTakeover(demo, renderer.domElement, () =>
      attachPointerSplats(renderer.domElement, fluid),
    )
  : attachPointerSplats(renderer.domElement, fluid)
const driveDemoSplats = createDemoSplatDriver(fluid)

const trefoil = createTrefoilParticles(fluid.densityNode, {
  count: COUNT,
  tubeRadius: DEFAULTS.tubeRadius,
  scale: DEFAULTS.scale,
  pointSize: DEFAULTS.pointSize,
  displacement: DEFAULTS.displacement,
  dispThreshold: DEFAULTS.dispThreshold,
  dispRange: DEFAULTS.dispRange,
  dragStrength: DEFAULTS.dragStrength,
  maxFlowSpeed: DEFAULTS.maxFlowSpeed,
})
scene.add(trefoil.mesh)

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

const controls = createControlsPane('TSL · Trefoil', { ...DEFAULTS }, (pane, p) => {
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

  const knot = pane.addFolder({ title: 'Trefoil shape' })
  knot.addBinding(p, 'tubeRadius', { min: 0, max: 0.6, step: 0.005, label: 'tube radius' })
  knot.addBinding(p, 'scale', { min: 0.1, max: 1.5, step: 0.01, label: 'scale' })
  knot.addBinding(p, 'pointSize', { ...RANGES.pointSize, label: 'point size' })

  const motion = pane.addFolder({ title: 'Motion' })
  motion.addBinding(p, 'rotationSpeed', { ...RANGES.rotationSpeed, label: 'spin' })

  const displacement = pane.addFolder({ title: 'Displacement' })
  displacement.addBinding(p, 'displacement', { min: 0, max: 2, step: 0.01, label: 'amount' })
  displacement.addBinding(p, 'dispThreshold', { min: 0, max: 0.5, step: 0.005, label: 'threshold' })
  displacement.addBinding(p, 'dispRange', { min: 0.05, max: 1, step: 0.01, label: 'range' })
  displacement.addBinding(p, 'dragStrength', { min: 0, max: 0.4, step: 0.005, label: 'drag' })
  displacement.addBinding(p, 'maxFlowSpeed', { min: 1, max: 80, step: 0.5, label: 'max speed' })
})

const scenePass = pass(scene, camera)
const pipeline = new RenderPipeline(renderer)
setPipelineOutput(
  pipeline,
  densityTintOverlay(asNode(scenePass), asNode(fluid.densityNode), {
    tint: vec3(0.08, 0.3, 0.32),
    intensity: 0.16,
  }),
)

const syncParams = (): void => {
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

const resize = (): void => {
  const w = Math.max(1, stage.clientWidth)
  const h = Math.max(1, stage.clientHeight)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(dpr)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  fluid.resize(w, h)
}
resize()
window.addEventListener('resize', resize)

const clock = new Timer()
const cameraRight = new Vector3()
const cameraUp = new Vector3()
const modelRotation = new Matrix3()
let spinAngle = 0

renderer.setAnimationLoop(() => {
  clock.update()
  const frameDt = Math.min(Math.max(clock.getDelta(), 1e-6), 1 / 30)
  const fluidDt = Math.min(frameDt, 1 / 60)
  const elapsed = clock.getElapsed()
  const p = controls.params

  syncParams()
  if (demo.enabled) driveDemoSplats(demo.elapsed())
  spinAngle += p.rotationSpeed * frameDt
  trefoil.mesh.rotation.y = spinAngle
  trefoil.mesh.updateMatrixWorld(true)
  modelRotation.setFromMatrix4(trefoil.mesh.matrixWorld)

  fluid.step(fluidDt)

  camera.updateMatrixWorld()
  cameraRight.setFromMatrixColumn(camera.matrixWorld, 0)
  cameraUp.setFromMatrixColumn(camera.matrixWorld, 1)
  trefoil.update({
    cameraRight,
    cameraUp,
    modelRotation,
    tubeRadius: p.tubeRadius,
    scale: p.scale,
    pointSize: p.pointSize,
    displacement: p.displacement,
    dispThreshold: p.dispThreshold,
    dispRange: p.dispRange,
    dragStrength: p.dragStrength,
    maxFlowSpeed: p.maxFlowSpeed,
  })

  switcher.update(frameDt, elapsed)
  pipeline.render()
})

window.addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null)
  window.removeEventListener('resize', resize)
  scene.remove(trefoil.mesh)
  trefoil.dispose()
  pipeline.dispose()
  detachPointerSplats?.()
  switcher.dispose()
  controls.dispose()
  fluid.dispose()
  renderer.dispose()
  renderer.domElement.remove()
})
