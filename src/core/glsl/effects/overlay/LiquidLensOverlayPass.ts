import { Uniform, Vector2, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Closer port of dreamers.js' overlay logic: the velocity field bends the
// scene's UVs under the blot (refraction lens), and the colour is composited
// multiplicatively (`scene + scene * tint`) so the scene stays 100% visible
// everywhere — blots only *brighten* it in the dye's hue. Distinct from
// Color Water's alpha-mix wash; reads as wet glass over a back-lit print.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tVelocity;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  vec2 vel = texture2D(tVelocity, vUv).xy * 0.04;
  float density = length(dye);
  float refractGate = clamp(density * 4.0, 0.0, 1.0);
  vec2 distortedUv = vUv + vel * refractGate * 0.012;
  vec3 scene = texture2D(tDiffuse, distortedUv).rgb;

  float dyeAmp = length(dye);
  vec3 dyeBoosted = dyeAmp > 1e-5
    ? vibrant(dye / dyeAmp, uVibrance) * dyeAmp
    : dye;
  vec3 tint = min(dyeBoosted * uIntensity * 1.4, vec3(1.6));
  vec3 result = scene + scene * tint;

  gl_FragColor = vec4(result, 1.0);
}
`

/** Velocity-refracted scene + multiplicative dye tint (dreamers.js port). */
export class LiquidLensOverlayPass extends FluidEffectPass {
  intensity = 1
  vibrance = 0

  constructor(private readonly fluid: FluidSimulation) {
    super(
      FRAGMENT,
      {
        tDiffuse: new Uniform<Texture | null>(null),
        tVelocity: new Uniform<Texture | null>(null),
        tDye: new Uniform<Texture | null>(null),
        uIntensity: new Uniform(1),
        uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
        uVibrance: new Uniform(0),
      },
    )
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.tVelocity.value = this.fluid.velocityTexture
    u.tDye.value = this.fluid.dyeTexture
    u.uIntensity.value = this.intensity
    u.uVibrance.value = this.vibrance
    const img = this.fluid.dyeTexture.image as { width: number; height: number }
    ;(u.uTexel.value as Vector2).set(1 / img.width, 1 / img.height)
  }
}
