import '../../../../styles.css'
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
  // Field → particle response (3D mode uses depthLift + perpendicularAngle)
  flowStrength: 1.05,
  depthLift: 1.45,
  flowThreshold: 0.02,
  maxFlowSpeed: 12,
  responseGamma: 2,
  perpendicularAngle: 1.5,
  sideVariation: 1,
  depthAttenuationScale: 2,
  // Particle physics
  spring: 1.55,
  zeta: 1.15,
  dragLin: 0.28,
  dragQuad: 0.05,
  aMax: 24,
  vMaxScale: 1,
  // Render / motion
  pointSize: 10,
  rotationSpeed: 0.07,
}

const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage')

const renderer = new WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setClearColor(new Color('#07080b'), 1)
stage.appendChild(renderer.domElement)

const scene = new Scene()
const camera = new PerspectiveCamera(45, 1, 0.1, 100)
camera.position.set(0, 0, 6.4)

const fluid = new FluidSimulation(renderer, {
  splatRadius: DEFAULTS.splatRadius,
  splatForce: DEFAULTS.splatForce,
  reflectWalls: DEFAULTS.reflectWalls,
})
attachPointerSplats(renderer.domElement, fluid)

// A Fibonacci-sphere particle cloud that rotates around the Y axis.
// fluid.velocityTexture (a 2D screen-space field) is sampled per-particle
// by projecting each particle's world position into NDC.
const particles = createFlowParticles(renderer, { mode: 'cloud3d', size: 64 })
scene.add(particles.points)

const cameraRight = new Vector3(1, 0, 0)
const cameraUp = new Vector3(0, 1, 0)
const modelRotation = new Matrix3()
let spinAngle = 0

const resize = (): void => {
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

  // Rotate the points object — uModelRotation in the velocity shader
  // compensates so fluid sampling stays correct in world space.
  spinAngle += DEFAULTS.rotationSpeed * dt
  particles.points.rotation.y = spinAngle
  particles.points.updateMatrixWorld(true)
  modelRotation.setFromMatrix4(particles.points.matrixWorld)

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
    modelRotation,
  })

  renderer.render(scene, camera)
})
