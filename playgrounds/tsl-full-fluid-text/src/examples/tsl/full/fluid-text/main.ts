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
import type { Node } from 'three/webgpu'
import { pass, uniform } from 'three/tsl'
import {
  attachPointerSplats,
  FluidSimulation,
  fluidOverlay,
  simpleDistortion,
} from 'three-fluid-fx/tsl'
import { Backdrop } from '../../../extras/backgrounds/tsl/Backdrop'
import { Slideshow } from '../../../extras/backgrounds/tsl/Slideshow'
import { DEFAULT_SLIDESHOW_PATHS } from '../../../extras/backgrounds/defaults'
import { attachBackgroundSwitcher } from '../../../extras/backgrounds/attachBackgroundSwitcher'
import { resolveBackground } from '../../../extras/backgrounds/resolveBackground'
import { createControlsPane } from '../../../extras/controls/createControlsPane'
import { RANGES, SCALE } from '../../../extras/controls/paramRanges'
import {
  attachDemoManualTakeover,
  createDemoSplatDriver,
  setupDemoReel,
} from '../../../extras/demo/reel'
import { resolveProfile } from '../../../extras/resolveProfile'
import { DomTextPlane } from '../../../extras/text/DomTextPlane'
import { asNode, asTsl, setPipelineOutput, type UniformValue } from '../../shared/nodeInterop'

interface FluidTextParams {
  headline: string
  lead: string
  overlayEnabled: boolean
  distortionEnabled: boolean
  splatRadius: number
  splatForce: number
  pressureIterations: number
  curlStrength: number
  velocityDissipation: number
  densityDissipation: number
  dyeDissipation: number
  pressureDissipation: number
  enableVorticity: boolean
  bfecc: boolean
  reflectWalls: boolean
  distortionIntensity: number
  overlayIntensity: number
  overlayOpacity: number
  overlayVelocityScale: number
  cursorColor: { r: number; g: number; b: number }
  vibrance: number
}

const CAMERA_FOV = 45
const CAMERA_Z = 6.4
const FIXED_FLUID_DT = 1 / 60
const MAX_FLUID_SUBSTEPS = 4

const DEFAULTS: FluidTextParams = {
  headline: 'Fluid Text',
  lead: 'Live typography, bent by fluid motion.',
  overlayEnabled: true,
  distortionEnabled: true,
  splatRadius: 14,
  splatForce: 7,
  pressureIterations: 10,
  curlStrength: 0.18,
  velocityDissipation: 0.99,
  densityDissipation: 0.94,
  dyeDissipation: 0.965,
  pressureDissipation: 0.8,
  enableVorticity: false,
  bfecc: true,
  reflectWalls: false,
  distortionIntensity: 0.45,
  overlayIntensity: 0.85,
  overlayOpacity: 0.5,
  overlayVelocityScale: 1,
  cursorColor: { r: 0.85, g: 0.95, b: 1 },
  vibrance: 0.5,
}

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage element')

if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
  stage.textContent =
    'WebGPU is not available in this browser. The TSL example needs a WebGPU-capable browser.'
  throw new Error('WebGPU unavailable')
}

const params: FluidTextParams = {
  ...DEFAULTS,
  cursorColor: { ...DEFAULTS.cursorColor },
}
const demo = setupDemoReel('TSL Fluid Text')

const styleElement = document.createElement('style')
styleElement.textContent = `
.fluid-text-copy {
  position: absolute;
  inset: 0;
  z-index: 1;
  box-sizing: border-box;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 18px;
  padding: clamp(84px, 11vw, 150px) max(24px, 8vw) clamp(74px, 9vw, 120px);
  text-align: center;
  color: #f3f0e8;
  pointer-events: none;
}
.fluid-text-copy p {
  margin: 0;
}
.fluid-text-kicker {
  color: #ff7a5f;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.fluid-text-copy h2 {
  width: min(980px, 88vw);
  margin: 0;
  color: #f3f0e8;
  font-size: clamp(52px, 8.6vw, 132px);
  font-weight: 820;
  line-height: 0.88;
  letter-spacing: 0;
  text-wrap: balance;
}
.fluid-text-lead {
  width: min(780px, 78vw);
  color: rgba(243, 240, 232, 0.72);
  font-size: clamp(17px, 2.1vw, 25px);
  line-height: 1.42;
}
.fluid-text-copy.is-synced .fluid-text-kicker,
.fluid-text-copy.is-synced h2,
.fluid-text-copy.is-synced .fluid-text-lead {
  color: transparent;
  -webkit-text-fill-color: transparent;
}
@media (max-width: 720px) {
  .fluid-text-copy {
    gap: 14px;
    padding-inline: 22px;
  }
  .fluid-text-copy h2 {
    width: min(520px, 92vw);
    font-size: clamp(48px, 16vw, 82px);
  }
  .fluid-text-lead {
    width: min(520px, 86vw);
  }
}
`
document.head.appendChild(styleElement)

const renderer = new WebGPURenderer({ antialias: true, forceWebGL: false })
renderer.outputColorSpace = SRGBColorSpace
renderer.toneMapping = ACESFilmicToneMapping
renderer.toneMappingExposure = 1
renderer.setClearColor(new Color('#07080b'), 1)
renderer.domElement.style.position = 'absolute'
renderer.domElement.style.inset = '0'
stage.appendChild(renderer.domElement)

const textRoot = document.createElement('div')
textRoot.className = 'fluid-text-copy'
textRoot.innerHTML = `
  <p class="fluid-text-kicker">THREE-FLUID-FX</p>
  <h2></h2>
  <p class="fluid-text-lead"></p>
`
stage.appendChild(textRoot)

await renderer.init()
if ('fonts' in document) {
  await document.fonts.ready
}

const scene = new Scene()
const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100)
camera.position.set(0, 0, CAMERA_Z)
camera.updateMatrixWorld(true)

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

const textElements = [...textRoot.querySelectorAll('.fluid-text-kicker, h2, .fluid-text-lead')]
if (!textElements.every((element): element is HTMLElement => element instanceof HTMLElement)) {
  throw new Error('Fluid text DOM source is incomplete')
}

const textPlane = new DomTextPlane(stage, textElements)
scene.add(textPlane.mesh)

const profile = resolveProfile('balanced')
const fluid = new FluidSimulation(renderer, {
  profile,
  splatRadius: params.splatRadius * SCALE.splatRadius,
  splatForce: params.splatForce,
  pressureIterations: params.pressureIterations,
  curlStrength: params.curlStrength,
  velocityDissipation: params.velocityDissipation,
  densityDissipation: params.densityDissipation,
  pressureDissipation: params.pressureDissipation,
  enableVorticity: params.enableVorticity,
  bfecc: params.bfecc,
  reflectWalls: params.reflectWalls,
})
fluid.enableDye = true

const overlayIntensity = uniform(params.overlayIntensity)
const overlayOpacity = uniform(params.overlayOpacity)
const overlayVelocityScale = uniform(params.overlayVelocityScale)
const distortionIntensity = uniform(params.distortionIntensity)
const elapsedTime = uniform(0)
const dyeTexel = uniform(new Vector2(1 / 512, 1 / 512))
const cursorColor = uniform(
  new Color(params.cursorColor.r, params.cursorColor.g, params.cursorColor.b),
)
const vibrance = uniform(params.vibrance)
const scenePass = pass(scene, camera)

function buildOutput(): Node {
  let output = asNode(scenePass)
  if (params.distortionEnabled) {
    output = simpleDistortion(output, asNode(fluid.densityNode), asNode(distortionIntensity))
  }
  if (params.overlayEnabled) {
    output = fluidOverlay(
      'artInk',
      output,
      asNode(fluid.densityNode),
      asNode(fluid.dyeNode),
      asNode(fluid.velocityNode),
      {
        intensity: asNode(overlayIntensity),
        opacity: asNode(overlayOpacity),
        time: asNode(elapsedTime),
        texel: asNode(dyeTexel),
        cursorColor: asNode(cursorColor),
        vibrance: asNode(vibrance),
        velocityScale: asNode(overlayVelocityScale),
      },
    )
  }
  return output
}

const pipeline = new RenderPipeline(renderer)

function setOutput(): void {
  setPipelineOutput(pipeline, buildOutput())
}

setOutput()

function getWorldViewport(): { width: number; height: number } {
  const height = 2 * CAMERA_Z * Math.tan((CAMERA_FOV * Math.PI) / 360)
  return {
    height,
    width: height * camera.aspect,
  }
}

function syncTextCopy(): void {
  const headline = textRoot.querySelector('h2')
  const lead = textRoot.querySelector('.fluid-text-lead')
  if (headline instanceof HTMLElement) headline.textContent = params.headline
  if (lead instanceof HTMLElement) lead.textContent = params.lead

  const viewport = getWorldViewport()
  textPlane.sync(viewport.width, viewport.height)
  textRoot.classList.add('is-synced')
}

const controls = createControlsPane('TSL · Fluid Text', params, (pane, p) => {
  const copy = pane.addFolder({ title: 'Text' })
  copy.addBinding(p, 'headline', { label: 'headline' }).on('change', syncTextCopy)
  copy.addBinding(p, 'lead', { label: 'lead' }).on('change', syncTextCopy)

  const layers = pane.addFolder({ title: 'Layers' })
  layers.addBinding(p, 'distortionEnabled', { label: 'distortion' }).on('change', setOutput)
  layers.addBinding(p, 'overlayEnabled', { label: 'overlay' }).on('change', setOutput)

  const splat = pane.addFolder({ title: 'Splat', expanded: false })
  splat.addBinding(p, 'splatRadius', { ...RANGES.splatRadius, label: 'radius' })
  splat.addBinding(p, 'splatForce', { ...RANGES.splatForce, label: 'force' })

  const sim = pane.addFolder({ title: 'Fluid sim', expanded: false })
  sim.addBinding(p, 'pressureIterations', { ...RANGES.pressureIterations, label: 'pressure' })
  sim.addBinding(p, 'curlStrength', { ...RANGES.curlStrength, label: 'curl' })
  sim.addBinding(p, 'velocityDissipation', { ...RANGES.velocityDissipation, label: 'vel diss' })
  sim.addBinding(p, 'densityDissipation', { ...RANGES.densityDissipation, label: 'dens diss' })
  sim.addBinding(p, 'dyeDissipation', { ...RANGES.densityDissipation, label: 'dye diss' })
  sim.addBinding(p, 'pressureDissipation', { ...RANGES.pressureDissipation, label: 'pres diss' })
  sim.addBinding(p, 'enableVorticity', { label: 'vorticity' })
  sim.addBinding(p, 'bfecc', { label: 'BFECC' })
  sim.addBinding(p, 'reflectWalls', { label: 'reflect walls' })

  const render = pane.addFolder({ title: 'Render', expanded: false })
  render.addBinding(p, 'distortionIntensity', {
    ...RANGES.intensity,
    max: 2,
    label: 'distortion',
  })
  render.addBinding(p, 'overlayIntensity', { ...RANGES.intensity, max: 3, label: 'overlay' })
  render.addBinding(p, 'overlayOpacity', { ...RANGES.opacity, label: 'opacity' })
  render.addBinding(p, 'overlayVelocityScale', {
    label: 'velocity scale',
    min: 0.05,
    max: 2,
    step: 0.01,
  })
  render.addBinding(p, 'cursorColor', {
    label: 'cursor color',
    color: { type: 'float' },
  })
  render.addBinding(p, 'vibrance', {
    label: 'vibrance',
    min: 0,
    max: 1,
    step: 0.01,
  })
})

const detachPointerSplats = demo.enabled
  ? attachDemoManualTakeover(demo, renderer.domElement, () =>
      attachPointerSplats(renderer.domElement, fluid, { coloredStrokes: true }),
    )
  : attachPointerSplats(renderer.domElement, fluid, { coloredStrokes: true })
const driveDemoSplats = createDemoSplatDriver(fluid)

function syncParams(): void {
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

  asTsl<UniformValue<number>>(overlayIntensity).value = p.overlayIntensity
  asTsl<UniformValue<number>>(overlayOpacity).value = p.overlayOpacity
  asTsl<UniformValue<number>>(overlayVelocityScale).value = p.overlayVelocityScale
  asTsl<UniformValue<number>>(distortionIntensity).value = p.distortionIntensity
  asTsl<UniformValue<number>>(vibrance).value = p.vibrance
  asTsl<UniformValue<Color>>(cursorColor).value.setRGB(
    p.cursorColor.r,
    p.cursorColor.g,
    p.cursorColor.b,
  )
}

function syncDyeTexel(): void {
  const img = fluid.dyeTexture.image as { width?: number; height?: number }
  const w = img.width ?? 512
  const h = img.height ?? 512
  asTsl<UniformValue<Vector2>>(dyeTexel).value.set(1 / w, 1 / h)
}

const resize = (): void => {
  const width = Math.max(1, stage.clientWidth)
  const height = Math.max(1, stage.clientHeight)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  renderer.setPixelRatio(dpr)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.fov = CAMERA_FOV
  camera.position.set(0, 0, CAMERA_Z)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  fluid.resize(width, height)
  syncDyeTexel()
  syncTextCopy()
}
resize()
window.addEventListener('resize', resize)
window.visualViewport?.addEventListener('resize', resize)

const clock = new Timer()
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
  window.visualViewport?.removeEventListener('resize', resize)
  detachPointerSplats?.()
  switcher.dispose()
  controls.dispose()
  textPlane.dispose()
  fluid.dispose()
  pipeline.dispose()
  renderer.dispose()
  renderer.domElement.remove()
  textRoot.remove()
  styleElement.remove()
})
