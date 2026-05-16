import {
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Uniform,
} from 'three'
import type { Background } from '../Background'

// Cover-fit cross-fade between two slide textures. The mesh is sized to
// exactly cover the camera frustum (so vUv 0..1 maps to the visible area),
// and the shader crops along the longer image axis so each slide fills the
// viewport without stretching.
const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tImageA;
uniform sampler2D tImageB;
uniform float uImageAspectA;
uniform float uImageAspectB;
uniform float uViewAspect;
uniform float uMix;
uniform float uOpacity;

vec2 coverUv(vec2 uv, float imageAspect, float viewAspect) {
  if (imageAspect > viewAspect) {
    float crop = viewAspect / imageAspect;
    return vec2((uv.x - 0.5) * crop + 0.5, uv.y);
  }
  float crop = imageAspect / viewAspect;
  return vec2(uv.x, (uv.y - 0.5) * crop + 0.5);
}

void main() {
  vec4 a = texture2D(tImageA, coverUv(vUv, uImageAspectA, uViewAspect));
  vec4 b = texture2D(tImageB, coverUv(vUv, uImageAspectB, uViewAspect));
  vec4 color = mix(a, b, uMix);
  gl_FragColor = vec4(color.rgb, color.a * uOpacity);
}
`

export interface SlideshowOptions {
  camera: PerspectiveCamera
  paths: readonly string[]
  /** Seconds each slide stays on screen between fades. Default: 6. */
  cycleInterval?: number
  /** Seconds for each cross-fade between slides. Default: 1.8. */
  fadeDuration?: number
}

function imageAspect(tex: Texture): number {
  const img = tex.image as { width: number; height: number } | undefined
  if (img && img.width && img.height) return img.width / img.height
  return 1
}

/**
 * Auto-cycling slideshow background. Loads images in parallel, cross-fades
 * between them on a fixed dwell interval, sized to cover the camera frustum
 * (sits behind everything else: `depthTest: false`, `position.z = -3`).
 *
 * Add the `mesh` to a scene and call `update(dt, elapsed)` once per frame.
 */
export class Slideshow implements Background {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>
  readonly material: ShaderMaterial

  private readonly camera: PerspectiveCamera
  private readonly paths: readonly string[]
  private readonly cycleInterval: number
  private readonly fadeDuration: number

  private readonly slides: Array<Texture | null>
  private currentSlide = 0
  private currentOpacity = 1
  private cycleAccumulator = 0
  private cyclingStarted = false
  private fadeElapsed = 0
  private fading = false

  /**
   * @param options Slideshow setup — camera (for cover-fit), image paths,
   *   and timing of the cycle/fade.
   */
  constructor(options: SlideshowOptions) {
    this.camera = options.camera
    this.paths = options.paths
    this.cycleInterval = options.cycleInterval ?? 6
    this.fadeDuration = options.fadeDuration ?? 1.8

    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tImageA: new Uniform<Texture | null>(null),
        tImageB: new Uniform<Texture | null>(null),
        uImageAspectA: new Uniform(1),
        uImageAspectB: new Uniform(1),
        uViewAspect: new Uniform(1),
        uMix: new Uniform(0),
        uOpacity: new Uniform(1),
      },
      depthWrite: false,
      depthTest: false,
      transparent: true,
      toneMapped: false,
    })
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material)
    this.mesh.position.z = -3
    // Hidden until the first slide finishes loading — avoids a black/garbage
    // frame flash before any texture is bound.
    this.mesh.visible = false

    this.slides = this.paths.map(() => null)

    // Preload all slides in parallel. The first slide to land at index 0
    // kicks off the show; out-of-order loads just sit in the array.
    const loader = new TextureLoader()
    this.paths.forEach((path, i) => {
      loader.loadAsync(path).then(
        (tex) => {
          tex.colorSpace = SRGBColorSpace
          this.slides[i] = tex
          if (i === this.currentSlide && !this.cyclingStarted) {
            // First slide ever — both slots point at it, no fade.
            const u = this.material.uniforms
            u.tImageA.value = tex
            u.tImageB.value = tex
            u.uImageAspectA.value = imageAspect(tex)
            u.uImageAspectB.value = imageAspect(tex)
            u.uMix.value = 0
            this.mesh.visible = this.currentOpacity > 0.001
            this.cyclingStarted = true
            this.cycleAccumulator = 0
          }
        },
        (err) => console.error(`Failed to load ${path}`, err),
      )
    })
  }

  setOpacity(opacity: number): void {
    const value = Math.min(Math.max(opacity, 0), 1)
    this.currentOpacity = value
    this.material.uniforms.uOpacity.value = value
    this.mesh.visible = this.cyclingStarted && value > 0.001
  }

  /** Advance fade and cycle timers; resize plane to cover the camera frustum. */
  update(dt: number): void {
    const u = this.material.uniforms
    // Resize plane to exactly cover the camera frustum at its z-position.
    // Same trick as backdrop.ts — once the mesh fills the visible area,
    // vUv 0..1 maps to the visible region and the shader handles cover-fit.
    const distance = this.camera.position.z - this.mesh.position.z
    const fov = (this.camera.fov * Math.PI) / 180
    const visibleHeight = 2 * Math.tan(fov / 2) * distance
    this.mesh.scale.set(visibleHeight * this.camera.aspect, visibleHeight, 1)
    u.uViewAspect.value = this.camera.aspect

    if (this.fading) {
      this.fadeElapsed += dt
      const t = Math.min(this.fadeElapsed / this.fadeDuration, 1)
      // Smoothstep gives an ease-in-out feel; linear looks abrupt at the edges.
      u.uMix.value = t * t * (3 - 2 * t)
      if (t >= 1) {
        // Move B → A so the next fade starts from the now-stable image.
        u.tImageA.value = u.tImageB.value
        u.uImageAspectA.value = u.uImageAspectB.value
        u.uMix.value = 0
        this.fading = false
      }
    }

    if (!this.cyclingStarted) return
    this.cycleAccumulator += dt
    if (this.cycleAccumulator >= this.cycleInterval) {
      const next = (this.currentSlide + 1) % this.paths.length
      const nextTex = this.slides[next]
      if (nextTex) {
        this.currentSlide = next
        this.cycleAccumulator -= this.cycleInterval
        this.startFadeTo(nextTex)
      }
      // If the next slide hasn't loaded yet, leave the accumulator past
      // cycleInterval so we retry next frame the moment it's ready.
    }
  }

  dispose(): void {
    for (const tex of this.slides) tex?.dispose()
    this.mesh.geometry.dispose()
    this.material.dispose()
  }

  private startFadeTo(tex: Texture): void {
    const u = this.material.uniforms
    // If a fade is already in flight, snap it to completion before starting
    // the new one — the previous "from" image is no longer interesting.
    if (this.fading) {
      u.tImageA.value = u.tImageB.value
      u.uImageAspectA.value = u.uImageAspectB.value
    }
    u.tImageB.value = tex
    u.uImageAspectB.value = imageAspect(tex)
    u.uMix.value = 0
    this.fadeElapsed = 0
    this.fading = true
  }
}
