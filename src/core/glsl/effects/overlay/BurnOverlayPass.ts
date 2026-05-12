import { Uniform, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Ghostly fiery "fingers" advected along the velocity field. Reads multi-tap
// density along the flow direction to build a soft trail, paints it with an
// ember→flame palette, adds smoky undertones and per-pixel flicker, then
// composites over the scene with the shader-derived alpha.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uIntensity;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uVibrance;

vec3 vibrant(vec3 c, float v) {
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), c, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  vec2 vel = fluid.rg;

  float fingers = 0.0;
  for (float i = 0.0; i < 5.0; i++) {
    vec2 offset = vel * (i + 1.0) * 0.05;
    float trail = texture2D(tFluid, vUv - offset).b;
    fingers += trail * (1.0 - i / 5.0);
  }
  fingers *= uIntensity;

  vec3 burnColor = vec3(1.0, 0.3, 0.0);
  vec3 emberColor = vec3(0.8, 0.15, 0.0);
  vec3 ghostColor = mix(emberColor, burnColor, clamp(fingers, 0.0, 1.0));

  float tips = pow(clamp(fingers, 0.0, 1.0), 2.0);
  ghostColor += burnColor * tips * 2.0;

  float smoke = fingers * 0.3;
  vec3 smokeColor = vec3(0.1, 0.1, 0.15) * smoke;

  vec3 fireColor = ghostColor + smokeColor;

  float flicker = 0.8 + 0.2 * sin(uTime * 15.0 + fingers * 20.0);
  fireColor *= flicker;

  float alpha = fingers * 0.5 * flicker + smoke * 0.2;
  alpha = clamp(alpha, 0.0, 0.85);

  vec3 result = mix(scene, vibrant(fireColor, uVibrance), alpha);
  gl_FragColor = vec4(result, 1.0);
}
`

/** Ghostly fiery fingers advected along the velocity field, ember-to-flame palette with flicker. */
export class BurnOverlayPass extends FluidEffectPass {
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
