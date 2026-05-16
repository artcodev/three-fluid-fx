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
import { WebGPURenderer } from 'three/webgpu'
import { attachPointerSplats, FluidSimulation } from 'three-fluid-fx/tsl'
import { SCALE } from '../../../extras/controls/paramRanges'
import {
  createWGSLFlowParticles,
  type ParticleMode,
} from '../../../extras/particles/tsl/WGSLFlowParticles'
import { resolveProfile } from '../../../extras/resolveProfile'

interface MinimalParticlesConfig {
  mode: ParticleMode
  particleSize: number
  cameraZ: number
  pointSize: number
  rotationSpeed: number
  curlStrength: number
  flowStrength: number
  depthLift: number
  flowThreshold: number
  maxFlowSpeed: number
  perpendicularAngle: number
  sideVariation: number
  depthAttenuationScale: number
}

const FIXED_FLUID_DT = 1 / 60
const MAX_FLUID_SUBSTEPS = 4

export async function runMinimalParticles(config: MinimalParticlesConfig): Promise<void> {
  const stage = document.getElementById('stage')
  if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage element')

  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    stage.textContent =
      'WebGPU is not available in this browser. The TSL example needs a WebGPU-capable browser.'
    throw new Error('WebGPU unavailable')
  }

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
  camera.position.set(0, 0, config.cameraZ)
  camera.updateMatrixWorld(true)

  const profile = resolveProfile('balanced')
  const fluid = new FluidSimulation(renderer, {
    profile,
    splatRadius: 10 * SCALE.splatRadius,
    splatForce: 6,
    pressureIterations: 8,
    curlStrength: config.curlStrength,
    velocityDissipation: 0.992,
    densityDissipation: 0.9,
    pressureDissipation: 0.8,
    enableVorticity: false,
    bfecc: true,
    reflectWalls: true,
  })
  attachPointerSplats(renderer.domElement, fluid)

  const particles = createWGSLFlowParticles(renderer, {
    mode: config.mode,
    size: config.particleSize,
  })
  scene.add(particles.mesh)

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
  let fluidAccumulator = 0

  renderer.setAnimationLoop(() => {
    clock.update()
    const frameDt = Math.min(Math.max(clock.getDelta(), 1e-6), FIXED_FLUID_DT * MAX_FLUID_SUBSTEPS)

    spinAngle += config.rotationSpeed * frameDt
    if (config.mode === 'plane2d') {
      particles.mesh.rotation.z = spinAngle
    } else {
      particles.mesh.rotation.y = spinAngle
    }
    particles.mesh.updateMatrixWorld(true)
    modelRotation.setFromMatrix4(particles.mesh.matrixWorld)

    fluidAccumulator += frameDt
    let substeps = 0
    while (fluidAccumulator >= FIXED_FLUID_DT && substeps < MAX_FLUID_SUBSTEPS) {
      fluid.step(FIXED_FLUID_DT)
      fluidAccumulator -= FIXED_FLUID_DT
      substeps += 1
    }
    if (substeps === MAX_FLUID_SUBSTEPS) fluidAccumulator = 0

    camera.updateMatrixWorld()
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0)
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1)
    particles.step({
      dt: frameDt,
      velocityField: fluid.velocityTexture,
      viewMatrix: camera.matrixWorldInverse,
      projectionMatrix: camera.projectionMatrix,
      cameraRight,
      cameraUp,
      modelRotation,
      pointSize: config.pointSize,
      spring: 4,
      zeta: 1.15,
      dragLin: 0.28,
      dragQuad: 0.05,
      aMax: 24,
      vMaxScale: 1,
      flowStrength: config.flowStrength,
      depthLift: config.depthLift,
      flowThreshold: config.flowThreshold * SCALE.flowThreshold,
      maxFlowSpeed: config.maxFlowSpeed,
      responseGamma: 4,
      perpendicularAngle: config.perpendicularAngle,
      sideVariation: config.sideVariation,
      depthAttenuationScale: config.depthAttenuationScale,
    })

    renderer.render(scene, camera)
  })

  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null)
    window.removeEventListener('resize', resize)
    scene.remove(particles.mesh)
    particles.dispose()
    fluid.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  })
}
