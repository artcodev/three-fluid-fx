import { TempNode, type TextureNode } from 'three/webgpu'
import { convertToTexture, float, Fn, nodeObject, uv as uvFn, vec3, vec4 } from 'three/tsl'
import type { Node, NodeBuilder } from 'three/webgpu'

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

export interface DensityTintOverlayOptions {
  /** Density-to-tint multiplier. Defaults to the GLSL pass value. */
  intensity?: number | Node
  /** RGB tint added proportionally to fluid density. Defaults to teal. */
  tint?: Node
}

const toNode = (value: unknown, fallback: Any): Node =>
  nodeObject((value ?? fallback) as Any) as Node

/**
 * Subtle additive tint by fluid density. TSL counterpart of the GLSL
 * `DensityTintOverlayPass`: `scene += tint * density.b * intensity`.
 */
export class DensityTintOverlayNode extends TempNode {
  static get type(): string {
    return 'DensityTintOverlayNode'
  }

  readonly sceneTexture: TextureNode
  readonly fluidTexture: TextureNode
  readonly intensityNode: Node
  readonly tintNode: Node

  constructor(
    sceneTexture: TextureNode,
    fluidTexture: TextureNode,
    intensityNode: Node,
    tintNode: Node,
  ) {
    super('vec4')
    this.sceneTexture = sceneTexture
    this.fluidTexture = fluidTexture
    this.intensityNode = intensityNode
    this.tintNode = tintNode
  }

  setup(_builder: NodeBuilder): Node {
    const sceneTex = this.sceneTexture as unknown as Any
    const fluidTex = this.fluidTexture as unknown as Any
    const sceneUv = (sceneTex.uvNode as Any) || uvFn()
    const fluidUv = (fluidTex.uvNode as Any) || uvFn()
    const intensity = this.intensityNode as unknown as Any
    const tint = this.tintNode as unknown as Any

    const apply = Fn(() => {
      const scene = sceneTex.sample(sceneUv).rgb
      const density = fluidTex.sample(fluidUv).b.clamp(0, 1)
      return vec4(scene.add(tint.mul(density).mul(intensity)), 1)
    }) as () => Node

    return apply()
  }
}

export const densityTintOverlay = (
  sceneNode: Node,
  fluidNode: Node,
  options: DensityTintOverlayOptions = {},
): Node =>
  nodeObject(
    new DensityTintOverlayNode(
      convertToTexture(sceneNode as Any),
      convertToTexture(fluidNode as Any),
      toNode(options.intensity, float(0.14)),
      toNode(options.tint, vec3(0.10, 0.42, 0.36)),
    ) as Any,
  ) as Node
