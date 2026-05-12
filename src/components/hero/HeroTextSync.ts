import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
} from 'three'

interface TextElementMap {
  el: HTMLElement
  color: string
  alpha: number
}

const TEXT_PLANE_Z = 0

export class HeroTextSync {
  private readonly canvas = document.createElement('canvas')
  private readonly ctx = this.canvas.getContext('2d')
  private texture = this.createTexture()
  private readonly geometry = new PlaneGeometry(1, 1)
  private readonly material = new MeshBasicMaterial({
    map: this.texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  })
  private readonly mesh = new Mesh(this.geometry, this.material)
  private readonly textMaps: TextElementMap[] = []

  constructor(
    private readonly canvasHost: HTMLElement,
    private readonly heroSection: HTMLElement,
    private readonly scene: Scene,
  ) {
    if (!this.ctx) throw new Error('HeroTextSync requires CanvasRenderingContext2D')

    this.mesh.frustumCulled = false
    this.mesh.position.z = TEXT_PLANE_Z

    this.initTexts()
    this.scene.add(this.mesh)
  }

  get elements(): readonly HTMLElement[] {
    return this.textMaps.map(({ el }) => el)
  }

  sync(worldWidth: number, worldHeight: number): Promise<void> {
    const ctx = this.ctx
    if (!ctx) return Promise.resolve()

    const hostRect = this.canvasHost.getBoundingClientRect()
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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fontKerning = 'normal'

    for (const map of this.textMaps) {
      this.drawElement(ctx, map, hostRect)
    }

    this.texture.needsUpdate = true
    this.mesh.scale.set(worldWidth, worldHeight, 1)
    this.mesh.position.set(0, 0, TEXT_PLANE_Z)
    this.mesh.updateMatrixWorld(true)
    return Promise.resolve()
  }

  dispose(): void {
    if (this.mesh.parent) this.scene.remove(this.mesh)
    this.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
  }

  private createTexture(): CanvasTexture {
    const texture = new CanvasTexture(this.canvas)
    texture.colorSpace = SRGBColorSpace
    texture.generateMipmaps = false
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    return texture
  }

  private replaceTexture(): void {
    const previousTexture = this.texture
    this.texture = this.createTexture()
    this.material.map = this.texture
    this.material.needsUpdate = true
    previousTexture.dispose()
  }

  private initTexts(): void {
    const elements = [
      this.heroSection.querySelector('h1'),
      this.heroSection.querySelector('.examples-lead'),
      this.heroSection.querySelector('.examples-support'),
    ].filter((element): element is HTMLElement => element instanceof HTMLElement)

    for (const element of elements) {
      const style = window.getComputedStyle(element)
      const color = this.parseCssColor(style.color)
      this.textMaps.push({ el: element, color: color.rgb, alpha: color.alpha })
    }
  }

  private drawElement(ctx: CanvasRenderingContext2D, map: TextElementMap, hostRect: DOMRect): void {
    const { el } = map
    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    const fontSize = parseFloat(style.fontSize) || 16
    const lineHeightPx = parseFloat(style.lineHeight)
    const lineHeight = Number.isFinite(lineHeightPx) ? lineHeightPx : fontSize * 1.18
    const maxWidth = Math.max(1, rect.width)
    const text = el.innerText.replace(/\s+/g, ' ').trim()
    const lines = this.wrapText(ctx, text, maxWidth, this.getCanvasFont(style))
    const x = rect.left - hostRect.left
    let y = rect.top - hostRect.top

    ctx.save()
    ctx.font = this.getCanvasFont(style)
    ctx.fillStyle = map.color
    ctx.globalAlpha = map.alpha

    for (const line of lines) {
      ctx.fillText(line, x, y)
      y += lineHeight
    }
    ctx.restore()
  }

  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    font: string,
  ): string[] {
    ctx.save()
    ctx.font = font

    const words = text.split(' ')
    const lines: string[] = []
    let line = ''

    for (const word of words) {
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

  private getCanvasFont(style: CSSStyleDeclaration): string {
    return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  }

  private parseCssColor(color: string): { rgb: string; alpha: number } {
    const match = color.match(/^rgba?\(([^)]+)\)$/)
    if (!match) return { rgb: color, alpha: 1 }

    const parts = match[1].split(',').map((part) => part.trim())
    const [r = '255', g = '255', b = '255', a = '1'] = parts
    return {
      rgb: `rgb(${r}, ${g}, ${b})`,
      alpha: Math.min(1, Math.max(0, Number.parseFloat(a) || 1)),
    }
  }
}
