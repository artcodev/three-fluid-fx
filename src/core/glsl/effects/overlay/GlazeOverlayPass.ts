import { Uniform, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Minimal additive density tint — the simplest meaningful overlay.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  float density = clamp(texture2D(tFluid, vUv).b, 0.0, 1.0);
  vec3 tint = vibrant(vec3(1.0, 0.45, 0.22), uVibrance);
  gl_FragColor = vec4(scene + tint * density * uIntensity, 1.0);
}
`

/** Minimal additive density tint — the simplest meaningful overlay. */
export class GlazeOverlayPass extends FluidEffectPass {
  intensity = 1
  vibrance = 0

  constructor(private readonly fluid: FluidSimulation) {
    super(
      FRAGMENT,
      {
        tDiffuse: new Uniform<Texture | null>(null),
        tFluid: new Uniform<Texture | null>(null),
        uIntensity: new Uniform(1),
        uVibrance: new Uniform(0),
      },
    )
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.tFluid.value = this.fluid.densityTexture
    u.uIntensity.value = this.intensity
    u.uVibrance.value = this.vibrance
  }
}
