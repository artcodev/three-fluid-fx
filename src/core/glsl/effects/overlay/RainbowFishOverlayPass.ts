import { Uniform, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Hue from velocity *direction* (atan2), brightness from speed. Around any
// vortex centre the angle sweeps the full 0–2π, so every swirl renders as
// a closed rainbow ring. A second hue band derived from position + time
// adds structure so the result reads as more than a "naked colour wheel".
// Uses the post-pressure projected velocity for crisp, divergence-free swirls.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tVelocity;
uniform float uIntensity;
uniform float uTime;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  vec2 vel = texture2D(tVelocity, vUv).xy * 0.04;
  float speed = length(vel);

  float angle = atan(vel.y, vel.x);
  float hueA = angle / 6.28318 + 0.5 + uTime * 0.05;
  float hueB = vUv.x * 1.2 + vUv.y * 0.8 + uTime * 0.04;

  vec3 a = hsv2rgb(vec3(fract(hueA), 0.92, 1.0));
  vec3 b = hsv2rgb(vec3(fract(hueB), 0.7, 0.95));
  vec3 color = vibrant(mix(a, b, 0.35), uVibrance);

  // pow(s, 2.5) kills the low-speed haze that otherwise tints the whole
  // scene whenever fluid is alive, while preserving bright vortex cores.
  float s = clamp(speed * 8.0, 0.0, 1.0);
  float strength = pow(s, 2.5) * 1.6 * uIntensity;
  vec3 result = scene + color * strength;
  gl_FragColor = vec4(result, 1.0);
}
`

/** Hue from velocity angle, brightness from speed — closed rainbow ring around each vortex. */
export class RainbowFishOverlayPass extends FluidEffectPass {
  intensity = 1
  time = 0
  vibrance = 0

  constructor(private readonly fluid: FluidSimulation) {
    super(
      FRAGMENT,
      {
        tDiffuse: new Uniform<Texture | null>(null),
        tVelocity: new Uniform<Texture | null>(null),
        uIntensity: new Uniform(1),
        uTime: new Uniform(0),
        uVibrance: new Uniform(0),
      },
    )
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.tVelocity.value = this.fluid.velocityProjectedTexture
    u.uIntensity.value = this.intensity
    u.uTime.value = this.time
    u.uVibrance.value = this.vibrance
  }
}
