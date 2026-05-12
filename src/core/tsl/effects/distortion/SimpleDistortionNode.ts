import { TempNode, type TextureNode } from 'three/webgpu'
import { convertToTexture, Fn, nodeObject, uv as uvFn } from 'three/tsl'
import type { Node, NodeBuilder } from 'three/webgpu'

/**
 * Plain UV warp by velocity — no chromatic split, single texture lookup.
 * The cheapest of the distortion family; baseline reference for the others.
 *
 * Mirrors `SimpleDistortionPass` (GLSL) sampling exactly: `uv = vUv - vel *
 * intensity * 0.0003`, clamped to `[0, 1]`.
 */
type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

export class SimpleDistortionNode extends TempNode {
  static get type(): string {
    return 'SimpleDistortionNode'
  }

  readonly sceneTexture: TextureNode
  readonly fluidTexture: TextureNode
  readonly intensityNode: Node

  constructor(sceneTexture: TextureNode, fluidTexture: TextureNode, intensityNode: Node) {
    super('vec4')
    this.sceneTexture = sceneTexture
    this.fluidTexture = fluidTexture
    this.intensityNode = intensityNode
  }

  setup(_builder: NodeBuilder): Node {
    const sceneTex = this.sceneTexture as unknown as Any
    const fluidTex = this.fluidTexture as unknown as Any
    const sceneUv = (sceneTex.uvNode as Any) || uvFn()
    const fluidUv = (fluidTex.uvNode as Any) || uvFn()
    const intensity = this.intensityNode as unknown as Any

    const apply = Fn(() => {
      const vel = fluidTex.sample(fluidUv).rg
      const distUv = sceneUv.sub(vel.mul(intensity).mul(0.0003)).clamp(0, 1)
      return sceneTex.sample(distUv)
    }) as () => Node

    return apply()
  }
}

/**
 * Apply a plain velocity-driven UV warp to `sceneNode`. Cheapest distortion
 * variant; matches `SimpleDistortionPass` from the GLSL pipeline.
 *
 * @param sceneNode The scene/colour input being distorted.
 * @param fluidNode Fluid texture (`.rg` = velocity).
 * @param intensity Scalar gain on the warp; defaults to 1.
 */
export const simpleDistortion = (
  sceneNode: Node,
  fluidNode: Node,
  intensity: number | Node = 1,
): Node =>
  nodeObject(
    new SimpleDistortionNode(
      convertToTexture(sceneNode as Any),
      convertToTexture(fluidNode as Any),
      nodeObject(intensity as Any) as Node,
    ) as Any,
  ) as Node
