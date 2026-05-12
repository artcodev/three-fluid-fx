import { Uniform, Vector2, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Density (fluid.b) is treated as the height of a water surface; the 4-tap
// gradient gives the surface tilt (fake normal). UVs are bent along that
// tilt with a per-channel Snell split — R bends ~5% less than B — so flat
// regions stay sharp and active flow refracts like ripples on a pool.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;
uniform vec2 uTexel;

void main() {
  float hL = texture2D(tFluid, vUv - vec2(uTexel.x * 2.0, 0.0)).b;
  float hR = texture2D(tFluid, vUv + vec2(uTexel.x * 2.0, 0.0)).b;
  float hD = texture2D(tFluid, vUv - vec2(0.0, uTexel.y * 2.0)).b;
  float hU = texture2D(tFluid, vUv + vec2(0.0, uTexel.y * 2.0)).b;
  vec2 normal = vec2(hR - hL, hU - hD);

  vec2 offset = normal * uIntensity * 0.6;
  float r = texture2D(tDiffuse, vUv + offset * 0.95).r;
  float g = texture2D(tDiffuse, vUv + offset).g;
  float b = texture2D(tDiffuse, vUv + offset * 1.05).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}
`

/** Refraction through density-as-height: density gradient bends UVs with a per-channel Snell split. */
export class WaterDistortionPass extends FluidEffectPass {
  intensity = 1

  constructor(private readonly fluid: FluidSimulation) {
    super(FRAGMENT, {
      tDiffuse: new Uniform<Texture | null>(null),
      tFluid: new Uniform<Texture | null>(null),
      uIntensity: new Uniform(1),
      uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
    })
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    this.material.uniforms.tDiffuse.value = readBuffer.texture
    this.material.uniforms.tFluid.value = this.fluid.densityTexture
    this.material.uniforms.uIntensity.value = this.intensity
    const img = this.fluid.densityTexture.image as { width: number; height: number }
    ;(this.material.uniforms.uTexel.value as Vector2).set(1 / img.width, 1 / img.height)
  }
}
