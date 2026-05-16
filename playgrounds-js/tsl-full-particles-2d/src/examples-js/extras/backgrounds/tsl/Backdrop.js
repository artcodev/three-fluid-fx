import { Color, Mesh, PlaneGeometry, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  cameraPosition,
  modelWorldMatrix,
  mx_fractal_noise_float,
  positionLocal,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import {
  asNode,
  asTsl,
  setMaterialOutput,
  setMaterialPosition,
} from '../../../tsl/shared/nodeInterop'
const THEMES = {
  dark: {
    base: '#04060a',
    lightA: '#8c002e',
    lightB: '#1a40c8',
    shininess: 30,
    specStrength: 0.7,
    diffStrength: 0.28,
  },
  bright: {
    base: '#b02898',
    lightA: '#ff0070',
    lightB: '#5020e8',
    shininess: 22,
    specStrength: 0.7,
    diffStrength: 0.42,
  },
}
const SEGMENTS_Y = 12
export class Backdrop {
  constructor(camera, theme = 'dark') {
    Object.defineProperty(this, 'camera', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: camera,
    })
    Object.defineProperty(this, 'material', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'mesh', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'time', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(0),
    })
    Object.defineProperty(this, 'opacity', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(1),
    })
    Object.defineProperty(this, 'lightAPos', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(new Vector3()),
    })
    Object.defineProperty(this, 'lightBPos', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(new Vector3()),
    })
    Object.defineProperty(this, 'baseColor', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(new Color()),
    })
    Object.defineProperty(this, 'lightAColor', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(new Color()),
    })
    Object.defineProperty(this, 'lightBColor', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(new Color()),
    })
    Object.defineProperty(this, 'shininess', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(30),
    })
    Object.defineProperty(this, 'specStrength', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(0.7),
    })
    Object.defineProperty(this, 'diffStrength', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: uniform(0.28),
    })
    Object.defineProperty(this, 'segX', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 1,
    })
    Object.defineProperty(this, 'segY', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: SEGMENTS_Y,
    })
    this.material = new MeshBasicNodeMaterial()
    this.material.depthWrite = false
    this.material.depthTest = false
    this.material.transparent = true
    this.material.toneMapped = false
    const pos = asTsl(positionLocal)
    const time = asTsl(this.time)
    const noiseUv = vec2(pos.x.mul(1.3).add(time.mul(0.05)), pos.y.mul(1.3).add(time.mul(0.03)))
    const height = asTsl(mx_fractal_noise_float)(vec3(noiseUv, 0), 4, 2, 0.5, 0.45)
    const surfaceLocal = pos.add(vec3(0, 0, height))
    const worldPos = asTsl(modelWorldMatrix)
      .mul(vec4(surfaceLocal, 1))
      .xyz.toVarying('vBackdropWorldPos')
    const viewDir = asTsl(cameraPosition).sub(worldPos).normalize()
    const rawNormal = worldPos.dFdx().cross(worldPos.dFdy()).normalize()
    const normal = rawNormal.dot(viewDir).lessThan(0).select(rawNormal.negate(), rawNormal)
    const lightA = asTsl(this.lightAPos).sub(worldPos).normalize()
    const halfA = lightA.add(viewDir).normalize()
    const diffA = normal.dot(lightA).max(0)
    const specA = normal.dot(halfA).max(0).pow(asTsl(this.shininess))
    const lightB = asTsl(this.lightBPos).sub(worldPos).normalize()
    const halfB = lightB.add(viewDir).normalize()
    const diffB = normal.dot(lightB).max(0)
    const specB = normal.dot(halfB).max(0).pow(asTsl(this.shininess))
    const color = asTsl(this.baseColor)
      .add(
        asTsl(this.lightAColor).mul(
          diffA.mul(asTsl(this.diffStrength)).add(specA.mul(asTsl(this.specStrength))),
        ),
      )
      .add(
        asTsl(this.lightBColor).mul(
          diffB.mul(asTsl(this.diffStrength)).add(specB.mul(asTsl(this.specStrength))),
        ),
      )
      .clamp(0, 1)
    setMaterialPosition(this.material, asNode(surfaceLocal))
    setMaterialOutput(this.material, vec4(color, asTsl(this.opacity)))
    this.mesh = new Mesh(new PlaneGeometry(1, 1, 1, SEGMENTS_Y), this.material)
    this.mesh.position.z = -3
    this.mesh.renderOrder = -1000
    this.setTheme(theme)
  }
  setTheme(theme) {
    const t = THEMES[theme]
    this.baseColor.value.set(t.base)
    this.lightAColor.value.set(t.lightA)
    this.lightBColor.value.set(t.lightB)
    this.shininess.value = t.shininess
    this.specStrength.value = t.specStrength
    this.diffStrength.value = t.diffStrength
  }
  update(_dt, elapsed) {
    this.ensureSegments(this.camera.aspect)
    const distance = this.camera.position.z - this.mesh.position.z
    const fov = (this.camera.fov * Math.PI) / 180
    const visibleHeight = 2 * Math.tan(fov / 2) * distance
    const overscan = 1.4
    this.mesh.scale.set(visibleHeight * this.camera.aspect * overscan, visibleHeight * overscan, 1)
    this.time.value = elapsed
    const angle = elapsed * 0.15
    const x = Math.cos(angle) * 4.5
    const y = Math.sin(angle) * 2.5
    this.lightAPos.value.set(x, y, -1.5)
    this.lightBPos.value.set(-x, -y, -1.5)
  }
  setOpacity(opacity) {
    const value = Math.min(Math.max(opacity, 0), 1)
    this.opacity.value = value
    this.mesh.visible = value > 0.001
  }
  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
  ensureSegments(aspect) {
    const targetX = Math.max(1, Math.round(SEGMENTS_Y * aspect))
    if (targetX === this.segX && SEGMENTS_Y === this.segY) return
    this.segX = targetX
    this.segY = SEGMENTS_Y
    this.mesh.geometry.dispose()
    this.mesh.geometry = new PlaneGeometry(1, 1, targetX, SEGMENTS_Y)
  }
}
