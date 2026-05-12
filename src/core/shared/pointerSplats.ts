/**
 * Structural shape of any object `attachPointerSplats` will write splats
 * into. Both the GLSL and TSL `FluidSimulation` implementations satisfy
 * this interface, which lets a single pointer-splat helper drive either
 * pipeline without depending on a concrete class.
 */
export interface SplatTarget {
  splatForce: number
  addSplat(
    x01: number,
    y01: number,
    dx: number,
    dy: number,
    options?: { dyeColor?: [number, number, number] },
  ): void
}

export interface AttachPointerSplatsOptions {
  /**
   * When true, splats carry a `dyeColor` (HSV-randomised) into `addSplat`.
   * The fluid sim must have `enableDye` on for the colour to accumulate.
   * The colour rotates *during* a drag (PavelDoGreat behaviour), so a single
   * stroke leaves a multi-hue trail. Defaults to false.
   */
  coloredStrokes?: boolean
  /**
   * Hue rotations per second during a drag, when `coloredStrokes` is on.
   * PavelDoGreat ships 10 (a fresh colour every ~0.1 s). Defaults to 10.
   */
  colorUpdateSpeed?: number
  /**
   * Per-event override for the dye colour. Receives motion delta in CSS px
   * and the event time in ms. Return RGB to write that colour into the dye
   * FBO; return `undefined` to fall back to `coloredStrokes` HSV cycling
   * (or to skip dye if `coloredStrokes` is also off).
   *
   * Use for motion-direction palettes (dreamers-style: red ∝ |dx|, blue ∝
   * |dy|) or any deterministic function of the gesture instead of the
   * default rainbow timer. The colour is written verbatim — scale to the
   * ~0.3 amplitude that other dye-driven overlays in this lib are tuned
   * against if you want to share their gain calibration.
   */
  colorize?: (dx: number, dy: number, timeMs: number) => [number, number, number] | undefined
}

function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  switch (i % 6) {
    case 0: return [v, t, p]
    case 1: return [q, v, p]
    case 2: return [p, v, t]
    case 3: return [p, q, v]
    case 4: return [t, p, v]
    default: return [v, p, q]
  }
}

/**
 * Attaches pointer listeners to `element` and pushes splats into `fluid`.
 *
 * Splat radius and force are read from `fluid.splatRadius` / `fluid.splatForce`
 * on every event — set them in the FluidSimulation constructor or write them
 * any time at runtime; no separate options object is needed here.
 */
export function attachPointerSplats(
  element: HTMLElement,
  fluid: SplatTarget,
  options: AttachPointerSplatsOptions = {},
): () => void {
  const coloredStrokes = options.coloredStrokes ?? false
  const colorUpdateSpeed = options.colorUpdateSpeed ?? 10
  const colorize = options.colorize
  // PavelDoGreat-style: bright but not overwhelming — splats accumulate, so a
  // small base lets continuous strokes ramp up without instant clipping.
  let strokeColor: [number, number, number] = hsv2rgb(Math.random(), 1, 1)
  let colorTimer = 0
  const scaleColor = (c: [number, number, number]): [number, number, number] =>
    [c[0] * 0.3, c[1] * 0.3, c[2] * 0.3]
  let lastX = 0
  let lastY = 0
  let lastTime = 0
  let hasPointer = false
  let lastFireX = 0
  let lastFireY = 0
  let activePointerId = -1
  let rectLeft = 0
  let rectTop = 0
  let rectWidth = 1
  let rectHeight = 1

  const refreshRect = (): void => {
    const rect = element.getBoundingClientRect()
    rectLeft = rect.left
    rectTop = rect.top
    rectWidth = Math.max(1, rect.width)
    rectHeight = Math.max(1, rect.height)
  }
  refreshRect()
  // Layout may not have run yet at attach time — re-measure on the next two
  // animation frames to catch initial CSS sizing.
  requestAnimationFrame(() => {
    refreshRect()
    requestAnimationFrame(refreshRect)
  })

  // ResizeObserver fires when the canvas itself changes size (CSS layout, DPR
  // changes, manual setSize), which window 'resize' does not.
  const ro = new ResizeObserver(refreshRect)
  ro.observe(element)

  const move = (event: PointerEvent): void => {
    if (rectWidth < 4 || rectHeight < 4) {
      refreshRect()
      if (rectWidth < 4 || rectHeight < 4) return
    }

    const now = event.timeStamp || performance.now()
    const gap = now - lastTime
    if (gap > 200) hasPointer = false

    // If the pointer device changed (e.g. trackpad ↔ pen ↔ mouse), reset
    // the baseline so the new device doesn't inherit the previous one's lastXY.
    if (activePointerId !== -1 && event.pointerId !== activePointerId) hasPointer = false
    activePointerId = event.pointerId
    lastTime = now

    // Colour cycles inside a drag (Pavel's `updateColors`): timer ticks at
    // `colorUpdateSpeed` per real second, threshold of 1 → fresh HSV. New
    // strokes also force a fresh colour so two gestures don't end up identical
    // by accident. `gap` is capped so a stale lastTime can't blow the timer.
    const isStrokeStart = !hasPointer
    if (coloredStrokes) {
      colorTimer += Math.min(Math.max(gap, 0), 100) / 1000 * colorUpdateSpeed
      if (isStrokeStart || colorTimer >= 1) {
        if (colorTimer >= 1) colorTimer %= 1
        strokeColor = hsv2rgb(Math.random(), 1, 1)
      }
    }

    const x = (event.clientX - rectLeft) / rectWidth
    const y = 1 - (event.clientY - rectTop) / rectHeight

    // Use movementX/Y from the pointer driver as the authoritative delta.
    // It survives teleport-ed clientX/Y because it represents physical
    // device motion since the previous event.
    const dx = hasPointer ? event.movementX || (event.clientX - lastX) : 0
    const dy = hasPointer ? -(event.movementY || (event.clientY - lastY)) : 0
    lastX = event.clientX
    lastY = event.clientY
    hasPointer = true

    if (Math.abs(dx) + Math.abs(dy) < 0.25) return

    // Physical impossibility filter: real input devices don't move faster
    // than ~5000 px/sec. Anything above ~6500 px/sec is a glitched event
    // (multi-device, coalescing, capture handoff) — drop it and reset.
    const fireDist = lastFireX || lastFireY
      ? Math.hypot(event.clientX - lastFireX, event.clientY - lastFireY)
      : 0
    if (gap > 0 && fireDist / gap > 6.5 && fireDist > 200) {
      hasPointer = false
      lastFireX = event.clientX
      lastFireY = event.clientY
      return
    }

    lastFireX = event.clientX
    lastFireY = event.clientY
    const force = fluid.splatForce
    // Per-event colorize override wins; fall back to HSV-cycle dyeColor when
    // coloredStrokes is on; otherwise no dye is written for this event.
    let dyeColor: [number, number, number] | undefined
    if (colorize) dyeColor = colorize(dx, dy, now)
    if (dyeColor === undefined && coloredStrokes) dyeColor = scaleColor(strokeColor)
    fluid.addSplat(x, y, dx * force, dy * force, dyeColor ? { dyeColor } : undefined)
  }

  const reset = (): void => {
    hasPointer = false
  }

  // pointerout fires when target leaves the hit-test box of `element`,
  // including the case where an overlay (e.g. a control panel) covers it
  // from above with higher z-index. pointerleave alone misses this.
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerout', reset)
  element.addEventListener('pointercancel', reset)
  window.addEventListener('blur', reset)
  document.addEventListener('visibilitychange', reset)
  window.addEventListener('resize', refreshRect)
  window.addEventListener('scroll', refreshRect, { passive: true })

  return () => {
    ro.disconnect()
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerout', reset)
    element.removeEventListener('pointercancel', reset)
    window.removeEventListener('blur', reset)
    document.removeEventListener('visibilitychange', reset)
    window.removeEventListener('resize', refreshRect)
    window.removeEventListener('scroll', refreshRect)
  }
}
