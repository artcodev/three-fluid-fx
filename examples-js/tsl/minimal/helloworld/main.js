import '../../../../src/styles.css'
import { Color, SRGBColorSpace, Timer } from 'three'
import { RenderPipeline, WebGPURenderer } from 'three/webgpu'
import { vec4 } from 'three/tsl'
import { attachPointerSplats, FluidSimulation } from 'three-fluid-fx/tsl'
import { asTsl, setPipelineOutput } from '../../shared/nodeInterop'
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
const renderer = new WebGPURenderer({
  antialias: true,
  alpha: true,
  forceWebGL: false,
})
renderer.outputColorSpace = SRGBColorSpace
renderer.setClearColor(new Color('#000000'), 0)
renderer.domElement.style.position = 'absolute'
renderer.domElement.style.inset = '0'
stage.appendChild(renderer.domElement)
await renderer.init()
const fluid = new FluidSimulation(renderer, DEFAULTS)
attachPointerSplats(renderer.domElement, fluid)
const pipeline = new RenderPipeline(renderer)
const density = asTsl(fluid.densityNode)
setPipelineOutput(pipeline, vec4(density.rgb, density.b.mul(2).clamp(0, 1)))
const resize = () => {
  const w = Math.max(1, stage.clientWidth)
  const h = Math.max(1, stage.clientHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(w, h, false)
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
  fluid.dispose()
  renderer.dispose()
  renderer.domElement.remove()
})
