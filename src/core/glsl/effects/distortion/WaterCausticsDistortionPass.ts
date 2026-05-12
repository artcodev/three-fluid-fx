import { Uniform, Vector2, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Same surface refraction as Water, plus a procedural caustic web (after the
// well-known Shadertoy "caustic" formulation by drift): five octaves of
// reciprocal-length wavelets summed and raised to a high power produce the
// characteristic web of thin bright filaments. The fluid gates and disturbs
// this light field, but does not define the caustic shape itself.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tFluid;
uniform float uIntensity;
uniform float uTime;
uniform vec2 uTexel;

float causticWeb(vec2 uv, float t) {
  // The formula degenerates near p = 0 (1/length blows up); the canonical
  // Shadertoy version offsets by a large constant to keep p far from origin.
  const float TAU = 6.28318530718;
  vec2 p = mod(uv * TAU, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y),
                 sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(
      p.x / (sin(i.x + tt) / inten),
      p.y / (cos(i.y + tt) / inten)
    ));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}

void main() {
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  float hC = fluid.b;
  vec2 vel = fluid.rg;

  float hL = texture2D(tFluid, vUv - vec2(uTexel.x * 2.0, 0.0)).b;
  float hR = texture2D(tFluid, vUv + vec2(uTexel.x * 2.0, 0.0)).b;
  float hD = texture2D(tFluid, vUv - vec2(0.0, uTexel.y * 2.0)).b;
  float hU = texture2D(tFluid, vUv + vec2(0.0, uTexel.y * 2.0)).b;
  vec2 normal = vec2(hR - hL, hU - hD);

  vec2 offset = normal * uIntensity * 0.6;
  float r = texture2D(tDiffuse, vUv + offset * 0.95).r;
  float g = texture2D(tDiffuse, vUv + offset).g;
  float b = texture2D(tDiffuse, vUv + offset * 1.05).b;

  // Evaluate the Hoskins/joltz0r field as a small tileable light texture.
  // The fluid only gates/disturbs the light; it should not draw the caustic.
  float surface = smoothstep(0.015, 0.16, hC);
  float slope = smoothstep(0.0015, 0.04, length(normal));
  vec2 cuv = vUv * 4.0 + vel * 0.0012;
  float web = causticWeb(cuv, uTime * 0.5 + 23.0);
  vec3 caustic = clamp(vec3(web) + vec3(0.0, 0.35, 0.5), 0.0, 1.0);
  float energy = pow(web, 1.25) * surface * mix(0.4, 1.0, slope);

  vec3 color = vec3(r, g, b) + caustic * energy * uIntensity * 0.38;
  gl_FragColor = vec4(color, 1.0);
}
`

/** Water surface refraction + procedural caustic web, masked by local fluid activity. */
export class WaterCausticsDistortionPass extends FluidEffectPass {
  intensity = 1
  /** Animation time, in seconds. The caustic web evolves continuously with this. */
  time = 0

  constructor(private readonly fluid: FluidSimulation) {
    super(FRAGMENT, {
      tDiffuse: new Uniform<Texture | null>(null),
      tFluid: new Uniform<Texture | null>(null),
      uIntensity: new Uniform(1),
      uTime: new Uniform(0),
      uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
    })
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    this.material.uniforms.tDiffuse.value = readBuffer.texture
    this.material.uniforms.tFluid.value = this.fluid.densityTexture
    this.material.uniforms.uIntensity.value = this.intensity
    this.material.uniforms.uTime.value = this.time
    const img = this.fluid.densityTexture.image as { width: number; height: number }
    ;(this.material.uniforms.uTexel.value as Vector2).set(1 / img.width, 1 / img.height)
  }
}
