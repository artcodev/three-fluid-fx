import { Color, Uniform, Vector2, type Texture, type WebGLRenderTarget } from 'three'
import { FluidEffectPass } from '../FluidEffectPass'
import type { FluidSimulation } from '../../simulation/FluidSimulation'

// Volumetric haze — same dye alpha as Default/Art Ink, but the cursor tint
// is modulated by a fake surface normal computed from the *gradient of dye
// thickness*. Light from the top-left dips brightness into [0.78, 1.0] —
// never leaves the cursor's hue family, just sculpts each stroke into
// something that reads as 3D. Flat interiors fall back to neutral shade so
// noise doesn't ride on sub-pixel gradients.
const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tDye;
uniform float uIntensity;
uniform vec2 uTexel;
uniform vec3 uCursorColor;
uniform float uVibrance;

vec3 vibrant(vec3 col, float v) {
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(lum), col, 1.0 + v), 0.0, 1.0);
}

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  vec3 dye = texture2D(tDye, vUv).rgb * 0.5;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  dye += texture2D(tDye, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;

  float dL = length(texture2D(tDye, vUv - vec2(uTexel.x * 2.0, 0.0)).rgb);
  float dR = length(texture2D(tDye, vUv + vec2(uTexel.x * 2.0, 0.0)).rgb);
  float dD = length(texture2D(tDye, vUv - vec2(0.0, uTexel.y * 2.0)).rgb);
  float dU = length(texture2D(tDye, vUv + vec2(0.0, uTexel.y * 2.0)).rgb);
  vec2 grad = vec2(dR - dL, dU - dD);
  float gmag = length(grad);
  vec2 ndir = grad / max(gmag, 1e-5);

  float lit = dot(ndir, normalize(vec2(-0.6, 0.8)));
  float strength = smoothstep(0.0, 0.04, gmag);
  float shade = mix(1.0, mix(0.78, 1.0, lit * 0.5 + 0.5), strength);

  float density = clamp(length(dye) * uIntensity * 3.0, 0.0, 0.95);
  vec3 tint = vibrant(uCursorColor, uVibrance) * shade;
  gl_FragColor = vec4(mix(scene, tint, density), 1.0);
}
`

/** Dye haze with fake-normal volumetric shading from the gradient of dye thickness. */
export class VolumeCursorOverlayPass extends FluidEffectPass {
  intensity = 1
  vibrance = 0
  cursorColor: Color

  constructor(private readonly fluid: FluidSimulation) {
    const initialColor = new Color(0.85, 0.95, 1.0)
    super(
      FRAGMENT,
      {
        tDiffuse: new Uniform<Texture | null>(null),
        tDye: new Uniform<Texture | null>(null),
        uIntensity: new Uniform(1),
        uTexel: new Uniform(new Vector2(1 / 512, 1 / 512)),
        uCursorColor: new Uniform(initialColor.clone()),
        uVibrance: new Uniform(0),
      },
    )
    this.cursorColor = initialColor
  }

  protected updateUniforms(readBuffer: WebGLRenderTarget): void {
    const u = this.material.uniforms
    u.tDiffuse.value = readBuffer.texture
    u.tDye.value = this.fluid.dyeTexture
    u.uIntensity.value = this.intensity
    ;(u.uCursorColor.value as Color).copy(this.cursorColor)
    u.uVibrance.value = this.vibrance
    const img = this.fluid.dyeTexture.image as { width: number; height: number }
    ;(u.uTexel.value as Vector2).set(1 / img.width, 1 / img.height)
  }
}
