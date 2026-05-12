import { Color, Uniform, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Directional wake: density sampled backward along the velocity direction
// with weights decaying along the tail; current-cell density raised to a
// high power gives a bright leading edge. Single tint, additive.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;
uniform vec3 uCursorColor;
uniform float uVibrance;

vec3 vibrant(vec3 col, float v) {
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), col, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  vec2 vel = fluid.rg;
  float here = clamp(fluid.b, 0.0, 1.0);

  float tail = 0.0;
  float wsum = 0.0;
  for (float i = 1.0; i < 8.0; i += 1.0) {
    vec2 offset = vel * i * 0.04;
    float w = 1.0 - i / 8.0;
    tail += texture2D(tFluid, vUv - offset).b * w;
    wsum += w;
  }
  tail /= wsum;

  float head = pow(here, 4.0);
  float glow = (tail * 0.7 + head * 1.4) * uIntensity;

  vec3 result = scene + vibrant(uCursorColor, uVibrance) * glow;
  gl_FragColor = vec4(result, 1.0);
}
`

/** Directional wake — sharp leading edge, long fading tail in user-picked cursor colour. */
export class TrailOverlayPass extends FluidEffectPass {
  intensity = 1
  vibrance = 0
  cursorColor: Color

  constructor(private readonly fluid: FluidSimulation) {
    const initialColor = new Color(0.85, 0.95, 1.0)
    super(
      FRAGMENT,
      {
        tDiffuse: new Uniform<Texture | null>(null),
        tFluid: new Uniform<Texture | null>(null),
        uIntensity: new Uniform(1),
        uCursorColor: new Uniform(initialColor.clone()),
        uVibrance: new Uniform(0),
      },
    )
    this.cursorColor = initialColor
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.tFluid.value = this.fluid.densityTexture
    u.uIntensity.value = this.intensity
    ;(u.uCursorColor.value as Color).copy(this.cursorColor)
    u.uVibrance.value = this.vibrance
  }
}
