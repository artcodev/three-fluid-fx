import '../../../../src/styles.css'
import {
  ACESFilmicToneMapping,
  Color,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
} from 'three'
import { RenderPipeline, WebGPURenderer } from 'three/webgpu'
import { pass, uniform } from 'three/tsl'
import {
  attachPointerSplats,
  FluidSimulation,
  fluidOverlay,
  simpleDistortion,
} from 'three-fluid-fx/tsl'
import { DomTextPlane } from '../../../extras/text/DomTextPlane'
import { asNode, asTsl, setPipelineOutput, type UniformValue } from '../../shared/nodeInterop'

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage')

if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
  stage.textContent =
    'WebGPU is not available in this browser. The TSL example needs a WebGPU-capable browser.'
  throw new Error('WebGPU unavailable')
}

const CAMERA_FOV = 45
const CAMERA_Z = 6.4
const FIXED_FLUID_DT = 1 / 60
const MAX_FLUID_SUBSTEPS = 4

const styleElement = document.createElement('style')
styleElement.textContent = `
.minimal-fluid-text-copy {
  position: absolute;
  inset: 0;
  z-index: 1;
  box-sizing: border-box;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 14px;
  padding: 80px 28px;
  text-align: center;
  color: #f3f0e8;
  pointer-events: none;
}
.minimal-fluid-text-copy p {
  margin: 0;
}
.minimal-fluid-text-kicker {
  color: #ff7a5f;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0;
  text-transform: uppercase;
}
.minimal-fluid-text-copy h2 {
  width: min(760px, 86vw);
  margin: 0;
  color: #f3f0e8;
  font-size: clamp(52px, 10vw, 116px);
  font-weight: 820;
  line-height: 0.88;
  letter-spacing: 0;
  text-wrap: balance;
}
.minimal-fluid-text-lead {
  width: min(560px, 76vw);
  color: rgba(243, 240, 232, 0.72);
  font-size: clamp(16px, 2vw, 22px);
  line-height: 1.42;
  letter-spacing: 0;
}
.minimal-fluid-text-copy.is-synced .minimal-fluid-text-kicker,
.minimal-fluid-text-copy.is-synced h2,
.minimal-fluid-text-copy.is-synced .minimal-fluid-text-lead {
  color: transparent;
  -webkit-text-fill-color: transparent;
}
@media (max-width: 720px) {
  .minimal-fluid-text-copy {
    gap: 12px;
    padding-inline: 22px;
  }
  .minimal-fluid-text-copy h2 {
    width: min(520px, 92vw);
    font-size: clamp(48px, 16vw, 82px);
  }
  .minimal-fluid-text-lead {
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
textRoot.className = 'minimal-fluid-text-copy'
textRoot.innerHTML = `
  <p class="minimal-fluid-text-kicker">THREE-FLUID-FX</p>
  <h2>Fluid Text</h2>
  <p class="minimal-fluid-text-lead">Live type, bent by fluid.</p>
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

const textElements = Array.from(
  textRoot.querySelectorAll<HTMLElement>(
    '.minimal-fluid-text-kicker, h2, .minimal-fluid-text-lead',
  ),
)
if (textElements.length !== 3) throw new Error('Fluid text DOM source is incomplete')

const textPlane = new DomTextPlane(stage, textElements)
scene.add(textPlane.mesh)

const fluid = new FluidSimulation(renderer, {
  profile: 'balanced',
  splatRadius: 0.0014,
  splatForce: 7,
  pressureIterations: 10,
  curlStrength: 0.18,
  velocityDissipation: 0.99,
  densityDissipation: 0.94,
  dyeDissipation: 0.965,
  reflectWalls: false,
})
fluid.enableDye = true

const detachPointerSplats = attachPointerSplats(renderer.domElement, fluid, {
  coloredStrokes: true,
})

const scenePass = pass(scene, camera)
const distortionIntensity = uniform(0.45)
const overlayIntensity = uniform(0.85)
const overlayOpacity = uniform(0.5)
const elapsedTime = uniform(0)
const cursorColor = uniform(new Color(0.85, 0.95, 1))
const vibrance = uniform(0.5)
const pipeline = new RenderPipeline(renderer)

setPipelineOutput(
  pipeline,
  fluidOverlay(
    'artInk',
    simpleDistortion(asNode(scenePass), asNode(fluid.densityNode), asNode(distortionIntensity)),
    asNode(fluid.densityNode),
    asNode(fluid.dyeNode),
    asNode(fluid.velocityNode),
    {
      intensity: asNode(overlayIntensity),
      opacity: asNode(overlayOpacity),
      time: asNode(elapsedTime),
      cursorColor: asNode(cursorColor),
      vibrance: asNode(vibrance),
    },
  ),
)

function getWorldViewport(): { width: number; height: number } {
  const height = 2 * CAMERA_Z * Math.tan((CAMERA_FOV * Math.PI) / 360)
  return {
    height,
    width: height * camera.aspect,
  }
}

function syncTextCopy(): void {
  const viewport = getWorldViewport()
  textPlane.sync(viewport.width, viewport.height)
  textRoot.classList.add('is-synced')
}

const resize = (): void => {
  const width = Math.max(1, stage.clientWidth)
  const height = Math.max(1, stage.clientHeight)

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  fluid.resize(width, height)
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
  asTsl<UniformValue<number>>(elapsedTime).value = clock.getElapsed()

  fluidAccumulator += frameDt
  let substeps = 0
  while (fluidAccumulator >= FIXED_FLUID_DT && substeps < MAX_FLUID_SUBSTEPS) {
    fluid.step(FIXED_FLUID_DT)
    fluidAccumulator -= FIXED_FLUID_DT
    substeps += 1
  }
  if (substeps === MAX_FLUID_SUBSTEPS) fluidAccumulator = 0

  pipeline.render()
})

window.addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null)
  window.removeEventListener('resize', resize)
  window.visualViewport?.removeEventListener('resize', resize)
  detachPointerSplats()
  textPlane.dispose()
  fluid.dispose()
  pipeline.dispose()
  renderer.dispose()
  renderer.domElement.remove()
  textRoot.remove()
  styleElement.remove()
})
