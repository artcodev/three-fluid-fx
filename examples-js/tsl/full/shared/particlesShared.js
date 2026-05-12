import '../../../../src/styles.css'
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
import { createWGSLFlowParticles } from '../../../extras/particles/tsl/WGSLFlowParticles'
import { resolveProfile } from '../../../extras/resolveProfile'
import {
  attachDemoManualTakeover,
  createDemoSplatDriver,
  setupDemoReel,
} from '../../../extras/demo/reel'
import { asNode, setPipelineOutput } from '../../shared/nodeInterop'
const FIXED_FLUID_DT = 1 / 60
const MAX_FLUID_SUBSTEPS = 4
export async function runParticlesDemo(config) {
  const stage = document.getElementById('stage')
  if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage element')
  const demo = setupDemoReel(`TSL ${config.title}`)
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
    splatRadius: config.defaults.splatRadius * SCALE.splatRadius,
    splatForce: config.defaults.splatForce,
    pressureIterations: config.defaults.pressureIterations,
    curlStrength: config.defaults.curlStrength,
    velocityDissipation: config.defaults.velocityDissipation,
    densityDissipation: config.defaults.densityDissipation,
    pressureDissipation: config.defaults.pressureDissipation,
    enableVorticity: config.defaults.enableVorticity,
    bfecc: config.defaults.bfecc,
    reflectWalls: config.defaults.reflectWalls,
  })
  const particles = createWGSLFlowParticles(renderer, {
    mode: config.mode,
    size: config.particleSize,
  })
  scene.add(particles.mesh)
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
  const controls = createControlsPane(
    `TSL · ${config.title}`,
    { ...config.defaults },
    (pane, p) => {
      const splat = pane.addFolder({ title: 'Splat' })
      splat.addBinding(p, 'splatRadius', { ...RANGES.splatRadius, label: 'radius' })
      splat.addBinding(p, 'splatForce', { ...RANGES.splatForce, label: 'force' })
      const sim = pane.addFolder({ title: 'Fluid sim' })
      sim.addBinding(p, 'pressureIterations', { ...RANGES.pressureIterations, label: 'pressure' })
      sim.addBinding(p, 'curlStrength', { ...RANGES.curlStrength, label: 'curl' })
      sim.addBinding(p, 'velocityDissipation', { ...RANGES.velocityDissipation, label: 'vel diss' })
      sim.addBinding(p, 'densityDissipation', { ...RANGES.densityDissipation, label: 'dens diss' })
      sim.addBinding(p, 'pressureDissipation', {
        ...RANGES.pressureDissipation,
        label: 'pres diss',
      })
      sim.addBinding(p, 'enableVorticity', { label: 'vorticity' })
      sim.addBinding(p, 'bfecc', { label: 'BFECC' })
      sim.addBinding(p, 'reflectWalls', { label: 'reflect walls' })
      const influence = pane.addFolder({ title: 'Influence' })
      influence.addBinding(p, 'flowStrength', { ...RANGES.flowStrength, label: 'flow' })
      if (config.mode === 'cloud3d') {
        influence.addBinding(p, 'depthLift', { ...RANGES.depthLift, label: '3D lift' })
      }
      influence.addBinding(p, 'flowThreshold', { ...RANGES.flowThreshold, label: 'thresh' })
      influence.addBinding(p, 'maxFlowSpeed', { ...RANGES.maxFlowSpeed, label: 'max speed' })
      influence.addBinding(p, 'responseGamma', { ...RANGES.responseGamma, label: 'response' })
      influence.addBinding(p, 'depthAttenuationScale', {
        ...RANGES.depthAttenuationScale,
        label: 'depth scale',
      })
      if (config.mode === 'cloud3d') {
        influence.addBinding(p, 'perpendicularAngle', {
          ...RANGES.perpendicularAngle,
          label: 'perp angle',
        })
        influence.addBinding(p, 'sideVariation', { ...RANGES.sideVariation, label: 'side var' })
      }
      const physics = pane.addFolder({ title: 'Particle physics' })
      physics.addBinding(p, 'spring', { ...RANGES.spring, label: 'spring' })
      physics.addBinding(p, 'zeta', { ...RANGES.zeta, label: 'damping' })
      physics.addBinding(p, 'dragLin', { ...RANGES.dragLin, label: 'drag lin' })
      physics.addBinding(p, 'dragQuad', { ...RANGES.dragQuad, label: 'drag quad' })
      physics.addBinding(p, 'aMax', { ...RANGES.aMax, label: 'a max' })
      physics.addBinding(p, 'vMaxScale', { ...RANGES.vMaxScale, label: 'v max' })
      const motion = pane.addFolder({ title: 'Motion' })
      motion.addBinding(p, 'rotationSpeed', { ...RANGES.rotationSpeed, label: 'spin' })
      const render = pane.addFolder({ title: 'Render' })
      render.addBinding(p, 'pointSize', { ...RANGES.pointSize, label: 'point size' })
    },
  )
  const detachPointerSplats = demo.enabled
    ? attachDemoManualTakeover(demo, renderer.domElement, () =>
        attachPointerSplats(renderer.domElement, fluid),
      )
    : attachPointerSplats(renderer.domElement, fluid)
  const driveDemoSplats = createDemoSplatDriver(fluid)
  const scenePass = pass(scene, camera)
  const pipeline = new RenderPipeline(renderer)
  setPipelineOutput(
    pipeline,
    densityTintOverlay(asNode(scenePass), asNode(fluid.densityNode), {
      tint: vec3(
        0.08,
        config.mode === 'cloud3d' ? 0.3 : 0.42,
        config.mode === 'cloud3d' ? 0.32 : 0.36,
      ),
      intensity: config.mode === 'cloud3d' ? 0.18 : 0.14,
    }),
  )
  const syncFluidParams = () => {
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
  const resize = () => {
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
    const elapsed = clock.getElapsed()
    const p = controls.params
    spinAngle += p.rotationSpeed * frameDt
    if (config.mode === 'plane2d') {
      particles.mesh.rotation.z = spinAngle
    } else {
      particles.mesh.rotation.y = spinAngle
    }
    particles.mesh.updateMatrixWorld(true)
    modelRotation.setFromMatrix4(particles.mesh.matrixWorld)
    syncFluidParams()
    if (demo.enabled) driveDemoSplats(demo.elapsed())
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
      pointSize: p.pointSize,
      spring: p.spring,
      zeta: p.zeta,
      dragLin: p.dragLin,
      dragQuad: p.dragQuad,
      aMax: p.aMax,
      vMaxScale: p.vMaxScale,
      flowStrength: p.flowStrength,
      depthLift: config.mode === 'cloud3d' ? p.depthLift : 0,
      flowThreshold: p.flowThreshold * SCALE.flowThreshold,
      maxFlowSpeed: p.maxFlowSpeed,
      responseGamma: p.responseGamma,
      perpendicularAngle: config.mode === 'cloud3d' ? p.perpendicularAngle : 0,
      sideVariation: config.mode === 'cloud3d' ? p.sideVariation : 0,
      depthAttenuationScale: p.depthAttenuationScale,
    })
    switcher.update(frameDt, elapsed)
    pipeline.render()
  })
  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null)
    window.removeEventListener('resize', resize)
    scene.remove(particles.mesh)
    particles.dispose()
    pipeline.dispose()
    detachPointerSplats?.()
    switcher.dispose()
    controls.dispose()
    fluid.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  })
}
