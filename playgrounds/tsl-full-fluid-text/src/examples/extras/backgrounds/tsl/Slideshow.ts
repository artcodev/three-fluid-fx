import {
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three'
import { MeshBasicNodeMaterial, type TextureNode } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { texture as textureFn, uniform, uv, vec2, vec4 } from 'three/tsl'
import type { Background } from '../Background'
import {
  asNode,
  asTsl,
  setMaterialOutput,
  type UniformValue,
} from '../../../tsl/shared/nodeInterop'

export interface SlideshowOptions {
  camera: PerspectiveCamera
  paths: readonly string[]
  cycleInterval?: number
  fadeDuration?: number
}

interface SlideSlot {
  image: TextureNode
  imageAspect: UniformValue<number>
  opacity: UniformValue<number>
  opacityValue: number
  texture: Texture | null
  material: MeshBasicNodeMaterial
  mesh: Mesh<PlaneGeometry, MeshBasicNodeMaterial>
}

function imageAspect(tex: Texture): number {
  const img = tex.image as { width: number; height: number } | undefined
  if (img && img.width && img.height) return img.width / img.height
  return 1
}

export class Slideshow implements Background {
  readonly mesh = new Group()

  private readonly camera: PerspectiveCamera
  private readonly paths: readonly string[]
  private readonly cycleInterval: number
  private readonly fadeDuration: number
  private readonly slides: Array<Texture | null>
  private readonly geometry = new PlaneGeometry(1, 1)
  private readonly viewAspect = uniform(1)
  private readonly slotA: SlideSlot
  private readonly slotB: SlideSlot

  private currentSlide = 0
  private currentOpacity = 1
  private cycleAccumulator = 0
  private cyclingStarted = false
  private fadeElapsed = 0
  private fading = false

  constructor(options: SlideshowOptions) {
    this.camera = options.camera
    this.paths = options.paths
    this.cycleInterval = options.cycleInterval ?? 6
    this.fadeDuration = options.fadeDuration ?? 1.8

    this.slotA = this.createSlot(1)
    this.slotB = this.createSlot(0)
    this.slotA.mesh.renderOrder = -1001
    this.slotB.mesh.renderOrder = -1000
    this.mesh.add(this.slotA.mesh, this.slotB.mesh)
    this.mesh.position.z = -3
    this.mesh.renderOrder = -1000
    this.mesh.visible = false

    this.slides = this.paths.map(() => null)
    const loader = new TextureLoader()
    this.paths.forEach((path, i) => {
      loader.loadAsync(path).then(
        (tex) => {
          tex.colorSpace = SRGBColorSpace
          this.slides[i] = tex
          if (i === this.currentSlide && !this.cyclingStarted) {
            this.setSlotTexture(this.slotA, tex)
            this.setSlotTexture(this.slotB, tex)
            this.setSlotOpacity(this.slotA, 1)
            this.setSlotOpacity(this.slotB, 0)
            this.mesh.visible = this.currentOpacity > 0.001
            this.cyclingStarted = true
            this.cycleAccumulator = 0
          }
        },
        (err) => console.error(`Failed to load ${path}`, err),
      )
    })
  }

  update(dt: number): void {
    const distance = this.camera.position.z - this.mesh.position.z
    const fov = (this.camera.fov * Math.PI) / 180
    const visibleHeight = 2 * Math.tan(fov / 2) * distance
    this.mesh.scale.set(visibleHeight * this.camera.aspect, visibleHeight, 1)
    this.viewAspect.value = this.camera.aspect

    if (this.fading) {
      this.fadeElapsed += dt
      const t = Math.min(this.fadeElapsed / this.fadeDuration, 1)
      const eased = t * t * (3 - 2 * t)
      this.setSlotOpacity(this.slotA, 1 - eased)
      this.setSlotOpacity(this.slotB, eased)

      if (t >= 1) {
        const nextTexture = this.slotB.texture
        if (nextTexture) this.setSlotTexture(this.slotA, nextTexture)
        this.setSlotOpacity(this.slotA, 1)
        this.setSlotOpacity(this.slotB, 0)
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
    }
  }

  setOpacity(opacity: number): void {
    this.currentOpacity = Math.min(Math.max(opacity, 0), 1)
    this.applySlotOpacity(this.slotA)
    this.applySlotOpacity(this.slotB)
    this.mesh.visible = this.cyclingStarted && this.currentOpacity > 0.001
  }

  dispose(): void {
    for (const tex of this.slides) tex?.dispose()
    this.slotA.material.dispose()
    this.slotB.material.dispose()
    this.geometry.dispose()
  }

  private createSlot(opacity: number): SlideSlot {
    const placeholder = new Texture()
    const image = textureFn(placeholder) as TextureNode
    const imageAspectNode = uniform(1)
    const opacityNode = uniform(opacity)
    const material = this.createMaterial(image, imageAspectNode, opacityNode)
    const mesh = new Mesh(this.geometry, material)
    mesh.visible = false
    return {
      image,
      imageAspect: imageAspectNode,
      opacity: opacityNode,
      opacityValue: opacity,
      texture: null,
      material,
      mesh,
    }
  }

  private createMaterial(
    image: TextureNode,
    imageAspectNode: UniformValue<number>,
    opacityNode: UniformValue<number>,
  ): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial()
    material.depthWrite = false
    material.depthTest = false
    material.transparent = true
    material.toneMapped = false
    setMaterialOutput(material, this.buildOutputNode(image, imageAspectNode, opacityNode))
    return material
  }

  private setSlotTexture(slot: SlideSlot, tex: Texture): void {
    const oldMaterial = slot.material
    slot.texture = tex
    slot.image = textureFn(tex) as TextureNode
    slot.imageAspect = uniform(imageAspect(tex))
    slot.opacity = uniform(slot.opacityValue * this.currentOpacity)
    slot.material = this.createMaterial(slot.image, slot.imageAspect, slot.opacity)
    slot.mesh.material = slot.material
    oldMaterial.dispose()
    this.applySlotOpacity(slot)
  }

  private setSlotOpacity(slot: SlideSlot, opacity: number): void {
    slot.opacityValue = Math.min(Math.max(opacity, 0), 1)
    this.applySlotOpacity(slot)
  }

  private applySlotOpacity(slot: SlideSlot): void {
    const effective = slot.opacityValue * this.currentOpacity
    slot.opacity.value = effective
    slot.mesh.visible = Boolean(slot.texture) && effective > 0.001
  }

  private buildOutputNode(
    image: TextureNode,
    imageAspectNode: UniformValue<number>,
    opacityNode: UniformValue<number>,
  ): Node {
    const coverUv = (): Node => {
      const baseUv = asTsl(uv())
      const imageAspect = asTsl(imageAspectNode)
      const viewAspect = asTsl(this.viewAspect)
      const wider = imageAspect.greaterThan(viewAspect)
      const cropX = viewAspect.div(imageAspect)
      const cropY = imageAspect.div(viewAspect)
      const uvX = baseUv.x.sub(0.5).mul(cropX).add(0.5)
      const uvY = baseUv.y.sub(0.5).mul(cropY).add(0.5)
      const wide = vec2(uvX, baseUv.y)
      const tall = vec2(baseUv.x, uvY)
      return wider.select(wide, tall)
    }

    const sample = asTsl(image).sample(coverUv())
    return asNode(vec4(sample.rgb, sample.a.mul(asTsl(opacityNode))))
  }

  private startFadeTo(tex: Texture): void {
    if (this.fading) {
      const current = this.slotB.texture
      if (current) this.setSlotTexture(this.slotA, current)
    }

    this.setSlotTexture(this.slotB, tex)
    this.setSlotOpacity(this.slotA, 1)
    this.setSlotOpacity(this.slotB, 0)
    this.fadeElapsed = 0
    this.fading = true
  }
}
