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
import { pass, uniform, vec3 } from 'three/tsl'
import {
  WGSLFluidSimulation,
  attachPointerSplats,
  fluidOverlay,
  simpleDistortion,
} from '../../core/tsl/index'
import { SCALE } from '../../../examples/extras/controls/paramRanges'
import { Backdrop } from '../../../examples/extras/backgrounds/tsl/Backdrop'
import { HeroTextSync } from './HeroTextSync'
import { HeroMorphParticles } from './HeroMorphParticles'

type TslAny = any // eslint-disable-line @typescript-eslint/no-explicit-any

const CAMERA_FOV = 45
const CAMERA_Z = 6.4
const FIXED_FLUID_DT = 1 / 60
const MAX_FLUID_SUBSTEPS = 4

const HERO_PARAMS = {
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
  rotationSpeed: 0.08,
}

export class HeroDemo {
  private readonly container: HTMLElement
  private readonly heroSection: HTMLElement
  private readonly renderer: WebGPURenderer
  private readonly scene: Scene
  private readonly camera: PerspectiveCamera
  private readonly pipeline: RenderPipeline
  private readonly timer = new Timer()
  private readonly overlayTime = uniform(0)
  private readonly cameraRight = new Vector3()
  private readonly cameraUp = new Vector3()
  private readonly modelRotation = new Matrix3()
  private readonly onResizeBound = (): void => this.queueResize()
  private readonly onAnimationFrameBound = (): void => this.animate()
  private readonly resizeObserver: ResizeObserver
  private fluid?: WGSLFluidSimulation
  private backdrop?: Backdrop
  private textSync?: HeroTextSync
  private particles?: HeroMorphParticles
  private detachPointerSplats?: () => void
  private fluidAccumulator = 0
  private spinAngle = 0
  private resizeFrame = 0
  private textResyncFrame = 0
  private disposed = false

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator
  }

  constructor(container: HTMLElement) {
    this.container = container
    const heroSection = this.container.closest('.examples-hero')
    if (!(heroSection instanceof HTMLElement)) {
      throw new Error('HeroDemo requires a parent .examples-hero element')
    }
    this.heroSection = heroSection

    this.renderer = new WebGPURenderer({ alpha: true, antialias: true, forceWebGL: false })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.setClearColor(new Color(0x000000), 0)
    this.renderer.domElement.className = 'hero-demo-canvas'
    this.container.appendChild(this.renderer.domElement)

    this.scene = new Scene()
    this.camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100)
    this.camera.position.set(0, 0, CAMERA_Z)
    this.camera.updateMatrixWorld(true)
    this.pipeline = new RenderPipeline(this.renderer)
    this.resizeObserver = new ResizeObserver(this.onResizeBound)
  }

  async init(): Promise<void> {
    if (!HeroDemo.isSupported()) return

    await this.renderer.init()

    this.fluid = new WGSLFluidSimulation(this.renderer, {
      profile: 'balanced',
      splatRadius: HERO_PARAMS.splatRadius * SCALE.splatRadius,
      splatForce: HERO_PARAMS.splatForce,
      densityDissipation: HERO_PARAMS.densityDissipation,
      dyeDissipation: HERO_PARAMS.dyeDissipation,
      velocityDissipation: HERO_PARAMS.velocityDissipation,
      pressureDissipation: HERO_PARAMS.pressureDissipation,
      pressureIterations: HERO_PARAMS.pressureIterations,
      curlStrength: HERO_PARAMS.curlStrength,
      enableVorticity: HERO_PARAMS.enableVorticity,
      bfecc: HERO_PARAMS.bfecc,
      reflectWalls: HERO_PARAMS.reflectWalls,
    })
    this.fluid.enableDye = true

    this.backdrop = new Backdrop(this.camera, 'dark')
    this.scene.add(this.backdrop.mesh)

    this.textSync = new HeroTextSync(this.container, this.heroSection, this.scene)
    this.particles = new HeroMorphParticles(this.renderer, 64)
    this.scene.add(this.particles.mesh)

    this.setupPostProcessing()

    this.detachPointerSplats = attachPointerSplats(this.heroSection, this.fluid, {
      coloredStrokes: true,
    })
    window.addEventListener('resize', this.onResizeBound)
    window.visualViewport?.addEventListener('resize', this.onResizeBound)
    if ('fonts' in document) {
      document.fonts.addEventListener('loadingdone', this.onResizeBound)
    }
    this.resizeObserver.observe(this.heroSection)
    this.resizeObserver.observe(this.container)
    for (const element of this.textSync.elements) {
      this.resizeObserver.observe(element)
    }
    const copy = this.heroSection.querySelector('.examples-hero-copy')
    if (copy instanceof HTMLElement) this.resizeObserver.observe(copy)
    const copyInner = this.heroSection.querySelector('.examples-hero-copy-inner')
    if (copyInner instanceof HTMLElement) this.resizeObserver.observe(copyInner)
    this.onResize()
    this.renderer.setAnimationLoop(this.onAnimationFrameBound)

    const viewport = this.getWorldViewport()
    void this.textSync.sync(viewport.width, viewport.height).then(() => {
      if (!this.disposed) this.heroSection.classList.add('is-webgpu-ready')
    })
  }

  private setupPostProcessing(): void {
    if (!this.fluid) return

    const scenePass = pass(this.scene, this.camera)
    const distortedScene = simpleDistortion(
      scenePass as TslAny,
      this.fluid.densityNode as TslAny,
      0.45,
    )

    this.pipeline.outputNode = fluidOverlay(
      'artInk',
      distortedScene as TslAny,
      this.fluid.densityNode as TslAny,
      this.fluid.dyeNode as TslAny,
      this.fluid.velocityNode as TslAny,
      {
        intensity: 0.85,
        opacity: 0.5,
        time: this.overlayTime as TslAny,
        cursorColor: vec3(0.85, 0.95, 1.0) as TslAny,
        vibrance: 0.5,
        velocityScale: 1,
      },
    )
    this.pipeline.needsUpdate = true
  }

  private onResize(): void {
    if (!this.fluid || !this.textSync || !this.particles || this.disposed) return

    const width = Math.max(1, Math.round(this.container.clientWidth))
    const height = Math.max(1, Math.round(this.container.clientHeight))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(width, height, false)

    this.camera.aspect = width / height
    this.camera.fov = CAMERA_FOV
    this.camera.position.set(0, 0, CAMERA_Z)
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld(true)

    this.fluid.resize(width, height)
    this.backdrop?.update(0, this.overlayTime.value)

    const viewport = this.getWorldViewport()
    void this.textSync.sync(viewport.width, viewport.height)
    this.layoutParticles(viewport)
    this.queueTextResync()
  }

  private queueResize(): void {
    if (this.disposed || this.resizeFrame !== 0) return

    this.resizeFrame = window.requestAnimationFrame(() => {
      this.resizeFrame = 0
      this.onResize()
    })
  }

  private queueTextResync(): void {
    if (this.disposed || this.textResyncFrame !== 0) return

    this.textResyncFrame = window.requestAnimationFrame(() => {
      this.textResyncFrame = 0
      if (!this.fluid || !this.textSync || this.disposed) return

      const viewport = this.getWorldViewport()
      void this.textSync.sync(viewport.width, viewport.height)
    })
  }

  private animate(): void {
    if (!this.fluid || !this.particles || this.disposed) return

    this.timer.update()
    const frameDt = Math.min(
      Math.max(this.timer.getDelta(), 1e-6),
      FIXED_FLUID_DT * MAX_FLUID_SUBSTEPS,
    )
    this.overlayTime.value += frameDt
    this.backdrop?.update(frameDt, this.overlayTime.value)

    this.spinAngle += HERO_PARAMS.rotationSpeed * frameDt
    this.particles.mesh.rotation.y = this.spinAngle
    this.particles.mesh.updateMatrixWorld(true)
    this.modelRotation.setFromMatrix4(this.particles.mesh.matrixWorld)

    this.fluidAccumulator += frameDt
    let substeps = 0
    while (this.fluidAccumulator >= FIXED_FLUID_DT && substeps < MAX_FLUID_SUBSTEPS) {
      this.fluid.step(FIXED_FLUID_DT)
      this.fluidAccumulator -= FIXED_FLUID_DT
      substeps += 1
    }
    if (substeps === MAX_FLUID_SUBSTEPS) this.fluidAccumulator = 0

    this.camera.updateMatrixWorld()
    this.cameraRight.setFromMatrixColumn(this.camera.matrixWorld, 0)
    this.cameraUp.setFromMatrixColumn(this.camera.matrixWorld, 1)
    this.particles.step(
      {
        dt: frameDt,
        velocityField: this.fluid.velocityTexture,
        viewMatrix: this.camera.matrixWorldInverse,
        projectionMatrix: this.camera.projectionMatrix,
        modelMatrix: this.particles.mesh.matrixWorld,
        cameraRight: this.cameraRight,
        cameraUp: this.cameraUp,
        modelRotation: this.modelRotation,
        pointSize: HERO_PARAMS.pointSize,
        spring: HERO_PARAMS.spring,
        zeta: HERO_PARAMS.zeta,
        dragLin: HERO_PARAMS.dragLin,
        dragQuad: HERO_PARAMS.dragQuad,
        aMax: HERO_PARAMS.aMax,
        vMaxScale: HERO_PARAMS.vMaxScale,
        flowStrength: HERO_PARAMS.flowStrength,
        depthLift: HERO_PARAMS.depthLift,
        flowThreshold: HERO_PARAMS.flowThreshold * SCALE.flowThreshold,
        maxFlowSpeed: HERO_PARAMS.maxFlowSpeed,
        responseGamma: HERO_PARAMS.responseGamma,
        perpendicularAngle: HERO_PARAMS.perpendicularAngle,
        sideVariation: HERO_PARAMS.sideVariation,
        depthAttenuationScale: HERO_PARAMS.depthAttenuationScale,
      },
      this.overlayTime.value,
    )

    this.pipeline.render()
  }

  private getWorldViewport(): { width: number; height: number } {
    const height = 2 * CAMERA_Z * Math.tan((CAMERA_FOV * Math.PI) / 360)
    return {
      height,
      width: height * this.camera.aspect,
    }
  }

  private layoutParticles(viewport: { width: number; height: number }): void {
    if (!this.particles) return

    const copyLayer = this.heroSection.querySelector('.examples-hero-copy')
    const copy =
      this.heroSection.querySelector('.examples-hero-copy-inner') ??
      this.heroSection.querySelector('.examples-hero-copy')
    if (!(copyLayer instanceof HTMLElement) || !(copy instanceof HTMLElement)) return

    const hostRect = this.container.getBoundingClientRect()
    const layerRect = copyLayer.getBoundingClientRect()
    const copyRect = copy.getBoundingClientRect()
    const style = window.getComputedStyle(copyLayer)
    const contentRight = layerRect.right - (parseFloat(style.paddingRight) || 0)
    const gap = Math.max(32, hostRect.width * 0.03)
    const desktopLeft = copyRect.right + gap
    const desktopWidth = contentRight - desktopLeft
    const canUseRightRail = hostRect.width >= 860 && desktopWidth >= 260

    const centerX = canUseRightRail
      ? desktopLeft + desktopWidth * 0.53
      : copyRect.left + copyRect.width * 0.68
    const centerY = canUseRightRail
      ? copyRect.top + copyRect.height * 0.46
      : copyRect.bottom + Math.max(92, (hostRect.bottom - copyRect.bottom) * 0.34)

    const worldCenter = this.clientToWorld(centerX, centerY, hostRect, viewport)
    const targetDiameter = viewport.height * (canUseRightRail ? 0.82 : 0.58)
    const particleScale = Math.min(1.28, Math.max(0.58, targetDiameter / 4))

    this.particles.mesh.position.set(worldCenter.x, worldCenter.y, 0)
    this.particles.mesh.scale.setScalar(particleScale)
  }

  private clientToWorld(
    clientX: number,
    clientY: number,
    hostRect: DOMRect,
    viewport: { width: number; height: number },
  ): { x: number; y: number } {
    const x01 = (clientX - hostRect.left) / Math.max(1, hostRect.width)
    const y01 = (clientY - hostRect.top) / Math.max(1, hostRect.height)
    return {
      x: (x01 - 0.5) * viewport.width,
      y: (0.5 - y01) * viewport.height,
    }
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.onResizeBound)
    window.visualViewport?.removeEventListener('resize', this.onResizeBound)
    if ('fonts' in document) {
      document.fonts.removeEventListener('loadingdone', this.onResizeBound)
    }
    if (this.resizeFrame !== 0) {
      window.cancelAnimationFrame(this.resizeFrame)
      this.resizeFrame = 0
    }
    if (this.textResyncFrame !== 0) {
      window.cancelAnimationFrame(this.textResyncFrame)
      this.textResyncFrame = 0
    }
    this.resizeObserver.disconnect()
    this.detachPointerSplats?.()
    this.heroSection.classList.remove('is-webgpu-ready')
    this.textSync?.dispose()
    this.particles?.dispose()
    this.backdrop?.dispose()
    this.fluid?.dispose()
    this.pipeline.dispose()
    this.renderer.dispose()
    this.container.innerHTML = ''
  }
}
