import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three'
export class DomTextPlane {
  constructor(host, elements) {
    Object.defineProperty(this, 'host', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: host,
    })
    Object.defineProperty(this, 'mesh', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'canvas', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: document.createElement('canvas'),
    })
    Object.defineProperty(this, 'ctx', {
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
    Object.defineProperty(this, 'material', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'sources', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    Object.defineProperty(this, 'texture', {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0,
    })
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('DomTextPlane requires CanvasRenderingContext2D')
    this.ctx = ctx
    this.texture = this.createTexture()
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    })
    this.mesh = new Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.sources = elements.map((element) => {
      const color = parseCssColor(window.getComputedStyle(element).color)
      return { element, color: color.rgb, alpha: color.alpha }
    })
  }
  sync(worldWidth, worldHeight) {
    const hostRect = this.host.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(hostRect.width))
    const height = Math.max(1, Math.round(hostRect.height))
    const pixelWidth = Math.max(1, Math.round(width * dpr))
    const pixelHeight = Math.max(1, Math.round(height * dpr))
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth
      this.canvas.height = pixelHeight
      this.replaceTexture()
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.ctx.clearRect(0, 0, width, height)
    this.ctx.textAlign = 'left'
    this.ctx.textBaseline = 'top'
    this.ctx.fontKerning = 'normal'
    for (const source of this.sources) {
      this.drawElement(source, hostRect)
    }
    this.texture.needsUpdate = true
    this.mesh.scale.set(worldWidth, worldHeight, 1)
    this.mesh.position.set(0, 0, 0)
    this.mesh.updateMatrixWorld(true)
  }
  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh)
    this.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
  }
  drawElement(source, hostRect) {
    const { element } = source
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    const font = getCanvasFont(style)
    const fontSize = parseFloat(style.fontSize) || 16
    const lineHeightPx = parseFloat(style.lineHeight)
    const lineHeight = Number.isFinite(lineHeightPx) ? lineHeightPx : fontSize * 1.18
    const maxWidth = Math.max(1, rect.width)
    const textAlign = getCanvasTextAlign(style.textAlign)
    const lines = wrapText(this.ctx, element.innerText.replace(/\s+/g, ' ').trim(), maxWidth, font)
    const x =
      textAlign === 'center'
        ? rect.left - hostRect.left + rect.width / 2
        : textAlign === 'right' || textAlign === 'end'
          ? rect.right - hostRect.left
          : rect.left - hostRect.left
    let y = rect.top - hostRect.top
    this.ctx.save()
    this.ctx.font = font
    this.ctx.textAlign = textAlign
    this.ctx.fillStyle = source.color
    this.ctx.globalAlpha = source.alpha
    for (const line of lines) {
      this.ctx.fillText(line, x, y, maxWidth)
      y += lineHeight
    }
    this.ctx.restore()
  }
  createTexture() {
    const texture = new CanvasTexture(this.canvas)
    texture.colorSpace = SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    return texture
  }
  replaceTexture() {
    const previousTexture = this.texture
    this.texture = this.createTexture()
    this.material.map = this.texture
    this.material.needsUpdate = true
    previousTexture.dispose()
  }
}
function wrapText(ctx, text, maxWidth, font) {
  ctx.save()
  ctx.font = font
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  ctx.restore()
  return lines
}
function getCanvasFont(style) {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
}
function getCanvasTextAlign(value) {
  if (
    value === 'left' ||
    value === 'right' ||
    value === 'center' ||
    value === 'start' ||
    value === 'end'
  ) {
    return value
  }
  return 'left'
}
function parseCssColor(color) {
  const match = color.match(/^rgba?\(([^)]+)\)$/)
  if (!match) return { rgb: color, alpha: 1 }
  const [r = '255', g = '255', b = '255', a = '1'] = match[1]
    .replace(/\//g, ' ')
    .split(/[,\s]+/)
    .filter(Boolean)
  return {
    rgb: `rgb(${r}, ${g}, ${b})`,
    alpha: Math.min(1, Math.max(0, Number.parseFloat(a) || 1)),
  }
}
