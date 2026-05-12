import { NodeUpdateType, TempNode, Vector2, type TextureNode } from 'three/webgpu'
import {
  convertToTexture,
  Fn,
  nodeObject,
  uniform,
  uv as uvFn,
  vec2,
  vec4,
} from 'three/tsl'
import type { Node, NodeBuilder, NodeFrame } from 'three/webgpu'

/**
 * Iridescent chromatic-distortion effect — each RGB channel is offset by a
 * different combination of fluid-velocity components, producing the oil-slick
 * spectral spread seen in the GLSL `ChromaticDistortionPass`.
 *
 * **Sampling pattern (matches the GLSL pass):**
 * 1. 5-tap box blur of the fluid texture (RG=velocity, B=density). Raw
 *    velocity is choppy across vortex-cell boundaries; the blur hides them.
 * 2. Density^1.2 falloff so the effect blends into untouched regions instead
 *    of clipping at a hard mask edge.
 * 3. Per-channel UV offsets: red gets `(+chroma.x, +chroma.y)`,
 *    green `(-chroma.x, +chroma.y)`, blue `(-chroma.x, -chroma.y)`.
 *
 * Internal `*Node` class; the public API is the {@link chromaticDistortion}
 * factory function that mirrors the three.js TSL convention
 * (`bloom()`, `dotScreen()`, `chromaticAberration()`).
 */
// `any`-typing the chained TSL nodes is intentional: the `@types/three` proxy
// types for `Node` carry strict element-type generics that turn every chained
// `.mul/.add/.sub` into a separate cast site. The runtime objects are dynamic
// regardless, so we keep the signatures honest at the public boundary
// (`chromaticDistortion`) and drop into `any` inside the shader-graph body.
// This mirrors how the upstream three.js TSL examples are authored in JS.
export class ChromaticDistortionNode extends TempNode {
  static get type(): string {
    return 'ChromaticDistortionNode'
  }

  readonly sceneTexture: TextureNode
  readonly fluidTexture: TextureNode
  readonly intensityNode: Node

  // Inverse-size uniform — `1 / fluidWidth, 1 / fluidHeight` in pixels. Updated
  // every frame because the fluid FBO can resize on canvas-size changes.
  private readonly _invSize = uniform(new Vector2())

  constructor(sceneTexture: TextureNode, fluidTexture: TextureNode, intensityNode: Node) {
    super('vec4')
    this.sceneTexture = sceneTexture
    this.fluidTexture = fluidTexture
    this.intensityNode = intensityNode
    this.updateBeforeType = NodeUpdateType.FRAME
  }

  updateBefore(_frame: NodeFrame): undefined {
    const map = this.fluidTexture.value
    const w = (map?.image as { width?: number } | undefined)?.width ?? 1
    const h = (map?.image as { height?: number } | undefined)?.height ?? 1
    this._invSize.value.set(1 / w, 1 / h)
    return undefined
  }

  setup(_builder: NodeBuilder): Node {
    const sceneTex = this.sceneTexture as unknown as Any
    const fluidTex = this.fluidTexture as unknown as Any
    const sceneUv = (sceneTex.uvNode as Any) || uvFn()
    const fluidUv = (fluidTex.uvNode as Any) || uvFn()
    const invSize = this._invSize as unknown as Any
    const intensity = this.intensityNode as unknown as Any

    const apply = Fn(() => {
      const offX = vec2(invSize.x.mul(2), 0) as Any
      const offY = vec2(0, invSize.y.mul(2)) as Any

      // 5-tap blur, weights 0.36 + 4×0.16 = 1.0.
      const center = fluidTex.sample(fluidUv).rgb.mul(0.36) as Any
      const blurred = center
        .add(fluidTex.sample(fluidUv.add(offX)).rgb.mul(0.16))
        .add(fluidTex.sample(fluidUv.sub(offX)).rgb.mul(0.16))
        .add(fluidTex.sample(fluidUv.add(offY)).rgb.mul(0.16))
        .add(fluidTex.sample(fluidUv.sub(offY)).rgb.mul(0.16))

      const vel = blurred.xy
      const density = blurred.z.clamp(0, 1)
      const falloff = density.pow(1.2)

      const chroma = vel.mul(0.003).mul(intensity).mul(falloff)
      const distUv = sceneUv.sub(vel.mul(0.0002).mul(intensity).mul(falloff))

      const r = sceneTex.sample(distUv.add(vec2(chroma.x, chroma.y))).r
      const g = sceneTex.sample(distUv.add(vec2(chroma.x.negate(), chroma.y))).g
      const b = sceneTex.sample(distUv.add(vec2(chroma.x.negate(), chroma.y.negate()))).b

      return vec4(r, g, b, 1)
    }) as () => Node

    return apply()
  }
}

// Local alias — TSL's runtime types are dynamic (proxy-based); using `any`
// inside this file's shader-graph body is the same trade-off the three.js
// upstream examples make. Keep `Any` confined to this module.
type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Apply the iridescent chromatic distortion to `sceneNode`, driven by the
 * `fluidNode` velocity/density texture.
 *
 * @param sceneNode The scene/colour input — the texture being distorted.
 * @param fluidNode Fluid output texture (`.rg` = velocity, `.b` = density).
 * @param intensity Scalar gain on the chroma offset; defaults to 1.
 *
 * @example
 * ```ts
 * import { chromaticDistortion } from 'three-fluid-fx/tsl'
 * const out = chromaticDistortion(scenePassTexture, fluid.densityNode, 0.7)
 * pipeline.outputNode = out
 * ```
 */
export const chromaticDistortion = (
  sceneNode: Node,
  fluidNode: Node,
  intensity: number | Node = 1,
): Node =>
  nodeObject(
    new ChromaticDistortionNode(
      convertToTexture(sceneNode as Any),
      convertToTexture(fluidNode as Any),
      nodeObject(intensity as Any) as Node,
    ) as Any,
  ) as Node
