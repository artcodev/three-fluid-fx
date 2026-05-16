import { Group, Mesh, PlaneGeometry, SRGBColorSpace, Texture, TextureLoader } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { texture as textureFn, uniform, uv, vec2, vec4 } from 'three/tsl'
import { asNode, asTsl, setMaterialOutput } from '../../../tsl/shared/nodeInterop'
function imageAspect(tex) {
  const img = tex.image
  if (img && img.width && img.height) return img.width / img.height
  return 1
}
export class Slideshow {
  constructor(options) {
    Object.defineProperty(this, 'mesh', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new Group(),
    })
    Object.defineProperty(this, 'camera', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'paths', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'cycleInterval', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'fadeDuration', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'slides', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'geometry', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: new PlaneGeometry(1, 1),
    })
    Object.defineProperty(this, 'viewAspect', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(1),
    })
    Object.defineProperty(this, 'slotA', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'slotB', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'currentSlide', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0,
    })
    Object.defineProperty(this, 'currentOpacity', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 1,
    })
    Object.defineProperty(this, 'cycleAccumulator', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0,
    })
    Object.defineProperty(this, 'cyclingStarted', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: false,
    })
    Object.defineProperty(this, 'fadeElapsed', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 0,
    })
    Object.defineProperty(this, 'fading', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: false,
    })
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
  update(dt) {
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
  setOpacity(opacity) {
    this.currentOpacity = Math.min(Math.max(opacity, 0), 1)
    this.applySlotOpacity(this.slotA)
    this.applySlotOpacity(this.slotB)
    this.mesh.visible = this.cyclingStarted && this.currentOpacity > 0.001
  }
  dispose() {
    for (const tex of this.slides) tex?.dispose()
    this.slotA.material.dispose()
    this.slotB.material.dispose()
    this.geometry.dispose()
  }
  createSlot(opacity) {
    const placeholder = new Texture()
    const image = textureFn(placeholder)
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
  createMaterial(image, imageAspectNode, opacityNode) {
    const material = new MeshBasicNodeMaterial()
    material.depthWrite = false
    material.depthTest = false
    material.transparent = true
    material.toneMapped = false
    setMaterialOutput(material, this.buildOutputNode(image, imageAspectNode, opacityNode))
    return material
  }
  setSlotTexture(slot, tex) {
    const oldMaterial = slot.material
    slot.texture = tex
    slot.image = textureFn(tex)
    slot.imageAspect = uniform(imageAspect(tex))
    slot.opacity = uniform(slot.opacityValue * this.currentOpacity)
    slot.material = this.createMaterial(slot.image, slot.imageAspect, slot.opacity)
    slot.mesh.material = slot.material
    oldMaterial.dispose()
    this.applySlotOpacity(slot)
  }
  setSlotOpacity(slot, opacity) {
    slot.opacityValue = Math.min(Math.max(opacity, 0), 1)
    this.applySlotOpacity(slot)
  }
  applySlotOpacity(slot) {
    const effective = slot.opacityValue * this.currentOpacity
    slot.opacity.value = effective
    slot.mesh.visible = Boolean(slot.texture) && effective > 0.001
  }
  buildOutputNode(image, imageAspectNode, opacityNode) {
    const coverUv = () => {
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
  startFadeTo(tex) {
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
