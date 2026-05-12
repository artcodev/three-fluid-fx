import { NodeUpdateType, TempNode, Vector2, type TextureNode } from 'three/webgpu'
import {
  convertToTexture,
  float,
  Fn,
  nodeObject,
  smoothstep,
  uniform,
  uv as uvFn,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node, NodeBuilder, NodeFrame } from 'three/webgpu'

/**
 * Surface refraction (same as `WaterDistortion`) plus a procedural caustic
 * web — five octaves of reciprocal-length wavelets, after the canonical
 * Shadertoy "caustic" formulation (drift, 2013). UVs are advected by fluid
 * velocity so the web rolls with the flow, and the result is masked by local
 * density so the pattern only appears on actively stirred regions.
 *
 * The TSL graph **manually unrolls the 5-iteration loop** at compile time.
 * `Loop()` would also work, but the iteration carries dependent state (`i`
 * is fed back into the next step), so unrolled JS-side is the simpler shape
 * and matches the original GLSL inlining.
 */
type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

export class WaterCausticsDistortionNode extends TempNode {
  static get type(): string {
    return 'WaterCausticsDistortionNode'
  }

  readonly sceneTexture: TextureNode
  readonly fluidTexture: TextureNode
  readonly intensityNode: Node
  readonly timeNode: Node

  private readonly _invSize = uniform(new Vector2())

  constructor(
    sceneTexture: TextureNode,
    fluidTexture: TextureNode,
    intensityNode: Node,
    timeNode: Node,
  ) {
    super('vec4')
    this.sceneTexture = sceneTexture
    this.fluidTexture = fluidTexture
    this.intensityNode = intensityNode
    this.timeNode = timeNode
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
    const timeNode = this.timeNode as unknown as Any

    const TAU = 6.28318530718
    const INTEN = 0.005

    // Manual unroll of the 5-octave caustic web.
    const causticWeb = (rawUv: Any, t: Any): Any => {
      const p = rawUv.mul(TAU).mod(TAU).sub(250) as Any
      let i: Any = p
      let c: Any = float(1)

      for (let n = 0; n < 5; n++) {
        const tt = t.mul(1 - 3.5 / (n + 1))
        i = p.add(
          vec2(
            tt.sub(i.x).cos().add(tt.add(i.y).sin()),
            tt.sub(i.y).sin().add(tt.add(i.x).cos()),
          ),
        )
        const denomX = i.x.add(tt).sin().div(INTEN)
        const denomY = i.y.add(tt).cos().div(INTEN)
        const lenArg = vec2(p.x.div(denomX), p.y.div(denomY)) as Any
        c = c.add(float(1).div(lenArg.length()))
      }

      c = c.div(5)
      c = float(1.17).sub(c.pow(1.4))
      return c.abs().pow(8).clamp(0, 1)
    }

    const apply = Fn(() => {
      const offX = vec2(invSize.x.mul(2), 0) as Any
      const offY = vec2(0, invSize.y.mul(2)) as Any

      const fluidCenter = fluidTex.sample(fluidUv).rgb
      const hC = fluidCenter.z
      const vel = fluidCenter.xy

      const hL = fluidTex.sample(fluidUv.sub(offX)).b
      const hR = fluidTex.sample(fluidUv.add(offX)).b
      const hD = fluidTex.sample(fluidUv.sub(offY)).b
      const hU = fluidTex.sample(fluidUv.add(offY)).b
      const normal = vec2(hR.sub(hL), hU.sub(hD)) as Any

      const offset = normal.mul(intensity).mul(0.6)
      const r = sceneTex.sample(sceneUv.add(offset.mul(0.95))).r
      const g = sceneTex.sample(sceneUv.add(offset)).g
      const b = sceneTex.sample(sceneUv.add(offset.mul(1.05))).b

      // The fluid only gates/disturbs the tileable light field; it should not draw the caustic.
      const surface = smoothstep(0.015, 0.16, hC)
      const slope = smoothstep(0.0015, 0.04, normal.length())
      const cuv = sceneUv.mul(4.0).add(vel.mul(0.0012))
      const web = causticWeb(cuv, timeNode.mul(0.5).add(23))
      const caustic = vec3(web, web, web).add(vec3(0.0, 0.35, 0.5)).clamp(0, 1)
      const energy = web.pow(1.25).mul(surface).mul(slope.mul(0.6).add(0.4))

      const color = vec3(r, g, b).add(caustic.mul(energy).mul(intensity).mul(0.38))
      return vec4(color, 1)
    }) as () => Node

    return apply()
  }
}

/**
 * Refraction + procedural caustic web on top of `sceneNode`. Matches
 * `WaterCausticsDistortionPass` from the GLSL pipeline. Pass `time` (seconds)
 * as a TSL number/node so the caustic web evolves continuously.
 *
 * @param sceneNode The scene/colour input being refracted.
 * @param fluidNode Fluid texture (`.rg` = velocity, `.b` = density).
 * @param intensity Scalar gain; defaults to 1.
 * @param time      Animation time in seconds. Use a uniform updated each frame.
 */
export const waterCausticsDistortion = (
  sceneNode: Node,
  fluidNode: Node,
  intensity: number | Node = 1,
  time: number | Node = 0,
): Node =>
  nodeObject(
    new WaterCausticsDistortionNode(
      convertToTexture(sceneNode as Any),
      convertToTexture(fluidNode as Any),
      nodeObject(intensity as Any) as Node,
      nodeObject(time as Any) as Node,
    ) as Any,
  ) as Node
