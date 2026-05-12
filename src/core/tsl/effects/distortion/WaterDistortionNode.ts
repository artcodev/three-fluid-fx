import { NodeUpdateType, TempNode, Vector2, type TextureNode } from 'three/webgpu'
import { convertToTexture, Fn, nodeObject, uniform, uv as uvFn, vec2, vec4 } from 'three/tsl'
import type { Node, NodeBuilder, NodeFrame } from 'three/webgpu'

/**
 * Refraction through density-as-height: density gradient bends UVs with a
 * per-channel Snell split — R refracts ~5% less than B — so flat regions stay
 * sharp and active flow refracts like ripples on a pool. Mirrors
 * `WaterDistortionPass` (GLSL): 4-tap density gradient → fake normal,
 * `offset = normal * intensity * 0.6`, channel multipliers `0.95 / 1.0 / 1.05`.
 */
type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

export class WaterDistortionNode extends TempNode {
  static get type(): string {
    return 'WaterDistortionNode'
  }

  readonly sceneTexture: TextureNode
  readonly fluidTexture: TextureNode
  readonly intensityNode: Node

  // `1 / fluidWidth, 1 / fluidHeight` — refreshed each frame because the
  // fluid FBO can resize on canvas changes.
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

      const hL = fluidTex.sample(fluidUv.sub(offX)).b
      const hR = fluidTex.sample(fluidUv.add(offX)).b
      const hD = fluidTex.sample(fluidUv.sub(offY)).b
      const hU = fluidTex.sample(fluidUv.add(offY)).b
      const normal = vec2(hR.sub(hL), hU.sub(hD)) as Any

      const offset = normal.mul(intensity).mul(0.6)
      const r = sceneTex.sample(sceneUv.add(offset.mul(0.95))).r
      const g = sceneTex.sample(sceneUv.add(offset)).g
      const b = sceneTex.sample(sceneUv.add(offset.mul(1.05))).b

      return vec4(r, g, b, 1)
    }) as () => Node

    return apply()
  }
}

/**
 * Refract `sceneNode` through density-as-height with a per-channel Snell
 * split. Matches `WaterDistortionPass` from the GLSL pipeline.
 *
 * @param sceneNode The scene/colour input being refracted.
 * @param fluidNode Fluid texture (`.b` = density used as height field).
 * @param intensity Scalar gain on the refraction; defaults to 1.
 */
export const waterDistortion = (
  sceneNode: Node,
  fluidNode: Node,
  intensity: number | Node = 1,
): Node =>
  nodeObject(
    new WaterDistortionNode(
      convertToTexture(sceneNode as Any),
      convertToTexture(fluidNode as Any),
      nodeObject(intensity as Any) as Node,
    ) as Any,
  ) as Node
