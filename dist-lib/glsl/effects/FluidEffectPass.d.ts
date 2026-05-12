import { ShaderMaterial, Uniform, type WebGLRenderer, WebGLRenderTarget } from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
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
export declare abstract class FluidEffectPass extends Pass {
    /**
     * Final visibility of this pass over its input. Unlike per-effect
     * `intensity`, this is a pure post-composite alpha: 0 returns the original
     * input, 1 returns the effect output unchanged.
     */
    opacity: number;
    /** The pass's shader material — uniforms exposed for direct tweaking
     *  (animations, tooling) without subclassing. Read-only reference; the
     *  uniforms inside it are the actual mutable state. */
    readonly material: ShaderMaterial;
    private readonly fsQuad;
    private readonly opacityMaterial;
    private readonly opacityQuad;
    private readonly opacityTarget;
    /**
     * @param fragmentShader GLSL fragment-shader source. Reads `tDiffuse`
     *   (input from previous pass) and any custom uniforms.
     * @param uniforms       Uniform records used by the fragment shader.
     * @param options        Material flags. `toneMapped` defaults to `false`
     *   (tone mapping is expected to happen in the chain's final `OutputPass`,
     *   not per-effect).
     */
    constructor(fragmentShader: string, uniforms: Record<string, Uniform<unknown>>, options?: {
        toneMapped?: boolean;
    });
    /** Called every frame before the draw — set per-frame uniforms here. */
    protected abstract updateUniforms(readBuffer: WebGLRenderTarget): void;
    /** Override to react to viewport changes — typically updates `uTexel`. */
    setSize(_width: number, _height: number): void;
    render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, _deltaTime: number, _maskActive: boolean): void;
    dispose(): void;
}
