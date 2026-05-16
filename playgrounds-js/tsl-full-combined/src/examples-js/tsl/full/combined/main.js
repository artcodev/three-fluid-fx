import '../../../../styles.css'
import {
  ACESFilmicToneMapping,
  Color,
  Matrix3,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector2,
  Vector3,
} from 'three'
import { RenderPipeline, WebGPURenderer } from 'three/webgpu'
import { pass, uniform } from 'three/tsl'
import {
  attachPointerSplats,
  chromaticDistortion,
  FluidSimulation,
  fluidOverlay,
  rgbShiftDistortion,
  simpleDistortion,
  waterCausticsDistortion,
  waterDistortion,
} from 'three-fluid-fx/tsl'
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
import { asNode, asTsl, setPipelineOutput } from '../../shared/nodeInterop'
const OVERLAY_OPTIONS = {
  Default: 'default',
  'Volume Cursor': 'volumeCursor',
  Trail: 'trail',
  Oil: 'oil',
  Velocity: 'velocity',
  Colorful: 'colorful',
  'Rainbow Fish': 'rainbowFish',
  Glaze: 'glaze',
  Burn: 'burn',
  Smoke: 'smoke',
  'Art Ink': 'artInk',
  'Rainbow Ink': 'rainbowInk',
  'Color Water': 'colorWater',
  'Liquid Lens': 'liquidLens',
}
const DISTORTION_OPTIONS = {
  Simple: 'simple',
  'RGB Shift': 'rgbShift',
  Chromatic: 'chromatic',
  Water: 'water',
  'Water + Caustics': 'waterCaustics',
}
const OVERLAY_STYLE_DEFAULTS = {
  default: { intensity: 0.85, velocityScale: 1 },
  volumeCursor: { intensity: 0.85, velocityScale: 1 },
  trail: { intensity: 1.2, velocityScale: 1 },
  oil: { intensity: 1.15, velocityScale: 1 },
  velocity: { intensity: 0.25, velocityScale: 0.55 },
  colorful: { intensity: 1.0, velocityScale: 1 },
  rainbowFish: { intensity: 0.6, velocityScale: 0.3 },
  glaze: { intensity: 0.9, velocityScale: 1 },
  burn: { intensity: 1.15, velocityScale: 1 },
  smoke: { intensity: 0.85, velocityScale: 1 },
  artInk: { intensity: 0.85, velocityScale: 1 },
  rainbowInk: { intensity: 0.85, velocityScale: 1 },
  colorWater: { intensity: 1.05, velocityScale: 1 },
  liquidLens: { intensity: 0.9, velocityScale: 1 },
}
const DEFAULTS = {
  particlesEnabled: true,
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
  enableVorticity: true,
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
  spring: 4,
  zeta: 1.15,
  dragLin: 0.28,
  dragQuad: 0.05,
  aMax: 24,
  vMaxScale: 1,
  pointSize: 10,
  rotationSpeed: 0.07,
  overlayStyle: 'default',
  overlayIntensity: OVERLAY_STYLE_DEFAULTS.default.intensity,
  overlayOpacity: 1,
  overlayVelocityScale: OVERLAY_STYLE_DEFAULTS.default.velocityScale,
  cursorColor: { r: 0.85, g: 0.95, b: 1 },
  vibrance: 0.12,
  liquidColor: { r: 0.85, g: 0.25, b: 1 },
  distortionStyle: 'simple',
  distortionIntensity: 0.45,
}
const FIXED_FLUID_DT = 1 / 60
const MAX_FLUID_SUBSTEPS = 4
const stage = document.getElementById('stage')
if (!(stage instanceof HTMLElement)) throw new Error('Missing #stage element')
if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
  stage.textContent =
    'WebGPU is not available in this browser. The TSL example needs a WebGPU-capable browser.'
  throw new Error('WebGPU unavailable')
}
const params = {
  ...DEFAULTS,
  cursorColor: { ...DEFAULTS.cursorColor },
  liquidColor: { ...DEFAULTS.liquidColor },
}
const demo = setupDemoReel('TSL Combined Demo')
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
camera.position.set(0, 0, 6.4)
camera.updateMatrixWorld(true)
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
const particles = createWGSLFlowParticles(renderer, {
  mode: 'cloud3d',
  size: 64,
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
function buildDistortion(style, sceneNode) {
  const fluidNode = asNode(fluid.densityNode)
  const i = asNode(distortionIntensity)
  const t = asNode(elapsedTime)
  switch (style) {
    case 'simple':
      return simpleDistortion(sceneNode, fluidNode, i)
    case 'rgbShift':
      return rgbShiftDistortion(sceneNode, fluidNode, i)
    case 'chromatic':
      return chromaticDistortion(sceneNode, fluidNode, i)
    case 'water':
      return waterDistortion(sceneNode, fluidNode, i)
    case 'waterCaustics':
      return waterCausticsDistortion(sceneNode, fluidNode, i, t)
  }
}
function buildOverlay(style, sceneNode) {
  return fluidOverlay(
    style,
    sceneNode,
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
function buildOutput() {
  let output = asNode(scenePass)
  if (params.distortionEnabled) {
    output = buildDistortion(params.distortionStyle, output)
  }
  if (params.overlayEnabled) {
    output = buildOverlay(params.overlayStyle, output)
  }
  return output
}
const pipeline = new RenderPipeline(renderer)
function setOutput() {
  setPipelineOutput(pipeline, buildOutput())
}
setOutput()
const usesCursorColor = (style) =>
  style === 'trail' || style === 'default' || style === 'volumeCursor'
const usesVibrance = (style) => style !== 'smoke' && style !== 'velocity'
const usesVelocityScale = (style) => style === 'velocity' || style === 'rainbowFish'
let overlayVelocityScaleBinding
let cursorColorBinding
let vibranceBinding
let liquidColorBinding
function syncOverlayBindingVisibility() {
  if (overlayVelocityScaleBinding) {
    overlayVelocityScaleBinding.hidden = !usesVelocityScale(params.overlayStyle)
  }
  if (cursorColorBinding) {
    cursorColorBinding.hidden = !usesCursorColor(params.overlayStyle)
  }
  if (vibranceBinding) {
    vibranceBinding.hidden = !usesVibrance(params.overlayStyle)
  }
  if (liquidColorBinding) {
    liquidColorBinding.hidden = params.overlayStyle !== 'liquidLens'
  }
}
const controls = createControlsPane('TSL · Combined Demo', params, (pane, p) => {
  const layers = pane.addFolder({ title: 'Layers' })
  layers.addBinding(p, 'particlesEnabled', { label: 'particles' })
  layers.addBinding(p, 'overlayEnabled', { label: 'overlay' }).on('change', () => {
    setOutput()
  })
  layers.addBinding(p, 'distortionEnabled', { label: 'distortion' }).on('change', () => {
    setOutput()
  })
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
  const influence = pane.addFolder({ title: 'Particle influence', expanded: false })
  influence.addBinding(p, 'flowStrength', { ...RANGES.flowStrength, label: 'flow' })
  influence.addBinding(p, 'depthLift', { ...RANGES.depthLift, label: '3D lift' })
  influence.addBinding(p, 'flowThreshold', { ...RANGES.flowThreshold, label: 'thresh' })
  influence.addBinding(p, 'maxFlowSpeed', { ...RANGES.maxFlowSpeed, label: 'max speed' })
  influence.addBinding(p, 'responseGamma', { ...RANGES.responseGamma, label: 'response' })
  influence.addBinding(p, 'depthAttenuationScale', {
    ...RANGES.depthAttenuationScale,
    label: 'depth scale',
  })
  influence.addBinding(p, 'perpendicularAngle', {
    ...RANGES.perpendicularAngle,
    label: 'perp angle',
  })
  influence.addBinding(p, 'sideVariation', { ...RANGES.sideVariation, label: 'side var' })
  const physics = pane.addFolder({ title: 'Particle physics', expanded: false })
  physics.addBinding(p, 'spring', { ...RANGES.spring, label: 'spring' })
  physics.addBinding(p, 'zeta', { ...RANGES.zeta, label: 'damping' })
  physics.addBinding(p, 'dragLin', { ...RANGES.dragLin, label: 'drag lin' })
  physics.addBinding(p, 'dragQuad', { ...RANGES.dragQuad, label: 'drag quad' })
  physics.addBinding(p, 'aMax', { ...RANGES.aMax, label: 'a max' })
  physics.addBinding(p, 'vMaxScale', { ...RANGES.vMaxScale, label: 'v max' })
  const particlesFolder = pane.addFolder({ title: 'Particle render', expanded: false })
  particlesFolder.addBinding(p, 'pointSize', { ...RANGES.pointSize, label: 'point size' })
  particlesFolder.addBinding(p, 'rotationSpeed', { ...RANGES.rotationSpeed, label: 'spin' })
  const overlay = pane.addFolder({ title: 'Overlay', expanded: false })
  overlay
    .addBinding(p, 'overlayStyle', {
      label: 'style',
      options: OVERLAY_OPTIONS,
    })
    .on('change', () => {
      const defaults = OVERLAY_STYLE_DEFAULTS[p.overlayStyle]
      p.overlayIntensity = defaults.intensity
      p.overlayVelocityScale = defaults.velocityScale
      syncOverlayBindingVisibility()
      pane.refresh()
      setOutput()
    })
  overlay.addBinding(p, 'overlayIntensity', {
    ...RANGES.intensity,
    max: 3,
    label: 'intensity',
  })
  overlay.addBinding(p, 'overlayOpacity', {
    ...RANGES.opacity,
    label: 'opacity',
  })
  overlayVelocityScaleBinding = overlay.addBinding(p, 'overlayVelocityScale', {
    label: 'velocity scale',
    min: 0.05,
    max: 2,
    step: 0.01,
  })
  cursorColorBinding = overlay.addBinding(p, 'cursorColor', {
    label: 'cursor color',
    color: { type: 'float' },
  })
  vibranceBinding = overlay.addBinding(p, 'vibrance', {
    label: 'vibrance',
    min: 0,
    max: 1,
    step: 0.01,
  })
  liquidColorBinding = overlay.addBinding(p, 'liquidColor', {
    label: 'liquid color',
    color: { type: 'float' },
  })
  const distortion = pane.addFolder({ title: 'Distortion', expanded: false })
  distortion
    .addBinding(p, 'distortionStyle', {
      label: 'style',
      options: DISTORTION_OPTIONS,
    })
    .on('change', () => {
      setOutput()
    })
  distortion.addBinding(p, 'distortionIntensity', {
    ...RANGES.intensity,
    max: 3,
    label: 'intensity',
  })
  syncOverlayBindingVisibility()
})
const liquidLensColorize = (dx, dy) => {
  if (!controls.params.overlayEnabled || controls.params.overlayStyle !== 'liquidLens') {
    return undefined
  }
  const lc = controls.params.liquidColor
  const sx = Math.min(Math.abs(dx) / 25, 1)
  const sy = Math.min(Math.abs(dy) / 25, 1)
  const speed = Math.hypot(sx, sy)
  const base = 0.4 + speed * 0.6
  return [(lc.r * base + sx * 0.5) * 0.3, lc.g * base * 0.3, (lc.b * base + sy * 0.5) * 0.3]
}
const detachPointerSplats = demo.enabled
  ? attachDemoManualTakeover(demo, renderer.domElement, () =>
      attachPointerSplats(renderer.domElement, fluid, {
        coloredStrokes: true,
        colorize: liquidLensColorize,
      }),
    )
  : attachPointerSplats(renderer.domElement, fluid, {
      coloredStrokes: true,
      colorize: liquidLensColorize,
    })
const driveDemoSplats = createDemoSplatDriver(fluid, { colorize: liquidLensColorize })
function syncParams() {
  const p = controls.params
  particles.mesh.visible = p.particlesEnabled
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
  asTsl(overlayIntensity).value = p.overlayIntensity
  asTsl(overlayOpacity).value = p.overlayOpacity
  asTsl(overlayVelocityScale).value = p.overlayVelocityScale
  asTsl(distortionIntensity).value = p.distortionIntensity
  asTsl(vibrance).value = p.vibrance
  asTsl(cursorColor).value.setRGB(p.cursorColor.r, p.cursorColor.g, p.cursorColor.b)
}
function syncDyeTexel() {
  const img = fluid.dyeTexture.image
  const w = img.width ?? 512
  const h = img.height ?? 512
  asTsl(dyeTexel).value.set(1 / w, 1 / h)
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
  syncDyeTexel()
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
  asTsl(elapsedTime).value = elapsed
  spinAngle += p.rotationSpeed * frameDt
  particles.mesh.rotation.y = spinAngle
  particles.mesh.updateMatrixWorld(true)
  modelRotation.setFromMatrix4(particles.mesh.matrixWorld)
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
  if (p.particlesEnabled) {
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
      depthLift: p.depthLift,
      flowThreshold: p.flowThreshold * SCALE.flowThreshold,
      maxFlowSpeed: p.maxFlowSpeed,
      responseGamma: p.responseGamma,
      perpendicularAngle: p.perpendicularAngle,
      sideVariation: p.sideVariation,
      depthAttenuationScale: p.depthAttenuationScale,
    })
  }
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
