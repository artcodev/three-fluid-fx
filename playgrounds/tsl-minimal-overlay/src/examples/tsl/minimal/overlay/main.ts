import '../../../../styles.css'
import { BoxGeometry, Color, Mesh, PerspectiveCamera, Scene, SRGBColorSpace, Timer } from 'three'
import { MeshNormalNodeMaterial, RenderPipeline, WebGPURenderer } from 'three/webgpu'
import { pass, uniform } from 'three/tsl'
import { attachPointerSplats, FluidSimulation, glazeOverlay } from 'three-fluid-fx/tsl'
import { asNode, setPipelineOutput } from '../../shared/nodeInterop'

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage')

if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
  stage.textContent =
    'WebGPU is not available in this browser. The TSL example needs a WebGPU-capable browser.'
  throw new Error('WebGPU unavailable')
}

const DEFAULTS = {
  splatRadius: 0.001,
  splatForce: 6,
  reflectWalls: false,
}

const renderer = new WebGPURenderer({ antialias: true, forceWebGL: false })
renderer.outputColorSpace = SRGBColorSpace
renderer.setClearColor(new Color('#07080b'), 1)
renderer.domElement.style.position = 'absolute'
renderer.domElement.style.inset = '0'
stage.appendChild(renderer.domElement)

await renderer.init()

const scene = new Scene()
const camera = new PerspectiveCamera(45, 1, 0.1, 100)
camera.position.set(0, 0, 4)

const cube = new Mesh(new BoxGeometry(1.4, 1.4, 1.4), new MeshNormalNodeMaterial())
scene.add(cube)

const fluid = new FluidSimulation(renderer, DEFAULTS)
attachPointerSplats(renderer.domElement, fluid)

const scenePass = pass(scene, camera)
const intensity = uniform(1)
const opacity = uniform(1)
const pipeline = new RenderPipeline(renderer)
setPipelineOutput(
  pipeline,
  glazeOverlay(
    asNode(scenePass),
    asNode(fluid.densityNode),
    asNode(fluid.dyeNode),
    asNode(fluid.velocityNode),
    { intensity: asNode(intensity), opacity: asNode(opacity) },
  ),
)

const resize = (): void => {
  const w = Math.max(1, stage.clientWidth)
  const h = Math.max(1, stage.clientHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  fluid.resize(w, h)
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

  cube.rotation.x += frameDt * 0.35
  cube.rotation.y += frameDt * 0.5

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
  cube.geometry.dispose()
  cube.material.dispose()
  fluid.dispose()
  renderer.dispose()
  renderer.domElement.remove()
})
