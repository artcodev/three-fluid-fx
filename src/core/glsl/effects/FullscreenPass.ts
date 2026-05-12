import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'

export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export class FullscreenPass {
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly geometry = new BufferGeometry()
  private readonly mesh: Mesh

  constructor(readonly material: ShaderMaterial) {
    this.geometry.setAttribute(
      'position',
      new Float32BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    )
    this.mesh = new Mesh(this.geometry, material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  render(renderer: WebGLRenderer, target: WebGLRenderTarget | null = null): void {
    renderer.setRenderTarget(target)
    renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.scene.remove(this.mesh)
    this.geometry.dispose()
    this.material.dispose()
  }
}
