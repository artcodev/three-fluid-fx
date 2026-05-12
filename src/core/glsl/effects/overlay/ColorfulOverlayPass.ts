import { Uniform, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Classic FluidCursor-style rainbow: density drives glow strength, hue is
// picked from the *back-traced* origin position + time. Sampling along the
// velocity back-trace makes the colour bands swirl around vortices.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
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
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  vec2 vel = fluid.rg;

  float glow = 0.0;
  vec3 color = vec3(0.0);
  for (float i = 0.0; i < 6.0; i += 1.0) {
    vec2 offset = vel * i * 0.035;
    vec2 origin = vUv - offset;
    float d = texture2D(tFluid, origin).b;
    float w = (1.0 - i / 7.0) * d;
    glow += w;
    float hueA = origin.x * 1.6 + origin.y * 0.9 + uTime * 0.05;
    float hueB = origin.y * 1.2 - origin.x * 0.4 - uTime * 0.03;
    vec3 a = hsv2rgb(vec3(fract(hueA), 0.9, 1.0));
    vec3 b = hsv2rgb(vec3(fract(hueB), 0.85, 0.95));
    color += mix(a, b, 0.5) * w;
  }
  if (glow > 0.0) color /= glow;

  color = vibrant(color, uVibrance);
  float intensity = clamp(glow * uIntensity * 0.55, 0.0, 1.4);
  vec3 result = scene + color * intensity;
  gl_FragColor = vec4(result, 1.0);
}
`

/** Classic FluidCursor-style rainbow: density glow + back-traced position-driven hue. */
export class ColorfulOverlayPass extends FluidEffectPass {
  intensity = 1
  time = 0
  vibrance = 0

  constructor(private readonly fluid: FluidSimulation) {
    super(
      FRAGMENT,
      {
        tDiffuse: new Uniform<Texture | null>(null),
        tFluid: new Uniform<Texture | null>(null),
        uIntensity: new Uniform(1),
        uTime: new Uniform(0),
        uVibrance: new Uniform(0),
      },
    )
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.tFluid.value = this.fluid.densityTexture
    u.uIntensity.value = this.intensity
    u.uTime.value = this.time
    u.uVibrance.value = this.vibrance
  }
}
