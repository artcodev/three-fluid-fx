import { TempNode, type TextureNode } from 'three/webgpu'
import { convertToTexture, Fn, max, nodeObject, uv as uvFn, vec4 } from 'three/tsl'
import type { Node, NodeBuilder } from 'three/webgpu'

/**
 * Density-driven chromatic R/B split along the *normalised* flow direction;
 * G channel stays put. Mirrors `RGBShiftDistortionPass` (GLSL) exactly:
 * - direction = `vel / max(length(vel), 1e-4)` to avoid mixing magnitude noise
 *   into the offset (which would produce stripes inside vortex regions),
 * - magnitude = `density^1.4 * intensity * 0.012` to keep flat regions sharp.
 */
type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

export class RGBShiftDistortionNode extends TempNode {
  static get type(): string {
    return 'RGBShiftDistortionNode'
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
      const fluid = fluidTex.sample(fluidUv).rgb
      const vel = fluid.xy
      const density = fluid.z.clamp(0, 1)

      const speed = max(vel.length(), 1e-4)
      const dir = vel.div(speed)
      const strength = density.pow(1.4).mul(intensity).mul(0.012)
      const shift = dir.mul(strength)

      const r = sceneTex.sample(sceneUv.add(shift)).r
      const g = sceneTex.sample(sceneUv).g
      const b = sceneTex.sample(sceneUv.sub(shift)).b
      return vec4(r, g, b, 1)
    }) as () => Node

    return apply()
  }
}

/**
 * Apply a density-driven chromatic R/B split to `sceneNode` along the
 * normalised flow direction. Matches `RGBShiftDistortionPass` from the GLSL
 * pipeline.
 *
 * @param sceneNode The scene/colour input being distorted.
 * @param fluidNode Fluid texture (`.rg` = velocity, `.b` = density).
 * @param intensity Scalar gain on the chroma split; defaults to 1.
 */
export const rgbShiftDistortion = (
  sceneNode: Node,
  fluidNode: Node,
  intensity: number | Node = 1,
): Node =>
  nodeObject(
    new RGBShiftDistortionNode(
      convertToTexture(sceneNode as Any),
      convertToTexture(fluidNode as Any),
      nodeObject(intensity as Any) as Node,
    ) as Any,
  ) as Node
