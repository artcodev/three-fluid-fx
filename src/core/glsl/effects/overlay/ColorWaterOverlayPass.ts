import { Uniform, Vector2, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Watercolour wash — translucent colour blot that lets the scene show through
// everywhere. Loosely inspired by dreamers.js' post-shader (`rgba + rgba *
// dispOut`, a multiplicative scene tint), but here the composite is alpha-mix
// capped below 1 plus a soft scene-tinted glow, which reads as wet ink soaking
// into paper rather than a refracted lens. 5-tap diagonal bloom supplements
// the sim's natural diffusion to feather the rim.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  float density = length(dye);
  vec3 hue = density > 1e-4 ? vibrant(dye / density, uVibrance) : vec3(1.0);
  float alpha = (1.0 - exp(-density * uIntensity * 3.0)) * 0.72;

  vec3 wash = mix(scene, hue * 1.1, alpha);
  vec3 result = wash + scene * hue * alpha * 0.35;
  gl_FragColor = vec4(result, 1.0);
}
`

/** Watercolour wash — translucent alpha-mix tint plus a soft scene-tinted glow. */
export class ColorWaterOverlayPass extends FluidEffectPass {
  intensity = 1
  vibrance = 0

  constructor(private readonly fluid: FluidSimulation) {
    super(
      FRAGMENT,
      {
        tDiffuse: new Uniform<Texture | null>(null),
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
    u.tDye.value = this.fluid.dyeTexture
    u.uIntensity.value = this.intensity
    u.uVibrance.value = this.vibrance
    const img = this.fluid.dyeTexture.image as { width: number; height: number }
    ;(u.uTexel.value as Vector2).set(1 / img.width, 1 / img.height)
  }
}
