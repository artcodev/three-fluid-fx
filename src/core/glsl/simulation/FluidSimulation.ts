import {
  AddEquation,
  BufferGeometry,
  ClampToEdgeWrapping,
  CustomBlending,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  OneFactor,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Uint16BufferAttribute,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import type { Texture } from 'three'
import {
  ADVECT_FRAGMENT,
  CLEAR_FRAGMENT,
  CURL_FRAGMENT,
  DIVERGENCE_FRAGMENT,
  GRADIENT_SUBTRACT_FRAGMENT,
  PRESSURE_FRAGMENT,
  SIM_VERTEX,
  SPLAT_FRAGMENT,
  SPLAT_VERTEX,
  VORTICITY_FRAGMENT,
} from './shaders'

interface DoubleFBO {
  read: WebGLRenderTarget
  write: WebGLRenderTarget
}

/**
 * Resolution & quality presets. Pick `performance` for weak GPUs / mobile,
 * `balanced` for typical desktop, `quality` for high-end / presentation.
 *
 *   performance: 128² sim / 256² dye / 6  Jacobi iters  → cheapest, slightly grainy
 *   balanced:    256² sim / 512² dye / 12 Jacobi iters  → default
 *   quality:     384² sim / 1024² dye / 20 Jacobi iters  → cleanest, ~6× cost vs perf
 *
 * Individual options on `FluidSimulationOptions` always override profile values.
 */
export const FLUID_PROFILES = {
  performance: { simResolution: 128, dyeResolution: 256, pressureIterations: 6 },
  balanced: { simResolution: 256, dyeResolution: 512, pressureIterations: 12 },
  quality: { simResolution: 384, dyeResolution: 1024, pressureIterations: 20 },
} as const

export type FluidProfile = keyof typeof FLUID_PROFILES

export interface FluidSimulationOptions {
  /** Resolution & iterations preset. Default `balanced`. */
  profile?: FluidProfile
  simResolution?: number
  dyeResolution?: number
  pressureIterations?: number
  densityDissipation?: number
  velocityDissipation?: number
  pressureDissipation?: number
  curlStrength?: number
  splatRadius?: number
  splatForce?: number
  baseDelta?: number
  /**
   * Per-step decay for the optional dye FBO. Falls back to `densityDissipation`
   * when not set — they share the same semantics, but giving dye its own
   * slider lets a watercolour-style overlay keep long colour trails while the
   * physics-driving density field dissipates faster.
   */
  dyeDissipation?: number
  /** Vorticity confinement (Fedkiw 2001). Default false — softer FluidCursor-style waves. */
  enableVorticity?: boolean
  /** BFECC advection (Back and Forth Error Compensation). Sharper, ~5× cost in advect. Default true. */
  bfecc?: boolean
  /**
   * No-flow-through-walls (reflection) boundary in the divergence pass.
   * Default true — flow bounces off screen edges (PavelDoGreat behaviour).
   * Set false for "open" boundaries where flow leaves the screen and doesn't
   * come back (FluidCursor / mofu behaviour).
   */
  reflectWalls?: boolean
}

export interface FluidSplatOptions {
  radius?: number
  color?: [number, number, number]
  /**
   * Per-stroke dye colour (RGB, additive). When provided AND `enableDye`
   * is true, the splat also writes this colour into the separate dye FBO,
   * which is advected by velocity and exposed via `dyeTexture`. Use for
   * PavelDoGreat-style coloured strokes; leave undefined for ordinary use.
   */
  dyeColor?: [number, number, number]
}

interface QueuedSplat {
  x: number
  y: number
  dx: number
  dy: number
  radius: number
  color?: [number, number, number]
  dyeColor?: [number, number, number]
}

function makeTarget(width: number, height: number, linear: boolean): WebGLRenderTarget {
  const filter = linear ? LinearFilter : NearestFilter
  return new WebGLRenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
    format: RGBAFormat,
    type: HalfFloatType,
    minFilter: filter,
    magFilter: filter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    generateMipmaps: false,
  })
}

function makeDoubleFBO(width: number, height: number, linear: boolean): DoubleFBO {
  return {
    read: makeTarget(width, height, linear),
    write: makeTarget(width, height, linear),
  }
}

function swap(target: DoubleFBO): void {
  const read = target.read
  target.read = target.write
  target.write = read
}

function disposeDouble(target: DoubleFBO): void {
  target.read.dispose()
  target.write.dispose()
}

export class FluidSimulation {
  readonly simResolution: number
  readonly dyeResolution: number

  pressureIterations: number
  densityDissipation: number
  velocityDissipation: number
  pressureDissipation: number
  curlStrength: number
  splatRadius: number
  splatForce: number
  baseDelta: number
  enableVorticity: boolean
  bfecc: boolean
  reflectWalls: boolean

  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly geometry = new BufferGeometry()
  private readonly mesh: Mesh
  private readonly splatScene = new Scene()
  private readonly splatGeometry = new BufferGeometry()
  private readonly splatMesh: Mesh

  private readonly velocity: DoubleFBO
  private readonly density: DoubleFBO
  private readonly dye: DoubleFBO
  private readonly pressure: DoubleFBO
  private readonly divergence: WebGLRenderTarget
  private readonly curl: WebGLRenderTarget

  /**
   * Toggle the optional dye channel — a separate RGB FBO advected by velocity.
   * Off by default to keep ordinary examples free of the extra advect pass.
   * Turn on when using `addSplat({ dyeColor })` and `dyeTexture`.
   */
  enableDye = false
  /** Per-step decay of the dye FBO. Mirrors `densityDissipation` semantics. */
  dyeDissipation: number

  private readonly clearMaterial: ShaderMaterial
  private readonly splatMaterial: ShaderMaterial
  private readonly curlMaterial: ShaderMaterial
  private readonly vorticityMaterial: ShaderMaterial
  private readonly divergenceMaterial: ShaderMaterial
  private readonly pressureMaterial: ShaderMaterial
  private readonly gradientSubtractMaterial: ShaderMaterial
  private readonly advectVelocityMaterial: ShaderMaterial
  private readonly advectDensityMaterial: ShaderMaterial
  private readonly advectDyeMaterial: ShaderMaterial

  private readonly splats: QueuedSplat[] = []
  private viewportWidth = 1
  private viewportHeight = 1
  // FBO dimensions adapt to viewport aspect on resize so the velocity field
  // is stored in screen-aligned cells. Otherwise a square FBO stretched onto
  // a wide viewport gives non-uniform metric — vec2(dx, dy) sampled as colour
  // would visually rotate/skew.
  private simWidth: number
  private simHeight: number
  private dyeWidth: number
  private dyeHeight: number

  constructor(renderer: WebGLRenderer, options: FluidSimulationOptions = {}) {
    this.renderer = renderer
    const profile = FLUID_PROFILES[options.profile ?? 'balanced']
    this.simResolution = options.simResolution ?? profile.simResolution
    this.dyeResolution = options.dyeResolution ?? profile.dyeResolution
    this.pressureIterations = options.pressureIterations ?? profile.pressureIterations
    this.densityDissipation = options.densityDissipation ?? 0.91
    this.velocityDissipation = options.velocityDissipation ?? 0.985
    this.pressureDissipation = options.pressureDissipation ?? 0.8
    this.curlStrength = options.curlStrength ?? 0.55
    this.splatRadius = options.splatRadius ?? 0.00042
    this.splatForce = options.splatForce ?? 6
    this.baseDelta = options.baseDelta ?? 1 / 60
    this.enableVorticity = options.enableVorticity ?? false
    this.bfecc = options.bfecc ?? true
    this.reflectWalls = options.reflectWalls ?? true

    this.geometry.setAttribute(
      'position',
      new Float32BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    )
    this.mesh = new Mesh(this.geometry, undefined)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)

    this.splatGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]),
        3,
      ),
    )
    this.splatGeometry.setIndex(new Uint16BufferAttribute(new Uint16Array([0, 1, 2, 1, 3, 2]), 1))
    this.splatMesh = new Mesh(this.splatGeometry, undefined)
    this.splatMesh.frustumCulled = false
    this.splatScene.add(this.splatMesh)

    // Initial baseline — square FBOs sized at the profile resolution.
    // resize() will reshape them to the viewport aspect on the first call.
    this.simWidth = this.simResolution
    this.simHeight = this.simResolution
    this.dyeWidth = this.dyeResolution
    this.dyeHeight = this.dyeResolution

    this.velocity = makeDoubleFBO(this.simWidth, this.simHeight, true)
    this.density = makeDoubleFBO(this.dyeWidth, this.dyeHeight, true)
    this.dye = makeDoubleFBO(this.dyeWidth, this.dyeHeight, true)
    this.pressure = makeDoubleFBO(this.simWidth, this.simHeight, false)
    this.dyeDissipation = options.dyeDissipation ?? this.densityDissipation
    this.divergence = makeTarget(this.simWidth, this.simHeight, false)
    this.curl = makeTarget(this.simWidth, this.simHeight, false)

    const simTexel = new Vector2(1 / this.simWidth, 1 / this.simHeight)
    const dyeTexel = new Vector2(1 / this.dyeWidth, 1 / this.dyeHeight)

    this.clearMaterial = this.createMaterial(CLEAR_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uTexture: { value: null },
      value: { value: this.pressureDissipation },
    })
    this.splatMaterial = new ShaderMaterial({
      vertexShader: SPLAT_VERTEX,
      fragmentShader: SPLAT_FRAGMENT,
      uniforms: {
        uCenter: { value: new Vector2() },
        uScale: { value: new Vector2() },
        color: { value: new Vector3() },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneFactor,
    })
    this.splatMesh.material = this.splatMaterial
    this.curlMaterial = this.createMaterial(CURL_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uVelocity: { value: null },
    })
    this.vorticityMaterial = this.createMaterial(VORTICITY_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uVelocity: { value: null },
      uCurl: { value: null },
      curl: { value: this.curlStrength },
      dt: { value: 0.016 },
    })
    this.divergenceMaterial = this.createMaterial(DIVERGENCE_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uVelocity: { value: null },
      uReflectWalls: { value: 1 },
    })
    this.pressureMaterial = this.createMaterial(PRESSURE_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uPressure: { value: null },
      uDivergence: { value: null },
    })
    this.gradientSubtractMaterial = this.createMaterial(GRADIENT_SUBTRACT_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uPressure: { value: null },
      uVelocity: { value: null },
    })
    this.advectVelocityMaterial = this.createMaterial(ADVECT_FRAGMENT, {
      texelSize: { value: simTexel.clone() },
      uVelocity: { value: null },
      uSource: { value: null },
      dt: { value: 0.016 },
      dissipation: { value: 1 },
      uBFECC: { value: 0 },
    })
    this.advectDensityMaterial = this.createMaterial(ADVECT_FRAGMENT, {
      texelSize: { value: dyeTexel.clone() },
      uVelocity: { value: null },
      uSource: { value: null },
      dt: { value: 0.016 },
      dissipation: { value: 1 },
      uBFECC: { value: 0 },
    })
    this.advectDyeMaterial = this.createMaterial(ADVECT_FRAGMENT, {
      texelSize: { value: dyeTexel.clone() },
      uVelocity: { value: null },
      uSource: { value: null },
      dt: { value: 0.016 },
      dissipation: { value: 1 },
      uBFECC: { value: 0 },
    })
  }

  /**
   * Velocity field after the full step (post-advection). This is the value
   * that drives subsequent simulation; use it for particle systems and any
   * downstream physics.
   */
  get velocityTexture(): Texture {
    return this.velocity.read.texture
  }

  /**
   * Velocity field after pressure projection but **before self-advection** —
   * the divergence-free snapshot. This is what FluidCursor / mofu's color.frag
   * reads as `vel_0`. Use for visualisation when you want a "cleaner" field
   * (less self-mixing, sharper edges).
   *
   * Internally this is `velocity.write.texture` after step(): the velocity
   * pipeline has three ping-pong swaps (vorticity → grad-subtract → advect),
   * which leaves the pre-advect snapshot in the write buffer at the end.
   */
  get velocityProjectedTexture(): Texture {
    return this.velocity.write.texture
  }

  get densityTexture(): Texture {
    return this.density.read.texture
  }

  /**
   * Advected per-stroke dye field. RGB stores the colour written by splats
   * with `dyeColor`. Only updated when `enableDye` is on.
   */
  get dyeTexture(): Texture {
    return this.dye.read.texture
  }

  resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width)
    this.viewportHeight = Math.max(1, height)
    const aspect = this.viewportWidth / this.viewportHeight

    // Pick FBO dimensions whose aspect matches the viewport. The longer side
    // gets `resolution`, the shorter side is scaled down proportionally.
    let newSimW: number
    let newSimH: number
    let newDyeW: number
    let newDyeH: number
    if (aspect >= 1) {
      newSimW = this.simResolution
      newSimH = Math.max(1, Math.round(this.simResolution / aspect))
      newDyeW = this.dyeResolution
      newDyeH = Math.max(1, Math.round(this.dyeResolution / aspect))
    } else {
      newSimW = Math.max(1, Math.round(this.simResolution * aspect))
      newSimH = this.simResolution
      newDyeW = Math.max(1, Math.round(this.dyeResolution * aspect))
      newDyeH = this.dyeResolution
    }

    if (newSimW !== this.simWidth || newSimH !== this.simHeight) {
      this.simWidth = newSimW
      this.simHeight = newSimH
      this.velocity.read.setSize(newSimW, newSimH)
      this.velocity.write.setSize(newSimW, newSimH)
      this.pressure.read.setSize(newSimW, newSimH)
      this.pressure.write.setSize(newSimW, newSimH)
      this.divergence.setSize(newSimW, newSimH)
      this.curl.setSize(newSimW, newSimH)
      const tx = 1 / newSimW
      const ty = 1 / newSimH
      this.clearMaterial.uniforms.texelSize.value.set(tx, ty)
      this.curlMaterial.uniforms.texelSize.value.set(tx, ty)
      this.vorticityMaterial.uniforms.texelSize.value.set(tx, ty)
      this.divergenceMaterial.uniforms.texelSize.value.set(tx, ty)
      this.pressureMaterial.uniforms.texelSize.value.set(tx, ty)
      this.gradientSubtractMaterial.uniforms.texelSize.value.set(tx, ty)
      this.advectVelocityMaterial.uniforms.texelSize.value.set(tx, ty)
    }

    if (newDyeW !== this.dyeWidth || newDyeH !== this.dyeHeight) {
      this.dyeWidth = newDyeW
      this.dyeHeight = newDyeH
      this.density.read.setSize(newDyeW, newDyeH)
      this.density.write.setSize(newDyeW, newDyeH)
      this.dye.read.setSize(newDyeW, newDyeH)
      this.dye.write.setSize(newDyeW, newDyeH)
      const tx = 1 / newDyeW
      const ty = 1 / newDyeH
      this.advectDensityMaterial.uniforms.texelSize.value.set(tx, ty)
      this.advectDyeMaterial.uniforms.texelSize.value.set(tx, ty)
    }
  }

  addSplat(x: number, y: number, dx: number, dy: number, options: FluidSplatOptions = {}): void {
    this.splats.push({
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      dx,
      dy,
      radius: options.radius ?? this.splatRadius,
      color: options.color,
      dyeColor: options.dyeColor,
    })
  }

  step(deltaSeconds: number): void {
    const dt = Math.min(Math.max(deltaSeconds, 1e-6), 1 / 60)
    const dtScale = this.baseDelta > 0 ? dt / this.baseDelta : 1
    const previousTarget = this.renderer.getRenderTarget()
    const previousAutoClear = this.renderer.autoClear
    // Splat passes render a localised quad and rely on the existing FBO
    // contents being preserved outside the quad. autoClear would wipe them.
    // For the rest of the pipeline a fullscreen tri overwrites every pixel,
    // so a no-op clear is fine too — disable globally for the whole step.
    this.renderer.autoClear = false

    this.vorticityMaterial.uniforms.curl.value = this.curlStrength
    const bfecc = this.bfecc ? 1 : 0
    this.advectVelocityMaterial.uniforms.uBFECC.value = bfecc
    this.advectDensityMaterial.uniforms.uBFECC.value = bfecc

    for (let i = 0; i < this.splats.length; i += 1) {
      this.applySplat(this.splats[i])
    }
    this.splats.length = 0

    if (this.enableVorticity) {
      this.curlMaterial.uniforms.uVelocity.value = this.velocity.read.texture
      this.blit(this.curl, this.curlMaterial)

      this.vorticityMaterial.uniforms.uVelocity.value = this.velocity.read.texture
      this.vorticityMaterial.uniforms.uCurl.value = this.curl.texture
      this.vorticityMaterial.uniforms.dt.value = dt
      this.blit(this.velocity.write, this.vorticityMaterial)
      swap(this.velocity)
    }

    this.divergenceMaterial.uniforms.uVelocity.value = this.velocity.read.texture
    this.divergenceMaterial.uniforms.uReflectWalls.value = this.reflectWalls ? 1 : 0
    this.blit(this.divergence, this.divergenceMaterial)

    this.clearMaterial.uniforms.uTexture.value = this.pressure.read.texture
    this.clearMaterial.uniforms.value.value = Math.pow(this.pressureDissipation, dtScale)
    this.blit(this.pressure.write, this.clearMaterial)
    swap(this.pressure)

    this.pressureMaterial.uniforms.uDivergence.value = this.divergence.texture
    for (let i = 0; i < this.pressureIterations; i += 1) {
      this.pressureMaterial.uniforms.uPressure.value = this.pressure.read.texture
      this.blit(this.pressure.write, this.pressureMaterial)
      swap(this.pressure)
    }

    this.gradientSubtractMaterial.uniforms.uPressure.value = this.pressure.read.texture
    this.gradientSubtractMaterial.uniforms.uVelocity.value = this.velocity.read.texture
    this.blit(this.velocity.write, this.gradientSubtractMaterial)
    swap(this.velocity)

    this.advectVelocityMaterial.uniforms.uVelocity.value = this.velocity.read.texture
    this.advectVelocityMaterial.uniforms.uSource.value = this.velocity.read.texture
    this.advectVelocityMaterial.uniforms.dissipation.value = Math.pow(this.velocityDissipation, dtScale)
    this.advectVelocityMaterial.uniforms.dt.value = dt
    this.blit(this.velocity.write, this.advectVelocityMaterial)
    swap(this.velocity)

    this.advectDensityMaterial.uniforms.uVelocity.value = this.velocity.read.texture
    this.advectDensityMaterial.uniforms.uSource.value = this.density.read.texture
    this.advectDensityMaterial.uniforms.dissipation.value = Math.pow(this.densityDissipation, dtScale)
    this.advectDensityMaterial.uniforms.dt.value = dt
    this.blit(this.density.write, this.advectDensityMaterial)
    swap(this.density)

    if (this.enableDye) {
      this.advectDyeMaterial.uniforms.uBFECC.value = bfecc
      this.advectDyeMaterial.uniforms.uVelocity.value = this.velocity.read.texture
      this.advectDyeMaterial.uniforms.uSource.value = this.dye.read.texture
      this.advectDyeMaterial.uniforms.dissipation.value = Math.pow(this.dyeDissipation, dtScale)
      this.advectDyeMaterial.uniforms.dt.value = dt
      this.blit(this.dye.write, this.advectDyeMaterial)
      swap(this.dye)
    }

    this.renderer.setRenderTarget(previousTarget)
    this.renderer.autoClear = previousAutoClear
  }

  dispose(): void {
    this.scene.remove(this.mesh)
    this.splatScene.remove(this.splatMesh)
    this.geometry.dispose()
    this.splatGeometry.dispose()
    this.clearMaterial.dispose()
    this.splatMaterial.dispose()
    this.curlMaterial.dispose()
    this.vorticityMaterial.dispose()
    this.divergenceMaterial.dispose()
    this.pressureMaterial.dispose()
    this.gradientSubtractMaterial.dispose()
    this.advectVelocityMaterial.dispose()
    this.advectDensityMaterial.dispose()
    this.advectDyeMaterial.dispose()
    disposeDouble(this.velocity)
    disposeDouble(this.density)
    disposeDouble(this.dye)
    disposeDouble(this.pressure)
    this.divergence.dispose()
    this.curl.dispose()
  }

  private createMaterial(
    fragmentShader: string,
    uniforms: ShaderMaterial['uniforms'],
  ): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: SIM_VERTEX,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
  }

  private blit(target: WebGLRenderTarget, material: ShaderMaterial): void {
    this.mesh.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(null)
  }

  private applySplat(splat: QueuedSplat): void {
    const aspect = this.viewportWidth / this.viewportHeight
    const color = splat.color ?? [splat.dx, splat.dy, 1]
    // splat.radius matches the legacy "exp(-p²/r)" falloff. The quad's local
    // coordinate is in [-1, 1] (so the corner has |p|² = 2). We pick
    // halfSize = 3 * sqrt(r) — at the edge of the visible disc the value
    // is exp(-9) ≈ 1.2e-4, i.e. invisible. uFalloff = halfSize²/r = 9 keeps
    // the perceived shape identical to the old fullscreen Gaussian.
    const halfSize = 3 * Math.sqrt(splat.radius)
    const u = this.splatMaterial.uniforms
    u.uCenter.value.set(splat.x * 2 - 1, splat.y * 2 - 1)
    u.uScale.value.set(halfSize / aspect, halfSize)
    u.color.value.set(color[0], color[1], color[2])

    // Additive blending writes splat into the live read FBO directly — no
    // swap, no read-in-shader, only a tiny quad's worth of fragments.
    this.renderer.setRenderTarget(this.velocity.read)
    this.renderer.render(this.splatScene, this.camera)
    this.renderer.setRenderTarget(this.density.read)
    this.renderer.render(this.splatScene, this.camera)

    if (this.enableDye && splat.dyeColor) {
      u.color.value.set(splat.dyeColor[0], splat.dyeColor[1], splat.dyeColor[2])
      this.renderer.setRenderTarget(this.dye.read)
      this.renderer.render(this.splatScene, this.camera)
    }
  }
}
