import { TempNode, type TextureNode } from 'three/webgpu'
import {
  convertToTexture,
  dot,
  float,
  Fn,
  atan,
  mix,
  nodeObject,
  smoothstep,
  uv as uvFn,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node, NodeBuilder } from 'three/webgpu'

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

export type FluidOverlayStyle =
  | 'default'
  | 'volumeCursor'
  | 'trail'
  | 'oil'
  | 'velocity'
  | 'colorful'
  | 'rainbowFish'
  | 'glaze'
  | 'burn'
  | 'smoke'
  | 'artInk'
  | 'rainbowInk'
  | 'colorWater'
  | 'liquidLens'

export interface FluidOverlayOptions {
  intensity?: number | Node
  time?: number | Node
  texel?: Node
  cursorColor?: Node
  vibrance?: number | Node
  velocityScale?: number | Node
  opacity?: number | Node
}

const TAU = 6.28318530718

interface FluidOverlayNodeOptions {
  intensity: Node
  time: Node
  texel: Node
  cursorColor: Node
  vibrance: Node
  velocityScale: Node
  opacity: Node
}

const toNode = (value: unknown, fallback: Any): Node =>
  nodeObject((value ?? fallback) as Any) as Node

export class FluidOverlayNode extends TempNode {
  static get type(): string {
    return 'FluidOverlayNode'
  }

  readonly style: FluidOverlayStyle
  readonly sceneTexture: TextureNode
  readonly densityTexture: TextureNode
  readonly dyeTexture: TextureNode
  readonly velocityTexture: TextureNode
  readonly intensityNode: Node
  readonly timeNode: Node
  readonly texelNode: Node
  readonly cursorColorNode: Node
  readonly vibranceNode: Node
  readonly velocityScaleNode: Node
  readonly opacityNode: Node

  constructor(
    style: FluidOverlayStyle,
    sceneTexture: TextureNode,
    densityTexture: TextureNode,
    dyeTexture: TextureNode,
    velocityTexture: TextureNode,
    options: FluidOverlayNodeOptions,
  ) {
    super('vec4')
    this.style = style
    this.sceneTexture = sceneTexture
    this.densityTexture = densityTexture
    this.dyeTexture = dyeTexture
    this.velocityTexture = velocityTexture
    this.intensityNode = options.intensity
    this.timeNode = options.time
    this.texelNode = options.texel
    this.cursorColorNode = options.cursorColor
    this.vibranceNode = options.vibrance
    this.velocityScaleNode = options.velocityScale
    this.opacityNode = options.opacity
  }

  setup(_builder: NodeBuilder): Node {
    const sceneTex = this.sceneTexture as unknown as Any
    const densityTex = this.densityTexture as unknown as Any
    const dyeTex = this.dyeTexture as unknown as Any
    const velocityTex = this.velocityTexture as unknown as Any
    const sceneUv = (sceneTex.uvNode as Any) || uvFn()
    const fluidUv = (densityTex.uvNode as Any) || uvFn()
    const intensity = this.intensityNode as unknown as Any
    const timeNode = this.timeNode as unknown as Any
    const texel = this.texelNode as unknown as Any
    const cursorColor = this.cursorColorNode as unknown as Any
    const vibrance = this.vibranceNode as unknown as Any
    const velocityScale = this.velocityScaleNode as unknown as Any
    const opacity = this.opacityNode as unknown as Any

    const sampleDye5 = (uv: Any): Any => {
      let d = dyeTex.sample(uv).rgb.mul(0.5)
      d = d.add(dyeTex.sample(uv.add(texel.mul(vec2(1, 1)))).rgb.mul(0.125))
      d = d.add(dyeTex.sample(uv.add(texel.mul(vec2(-1, 1)))).rgb.mul(0.125))
      d = d.add(dyeTex.sample(uv.add(texel.mul(vec2(1, -1)))).rgb.mul(0.125))
      d = d.add(dyeTex.sample(uv.add(texel.mul(vec2(-1, -1)))).rgb.mul(0.125))
      return d
    }

    const palette = (phase: Any): Any => {
      const p = phase.fract()
      return vec3(
        p.mul(TAU).sin().mul(0.5).add(0.5),
        p.add(0.333).mul(TAU).sin().mul(0.5).add(0.5),
        p.add(0.666).mul(TAU).sin().mul(0.5).add(0.5),
      )
    }

    const oilPalette = (phase: Any): Any => {
      const ember = vec3(1.0, 0.33, 0.2)
      const mint = vec3(0.08, 0.78, 0.68)
      const cream = vec3(1.0, 0.84, 0.55)
      return mix(
        mix(ember, cream, smoothstep(0.15, 0.85, phase)),
        mint,
        smoothstep(0.55, 1.0, phase).mul(0.42),
      )
    }

    const hsv2rgb = (c: Any): Any => {
      const K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0)
      const p = c.xxx.add(K.xyz).fract().mul(6).sub(K.www).abs()
      return c.z.mul(mix(K.xxx, p.sub(K.xxx).clamp(0, 1), c.y))
    }

    const vibrant = (color: Any, amount: Any): Any => {
      const lum = dot(color, vec3(0.299, 0.587, 0.114))
      return mix(vec3(lum, lum, lum), color, float(1).add(amount)).clamp(0, 1)
    }

    const farDye = (): Any => {
      const offX = vec2(texel.x.mul(8), 0)
      const offY = vec2(0, texel.y.mul(8))
      let far = dyeTex.sample(fluidUv.add(offX)).rgb.length()
      far = far.add(dyeTex.sample(fluidUv.sub(offX)).rgb.length())
      far = far.add(dyeTex.sample(fluidUv.add(offY)).rgb.length())
      far = far.add(dyeTex.sample(fluidUv.sub(offY)).rgb.length())
      return far.mul(0.25)
    }

    const trailTail = (vel: Any): Any => {
      let tail: Any = float(0)
      let wsum: Any = float(0)
      for (let i = 1; i < 8; i += 1) {
        const weight = 1 - i / 8
        tail = tail.add(densityTex.sample(fluidUv.sub(vel.mul(i * 0.04))).b.mul(weight))
        wsum = wsum.add(weight)
      }
      return tail.div(wsum)
    }

    const apply = Fn(() => {
      const densitySample = densityTex.sample(fluidUv).rgb
      const velocitySample = velocityTex.sample(fluidUv).rg.mul(velocityScale)
      const density = densitySample.b.clamp(0, 1)
      const vel = densitySample.rg
      const dye = sampleDye5(fluidUv)
      const dyeAmp = dye.length()
      const dyeHue = dye.div(dyeAmp.add(0.00001)).clamp(0, 1)
      const scene = sceneTex.sample(sceneUv).rgb
      const speed = vel.length()
      const composite = (overlay: Any): Any => vec4(mix(scene, overlay, opacity.clamp(0, 1)), 1)

      if (this.style === 'default') {
        const core = smoothstep(0.02, 0.55, farDye().mul(intensity).mul(4))
        const kinetic = speed.mul(0.02).clamp(0, 1)
        const tint = vibrant(
          cursorColor.mul(float(0.48).add(core.mul(0.52))).add(vec3(kinetic.mul(0.12))),
          vibrance,
        )
        const alpha = dyeAmp.mul(intensity).mul(3).clamp(0, 0.95)
        return composite(mix(scene, tint, alpha))
      }

      if (this.style === 'volumeCursor') {
        const offX = vec2(texel.x.mul(1.5), 0)
        const offY = vec2(0, texel.y.mul(1.5))
        const grad = vec2(
          dyeTex
            .sample(fluidUv.add(offX))
            .rgb.length()
            .sub(dyeTex.sample(fluidUv.sub(offX)).rgb.length()),
          dyeTex
            .sample(fluidUv.add(offY))
            .rgb.length()
            .sub(dyeTex.sample(fluidUv.sub(offY)).rgb.length()),
        )
        const ndir = grad.div(grad.length().add(0.0001))
        const lit = dot(ndir, vec2(-0.6, 0.8)).mul(0.5).add(0.5).clamp(0.2, 1)
        const shade = dyeAmp.pow(0.42).mul(lit)
        const tint = vibrant(cursorColor.mul(float(0.3).add(shade.mul(1.1))).clamp(0, 1), vibrance)
        const alpha = dyeAmp.mul(intensity).mul(2.2).clamp(0, 0.88)
        return composite(mix(scene, tint, alpha))
      }

      if (this.style === 'trail') {
        const tail = trailTail(vel)
        const head = density.pow(4)
        const glow = tail.mul(0.7).add(head.mul(1.4)).mul(intensity)
        return composite(scene.add(vibrant(cursorColor, vibrance).mul(glow)))
      }

      if (this.style === 'oil') {
        let trail: Any = density
        for (let i = 1; i < 6; i += 1) {
          const offset = vel.mul(i * 0.035)
          trail = trail.add(densityTex.sample(fluidUv.sub(offset)).b.mul(1 - i / 7))
        }
        const glow = trail.mul(intensity).clamp(0, 1)
        const color = vibrant(
          oilPalette(glow.mul(0.62).add(speed.mul(0.015)).add(timeNode.mul(0.025)).fract()),
          vibrance,
        )
        const alpha = glow.mul(0.58).add(speed.mul(0.012)).clamp(0, 0.86)
        const additive = scene.add(color.mul(alpha).mul(0.86))
        return composite(mix(additive, color, alpha.mul(0.14)))
      }

      if (this.style === 'velocity') {
        const raw = velocitySample
        const scaled = raw.mul(0.04).mul(intensity)
        const len = scaled.length().clamp(0, 1)
        const velocityColor = vec3(scaled.mul(1.5).add(0.1), 1)
        return composite(scene.add(velocityColor.mul(len)))
      }

      if (this.style === 'colorful') {
        let glow: Any = float(0)
        let color: Any = vec3(0)
        for (let i = 0; i < 6; i += 1) {
          const origin = fluidUv.sub(vel.mul(i * 0.035))
          const d = densityTex.sample(origin).b
          const w = d.mul(1 - i / 7)
          glow = glow.add(w)
          const hueA = origin.x.mul(1.6).add(origin.y.mul(0.9)).add(timeNode.mul(0.05))
          const hueB = origin.y.mul(1.2).sub(origin.x.mul(0.4)).sub(timeNode.mul(0.03))
          const a = hsv2rgb(vec3(hueA.fract(), 0.9, 1.0))
          const b = hsv2rgb(vec3(hueB.fract(), 0.85, 0.95))
          color = color.add(mix(a, b, 0.5).mul(w))
        }
        color = color.div(glow.max(0.0001))
        const amount = glow.mul(intensity).mul(0.55).clamp(0, 1.4)
        return composite(scene.add(vibrant(color, vibrance).mul(amount)))
      }

      if (this.style === 'rainbowFish') {
        const fishVel = velocitySample.mul(0.04)
        const fishSpeed = fishVel.length()
        const angle = atan(fishVel.y, fishVel.x)
        const hueA = angle.div(TAU).add(0.5).add(timeNode.mul(0.05))
        const hueB = fluidUv.x.mul(1.2).add(fluidUv.y.mul(0.8)).add(timeNode.mul(0.04))
        const a = hsv2rgb(vec3(hueA.fract(), 0.92, 1.0))
        const b = hsv2rgb(vec3(hueB.fract(), 0.7, 0.95))
        const color = vibrant(mix(a, b, 0.35), vibrance)
        const s = fishSpeed.mul(8).clamp(0, 1)
        const strength = s.pow(2.5).mul(1.6).mul(intensity)
        return composite(scene.add(color.mul(strength)))
      }

      if (this.style === 'glaze') {
        return composite(
          scene.add(
            vibrant(vec3(1.0, 0.45, 0.22), vibrance)
              .mul(density)
              .mul(intensity),
          ),
        )
      }

      if (this.style === 'burn') {
        let fingers: Any = float(0)
        for (let i = 0; i < 5; i += 1) {
          const offset = vel.mul((i + 1) * 0.05)
          fingers = fingers.add(densityTex.sample(fluidUv.sub(offset)).b.mul(1 - i / 5))
        }
        fingers = fingers.mul(intensity)
        const burnColor = vec3(1.0, 0.3, 0.0)
        const emberColor = vec3(0.8, 0.15, 0.0)
        let fireColor: Any = mix(emberColor, burnColor, fingers.clamp(0, 1))
        fireColor = fireColor.add(burnColor.mul(fingers.clamp(0, 1).pow(2)).mul(2))
        const smoke = fingers.mul(0.3)
        fireColor = fireColor.add(vec3(0.1, 0.1, 0.15).mul(smoke))
        const flicker = timeNode.mul(15).add(fingers.mul(20)).sin().mul(0.2).add(0.8)
        fireColor = fireColor.mul(flicker)
        const alpha = fingers.mul(0.5).mul(flicker).add(smoke.mul(0.2)).clamp(0, 0.85)
        return composite(mix(scene, vibrant(fireColor, vibrance), alpha))
      }

      if (this.style === 'smoke') {
        const alpha = dyeAmp.mul(intensity).mul(2.6).clamp(0, 0.78)
        const smoke = vec3(0.9, 0.92, 0.94).mul(float(0.22).add(alpha.mul(0.9)))
        return composite(mix(scene, smoke, alpha))
      }

      if (this.style === 'artInk') {
        const alpha = dyeAmp.mul(intensity).mul(2.2).clamp(0, 1)
        return composite(scene.add(vibrant(dyeHue, vibrance).mul(alpha).mul(1.55)))
      }

      if (this.style === 'rainbowInk') {
        const phase = sceneUv.x
          .mul(0.45)
          .add(sceneUv.y.mul(0.35))
          .add(dyeAmp.mul(0.2))
          .add(timeNode.mul(0.03))
        const tint = vibrant(mix(dyeHue, palette(phase), 0.45), vibrance)
        const alpha = dyeAmp.mul(intensity).mul(2.35).clamp(0, 1)
        return composite(scene.add(tint.mul(alpha).mul(1.35)))
      }

      if (this.style === 'colorWater') {
        const alpha = dyeAmp.mul(intensity).mul(2.1).clamp(0, 0.72)
        const wash = mix(scene, vibrant(dyeHue, vibrance), alpha)
        return composite(wash.add(scene.mul(dyeHue).mul(alpha).mul(0.35)))
      }

      const gate = dyeAmp.mul(4).clamp(0, 1)
      const distortedUv = sceneUv.add(vel.mul(gate).mul(0.012))
      const refracted = sceneTex.sample(distortedUv).rgb
      const tint = vibrant(dyeHue, vibrance).mul(dyeAmp).mul(intensity).mul(1.4).clamp(0, 1.6)
      return composite(refracted.add(refracted.mul(tint)))
    }) as () => Node

    return apply()
  }
}

export const fluidOverlay = (
  style: FluidOverlayStyle,
  sceneNode: Node,
  densityNode: Node,
  dyeNode: Node,
  velocityNode: Node,
  options: FluidOverlayOptions = {},
): Node =>
  nodeObject(
    new FluidOverlayNode(
      style,
      convertToTexture(sceneNode as Any),
      convertToTexture(densityNode as Any),
      convertToTexture(dyeNode as Any),
      convertToTexture(velocityNode as Any),
      {
        intensity: toNode(options.intensity, float(1)),
        time: toNode(options.time, float(0)),
        texel: toNode(options.texel, vec2(1 / 512, 1 / 512)),
        cursorColor: toNode(options.cursorColor, vec3(0.85, 0.95, 1.0)),
        vibrance: toNode(options.vibrance, float(0)),
        velocityScale: toNode(options.velocityScale, float(1)),
        opacity: toNode(options.opacity, float(1)),
      },
    ) as Any,
  ) as Node

const styleWrapper =
  (style: FluidOverlayStyle) =>
  (
    sceneNode: Node,
    densityNode: Node,
    dyeNode: Node,
    velocityNode: Node,
    options: FluidOverlayOptions = {},
  ): Node =>
    fluidOverlay(style, sceneNode, densityNode, dyeNode, velocityNode, options)

export const defaultOverlay = styleWrapper('default')
export const volumeCursorOverlay = styleWrapper('volumeCursor')
export const trailOverlay = styleWrapper('trail')
export const oilOverlay = styleWrapper('oil')
export const velocityOverlay = styleWrapper('velocity')
export const colorfulOverlay = styleWrapper('colorful')
export const rainbowFishOverlay = styleWrapper('rainbowFish')
export const glazeOverlay = styleWrapper('glaze')
export const burnOverlay = styleWrapper('burn')
export const smokeOverlay = styleWrapper('smoke')
export const artInkOverlay = styleWrapper('artInk')
export const rainbowInkOverlay = styleWrapper('rainbowInk')
export const colorWaterOverlay = styleWrapper('colorWater')
export const liquidLensOverlay = styleWrapper('liquidLens')
