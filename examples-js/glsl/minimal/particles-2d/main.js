import '../../../../src/styles.css'
import { Color, Matrix3, PerspectiveCamera, Scene, Timer, Vector3, WebGLRenderer } from 'three'
import { attachPointerSplats, FluidSimulation } from 'three-fluid-fx'
import { createFlowParticles } from '../../../extras/particles/glsl/flowParticles'
// All knobs in one place. Fluid solver fields go to FluidSimulation;
// the rest are particle-system parameters consumed by particles.step().
const DEFAULTS = {
  // Fluid solver
  splatRadius: 0.001,
  splatForce: 6,
  reflectWalls: false,
  // Field → particle response
  flowStrength: 1.2,
  depthLift: 0,
  flowThreshold: 0.02,
  maxFlowSpeed: 12,
  responseGamma: 2,
  perpendicularAngle: 0,
  sideVariation: 0,
  depthAttenuationScale: 1,
  // Particle physics
  spring: 2.1,
  zeta: 1.15,
  dragLin: 0.28,
  dragQuad: 0.05,
  aMax: 24,
  vMaxScale: 1,
  // Render
  pointSize: 6,
}
const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage')
const renderer = new WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setClearColor(new Color('#07080b'), 1)
stage.appendChild(renderer.domElement)
const scene = new Scene()
const camera = new PerspectiveCamera(45, 1, 0.1, 100)
camera.position.set(0, 0, 5.2)
// Fluid solver — produces velocityTexture every frame.
const fluid = new FluidSimulation(renderer, {
  splatRadius: DEFAULTS.splatRadius,
  splatForce: DEFAULTS.splatForce,
  reflectWalls: DEFAULTS.reflectWalls,
})
attachPointerSplats(renderer.domElement, fluid)
// Example GPGPU particle system that samples a velocity texture per-particle
// in screen space. The implementation lives in src/shared/flowParticles.ts —
// it is NOT part of the published library, just a demo of "what you do with
// a velocity field" once you have one.
const particles = createFlowParticles(renderer, { mode: 'plane2d', size: 80 })
scene.add(particles.points)
const cameraRight = new Vector3(1, 0, 0)
const cameraUp = new Vector3(0, 1, 0)
const identityRotation = new Matrix3()
const resize = () => {
  const w = Math.max(1, stage.clientWidth)
  const h = Math.max(1, stage.clientHeight)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  fluid.resize(w, h)
}
resize()
window.addEventListener('resize', resize)
const clock = new Timer()
renderer.setAnimationLoop(() => {
  clock.update()
  const dt = Math.min(Math.max(clock.getDelta(), 1e-6), 1 / 30)
  const fluidDt = Math.min(dt, 1 / 60)
  fluid.step(fluidDt)
  cameraRight.setFromMatrixColumn(camera.matrixWorld, 0)
  cameraUp.setFromMatrixColumn(camera.matrixWorld, 1)
  particles.step({
    ...DEFAULTS,
    dt,
    dpr: renderer.getPixelRatio(),
    velocityField: fluid.velocityTexture,
    viewMatrix: camera.matrixWorldInverse,
    projectionMatrix: camera.projectionMatrix,
    cameraRight,
    cameraUp,
    modelRotation: identityRotation,
  })
  renderer.render(scene, camera)
})
