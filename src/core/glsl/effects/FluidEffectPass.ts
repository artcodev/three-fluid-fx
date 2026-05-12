import { ShaderMaterial, Uniform, type Texture, type WebGLRenderer, WebGLRenderTarget } from 'three'
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

// Shared vertex shader for all fluid effect passes. Matches the convention
// used by three.js's ShaderPass: NDC plane geometry + identity orthographic
// camera, so `position` / `uv` flow straight through to clip space.
const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const OPACITY_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tBase;
uniform sampler2D tOverlay;
uniform float uOpacity;

void main() {
  vec4 base = texture2D(tBase, vUv);
  vec4 overlay = texture2D(tOverlay, vUv);
  gl_FragColor = mix(base, overlay, clamp(uOpacity, 0.0, 1.0));
}
`

/**
 * Thin base class for the post-process effects in this package. Removes ~20
 * lines of identical glue per effect file (FullScreenQuad wiring, the
 * `renderToScreen` swap, dispose) — concrete subclasses only supply their
 * fragment shader, their uniforms, and a per-frame uniform update via
 * {@link FluidEffectPass.updateUniforms}.
 *
 * Semantically this is a regular `three/addons/postprocessing/Pass` — the
 * classes can be added to an `EffectComposer` chain alongside `RenderPass`,
 * `BloomPass`, etc. We follow the standard `tDiffuse` convention for the
 * input texture (matches `ShaderPass.textureID` default), so subclasses set
 * `tDiffuse` to `readBuffer.texture` in `updateUniforms`.
 */
export abstract class FluidEffectPass extends Pass {
  /**
   * Final visibility of this pass over its input. Unlike per-effect
   * `intensity`, this is a pure post-composite alpha: 0 returns the original
   * input, 1 returns the effect output unchanged.
   */
  opacity = 1

  /** The pass's shader material — uniforms exposed for direct tweaking
   *  (animations, tooling) without subclassing. Read-only reference; the
   *  uniforms inside it are the actual mutable state. */
  readonly material: ShaderMaterial
  private readonly fsQuad: FullScreenQuad
  private readonly opacityMaterial: ShaderMaterial
  private readonly opacityQuad: FullScreenQuad
  private readonly opacityTarget: WebGLRenderTarget

  /**
   * @param fragmentShader GLSL fragment-shader source. Reads `tDiffuse`
   *   (input from previous pass) and any custom uniforms.
   * @param uniforms       Uniform records used by the fragment shader.
   * @param options        Material flags. `toneMapped` defaults to `false`
   *   (tone mapping is expected to happen in the chain's final `OutputPass`,
   *   not per-effect).
   */
  constructor(
    fragmentShader: string,
    uniforms: Record<string, Uniform<unknown>>,
    options: { toneMapped?: boolean } = {},
  ) {
    super()
    this.needsSwap = true
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: options.toneMapped ?? false,
    })
    this.fsQuad = new FullScreenQuad(this.material)
    this.opacityMaterial = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: OPACITY_FRAGMENT,
      uniforms: {
        tBase: new Uniform<Texture | null>(null),
        tOverlay: new Uniform<Texture | null>(null),
        uOpacity: new Uniform(1),
      } satisfies Record<string, Uniform<Texture | number | null>>,
      depthTest: false,
      depthWrite: false,
      toneMapped: options.toneMapped ?? false,
    })
    this.opacityQuad = new FullScreenQuad(this.opacityMaterial)
    this.opacityTarget = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      stencilBuffer: false,
    })
  }

  /** Called every frame before the draw — set per-frame uniforms here. */
  protected abstract updateUniforms(readBuffer: WebGLRenderTarget): void

  /** Override to react to viewport changes — typically updates `uTexel`. */
  override setSize(_width: number, _height: number): void {}

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    _deltaTime: number,
    _maskActive: boolean,
  ): void {
    this.updateUniforms(readBuffer)
    const target = this.renderToScreen ? null : writeBuffer

    if (this.opacity >= 0.999) {
      renderer.setRenderTarget(target)
      if (this.clear) renderer.clear()
      this.fsQuad.render(renderer)
      return
    }

    if (
      this.opacityTarget.width !== readBuffer.width ||
      this.opacityTarget.height !== readBuffer.height
    ) {
      this.opacityTarget.setSize(readBuffer.width, readBuffer.height)
    }

    renderer.setRenderTarget(this.opacityTarget)
    renderer.clear()
    this.fsQuad.render(renderer)

    const u = this.opacityMaterial.uniforms
    u.tBase.value = readBuffer.texture
    u.tOverlay.value = this.opacityTarget.texture
    u.uOpacity.value = Math.max(0, Math.min(this.opacity, 1))

    renderer.setRenderTarget(target)
    if (this.clear) renderer.clear()
    this.opacityQuad.render(renderer)
  }

  override dispose(): void {
    this.material.dispose()
    this.fsQuad.dispose()
    this.opacityMaterial.dispose()
    this.opacityQuad.dispose()
    this.opacityTarget.dispose()
  }
}
