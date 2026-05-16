export const DEMO_REEL_SEQUENCE_SECONDS = 15.9
export const DEMO_REEL_SINGLE_SEQUENCE_SECONDS = 3.2
export const DEMO_REEL_REPEAT_PAUSE_SECONDS = 5
export const DEMO_REEL_DURATION_SECONDS =
  DEMO_REEL_SEQUENCE_SECONDS * 2 + DEMO_REEL_REPEAT_PAUSE_SECONDS + 1
export const DEMO_REEL_TRANSITION_SECONDS = 0.55
export const DEMO_SINGLE_MOTIONS = [
  'sSweep',
  'spiralBloom',
  'softWhip',
  'breathingOrbit',
  'diagonalReveal',
  'sweepSpiral',
  'infinity',
] as const
export const DEMO_MOTIONS = ['all', ...DEMO_SINGLE_MOTIONS] as const
type DemoSingleMotion = (typeof DEMO_SINGLE_MOTIONS)[number]
export type DemoMotion = (typeof DEMO_MOTIONS)[number]
const DEMO_MOTION_ALIASES: Record<string, DemoMotion> = {
  's-sweep': 'sSweep',
  'spiral-bloom': 'spiralBloom',
  'soft-whip': 'softWhip',
  'breathing-orbit': 'breathingOrbit',
  'diagonal-reveal': 'diagonalReveal',
  'sweep-spiral': 'sweepSpiral',
}

interface DemoSplatOptions {
  radius?: number
  color?: [number, number, number]
  dyeColor?: [number, number, number]
}

interface DemoSplatTarget {
  splatForce: number
  addSplat(x01: number, y01: number, dx: number, dy: number, options?: DemoSplatOptions): void
}

interface DemoPoint {
  x: number
  y: number
}

export interface DemoReelRuntime {
  enabled: boolean
  label: string
  elapsed: () => number
  manual: boolean
}

export interface DemoSplatDriverOptions {
  durationSeconds?: number
  leadInSeconds?: number
  outroSeconds?: number
  motion?: DemoMotion
  motionSequenceSeconds?: number
  motionPauseSeconds?: number
  repeatPauseSeconds?: number
  coloredStrokes?: boolean
  forceScale?: number
  colorize?: (
    dxCss: number,
    dyCss: number,
    elapsedSeconds: number,
    normalizedTime: number,
  ) => [number, number, number] | undefined
}

declare global {
  interface Window {
    __fluidDemoReady?: boolean
    __fluidDemoStarted?: boolean
    __fluidDemoStart?: () => void
  }
}

function demoSearchParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

export function isDemoReelMode(): boolean {
  const value = demoSearchParams().get('demo')
  return value === '1' || value === 'true' || value === 'reel'
}

export function resolveDemoChoice<T extends string>(
  param: string,
  valid: readonly T[],
  fallback: T,
): T {
  const value = demoSearchParams().get(param)
  if (value && (valid as readonly string[]).includes(value)) return value as T
  return fallback
}

function resolveDemoMotion(fallback: DemoMotion): DemoMotion {
  const value = demoSearchParams().get('motion')
  if (!value) return fallback
  const canonical = DEMO_MOTION_ALIASES[value] ?? value
  if ((DEMO_MOTIONS as readonly string[]).includes(canonical)) return canonical as DemoMotion
  return fallback
}

export function setupDemoReel(defaultLabel: string): DemoReelRuntime {
  if (!isDemoReelMode()) {
    return {
      enabled: false,
      label: defaultLabel,
      manual: true,
      elapsed: () => 0,
    }
  }

  const params = demoSearchParams()
  const label = params.get('label') || defaultLabel
  let startedAt = -1

  const start = (): void => {
    startedAt = performance.now()
    window.__fluidDemoStarted = true
  }

  const pageRuntime = window as typeof window & {
    __fluidExamplePage?: {
      setDemoMode?: (label: string) => void
    }
  }
  if (pageRuntime.__fluidExamplePage?.setDemoMode) {
    pageRuntime.__fluidExamplePage.setDemoMode(label)
  } else {
    document.body.classList.add('is-demo-reel')
    const badge = document.createElement('div')
    badge.className = 'demo-reel-label'
    badge.textContent = label
    document.body.appendChild(badge)
  }

  window.__fluidDemoReady = true
  window.__fluidDemoStarted = false
  window.__fluidDemoStart = start

  if (params.get('demoStart') !== 'manual') requestAnimationFrame(start)

  return {
    enabled: true,
    label,
    manual: false,
    elapsed: () => (startedAt < 0 ? -1 : (performance.now() - startedAt) / 1000),
  }
}

export function attachDemoManualTakeover(
  demo: DemoReelRuntime,
  element: HTMLElement,
  attachManualControl: () => () => void,
): () => void {
  if (!demo.enabled) return attachManualControl()

  const hint = document.createElement('div')
  hint.className = 'demo-manual-control-hint'
  hint.textContent = 'Click to take control'
  document.body.appendChild(hint)

  let detachManualControl: (() => void) | undefined
  let disposed = false

  const positionHint = (event: PointerEvent): void => {
    hint.style.left = `${event.clientX}px`
    hint.style.top = `${event.clientY}px`
  }

  const showHint = (event: PointerEvent): void => {
    positionHint(event)
    hint.classList.add('is-visible')
  }

  const hideHint = (): void => {
    hint.classList.remove('is-visible')
  }

  const enableManualControl = (): void => {
    if (disposed || demo.manual) return
    demo.enabled = false
    demo.manual = true
    window.__fluidDemoStarted = false
    hideHint()
    hint.remove()
    detachManualControl = attachManualControl()
    element.removeEventListener('pointerenter', showHint)
    element.removeEventListener('pointermove', positionHint)
    element.removeEventListener('pointerleave', hideHint)
    element.removeEventListener('pointerdown', enableManualControl)
    element.removeEventListener('click', enableManualControl)
  }

  element.addEventListener('pointerenter', showHint)
  element.addEventListener('pointermove', positionHint)
  element.addEventListener('pointerleave', hideHint)
  element.addEventListener('pointerdown', enableManualControl)
  element.addEventListener('click', enableManualControl)

  return () => {
    disposed = true
    hint.remove()
    detachManualControl?.()
    element.removeEventListener('pointerenter', showHint)
    element.removeEventListener('pointermove', positionHint)
    element.removeEventListener('pointerleave', hideHint)
    element.removeEventListener('pointerdown', enableManualControl)
    element.removeEventListener('click', enableManualControl)
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function smoothstep01(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function readNumberParam(params: URLSearchParams, name: string, fallback: number): number {
  const rawValue = params.get(name)
  if (rawValue === null || rawValue.trim() === '') return fallback
  const value = Number(rawValue)
  return Number.isFinite(value) ? value : fallback
}

function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  switch (i % 6) {
    case 0:
      return [v, t, p]
    case 1:
      return [q, v, p]
    case 2:
      return [p, v, t]
    case 3:
      return [p, q, v]
    case 4:
      return [t, p, v]
    default:
      return [v, p, q]
  }
}

function defaultDyeColor(t: number): [number, number, number] {
  const color = hsv2rgb((0.58 + t * 0.82) % 1, 0.92, 0.95)
  return [color[0] * 0.3, color[1] * 0.3, color[2] * 0.3]
}

function sampleSSweepStroke(t01: number): DemoPoint {
  const t = smoothstep01(t01)
  const wave = Math.sin((t * 2.05 - 0.15) * Math.PI)
  const counter = Math.sin((t * 5.2 + 0.35) * Math.PI) * 0.032
  const drift = Math.sin(t * Math.PI * 1.25) * 0.03

  return {
    x: clamp(0.12 + 0.76 * t + Math.sin(t * Math.PI * 3.1) * 0.012, 0.08, 0.92),
    y: clamp(0.5 + wave * (0.205 + drift) + counter, 0.16, 0.84),
  }
}

function sampleSpiralBloomStroke(t01: number): DemoPoint {
  const t = smoothstep01(t01)
  const angle = -0.72 + t * Math.PI * 2 * 2.35
  const radius = 0.045 + 0.295 * Math.sin(t * Math.PI * 0.5)
  const wobble = Math.sin(t * Math.PI * 5.1) * 0.012

  return {
    x: clamp(0.5 + Math.cos(angle) * (radius + wobble), 0.1, 0.9),
    y: clamp(0.515 + Math.sin(angle) * (radius * 0.72) + Math.sin(angle * 0.5) * 0.022, 0.14, 0.86),
  }
}

function sampleSoftWhipStroke(t01: number): DemoPoint {
  const t = smoothstep01(t01)
  const lead = smoothstep01(t * 1.18)
  const overshoot = Math.sin(t * Math.PI) * 0.08
  const snap = Math.sin(t * Math.PI * 2.7 + 0.6) * Math.sin(t * Math.PI) * 0.055
  const recover = smoothstep01((t - 0.72) / 0.28)

  return {
    x: clamp(0.12 + 0.82 * lead - overshoot * recover, 0.08, 0.94),
    y: clamp(0.66 - 0.24 * t + snap + Math.sin(t * Math.PI * 0.8) * 0.05, 0.16, 0.84),
  }
}

function sampleBreathingOrbitStroke(t01: number): DemoPoint {
  const t = smoothstep01(t01)
  const angle = t * Math.PI * 2 * 1.75 - 0.35
  const breath = 0.78 + Math.sin(t * Math.PI * 2.4 + 0.3) * 0.18
  const radiusX = 0.275 * breath
  const radiusY = 0.185 * (1.08 - (breath - 0.78) * 0.55)
  const centerX = 0.5 + Math.sin(t * Math.PI * 1.4) * 0.028
  const centerY = 0.51 + Math.cos(t * Math.PI * 1.1 + 0.4) * 0.018

  return {
    x: clamp(centerX + Math.cos(angle) * radiusX + Math.sin(angle * 2.2) * 0.015, 0.11, 0.89),
    y: clamp(centerY + Math.sin(angle) * radiusY, 0.16, 0.84),
  }
}

function sampleDiagonalRevealStroke(t01: number): DemoPoint {
  const t = smoothstep01(t01)
  const diagonalX = 0.14 + 0.72 * t
  const diagonalY = 0.76 - 0.52 * t
  const reveal = Math.sin(t * Math.PI) * 0.105
  const ripple = Math.sin(t * Math.PI * 4.4 + 0.8) * Math.sin(t * Math.PI) * 0.025

  return {
    x: clamp(diagonalX + reveal * 0.35 + ripple, 0.08, 0.92),
    y: clamp(diagonalY + reveal - ripple * 0.65, 0.12, 0.88),
  }
}

function sampleSweepSpiralStroke(t01: number): DemoPoint {
  const t = smoothstep01(t01)
  const sweepX = 0.14 + 0.72 * t
  const sweepY = 0.5 + Math.sin(t * Math.PI * 2.15) * 0.22 + Math.sin(t * Math.PI * 7) * 0.045

  const spiralT = smoothstep01((t01 - 0.62) / 0.38)
  const angle = -0.45 + spiralT * Math.PI * 2 * 1.55
  const radius = 0.26 * (1 - spiralT * 0.55)
  const spiralX = 0.53 + Math.cos(angle) * radius
  const spiralY = 0.52 + Math.sin(angle) * radius

  return {
    x: clamp01(mix(sweepX, spiralX, spiralT)),
    y: clamp01(mix(sweepY, spiralY, spiralT)),
  }
}

function sampleInfinityStroke(t01: number): DemoPoint {
  const loops = 2.55
  const cycle = t01 * loops
  const cycleIndex = Math.floor(Math.min(cycle, loops - 0.0001))
  const cycleT = cycle - cycleIndex
  const cyclePhase = cycleIndex * 0.67
  const localT = clamp01(
    cycleT +
      Math.sin(cycleT * Math.PI * 2 + cyclePhase) * 0.026 +
      Math.sin(cycleT * Math.PI * 4.7 + cyclePhase * 0.6) * 0.012,
  )
  const theta = -Math.PI * 0.48 + (cycleIndex + localT) * Math.PI * 2
  const phaseSkew =
    Math.sin(localT * Math.PI * 2 + cyclePhase) * 0.075 +
    Math.sin(localT * Math.PI * 6.2 + cyclePhase * 1.4) * 0.025
  const horizontal = Math.sin(theta + phaseSkew * 0.42)
  const vertical = Math.sin(theta * 2 - phaseSkew)

  const centerX =
    0.5 +
    Math.sin(cycleT * Math.PI * 2 + cyclePhase) * 0.024 +
    Math.sin(t01 * Math.PI * 1.3) * 0.014
  const centerY =
    0.51 +
    Math.cos(cycleT * Math.PI * 2 + cyclePhase * 0.72) * 0.017 +
    Math.sin(t01 * Math.PI * 0.9 + 0.5) * 0.011
  const leftWidth = 0.292 + Math.sin(cycleT * Math.PI * 2 + cyclePhase + 0.55) * 0.017
  const rightWidth = 0.342 + Math.cos(cycleT * Math.PI * 2 + cyclePhase * 0.83) * 0.016
  const width = horizontal < 0 ? leftWidth : rightWidth
  const height = 0.162 + Math.sin(localT * Math.PI * 2 + cyclePhase * 1.2) * 0.014
  const skew = Math.sin(theta * 0.5 + cyclePhase) * 0.026
  const lift = Math.sin(theta * 3.1 + cyclePhase * 0.45) * 0.012

  return {
    x: clamp(centerX + horizontal * width + vertical * skew, 0.08, 0.92),
    y: clamp(centerY + vertical * height + horizontal * vertical * 0.018 + lift, 0.12, 0.88),
  }
}

function sampleSingleDemoStroke(t01: number, motion: DemoSingleMotion): DemoPoint {
  switch (motion) {
    case 'sSweep':
      return sampleSSweepStroke(t01)
    case 'spiralBloom':
      return sampleSpiralBloomStroke(t01)
    case 'softWhip':
      return sampleSoftWhipStroke(t01)
    case 'breathingOrbit':
      return sampleBreathingOrbitStroke(t01)
    case 'diagonalReveal':
      return sampleDiagonalRevealStroke(t01)
    case 'infinity':
      return sampleInfinityStroke(t01)
    case 'sweepSpiral':
    default:
      return sampleSweepSpiralStroke(t01)
  }
}

function sampleDemoStroke(
  t01: number,
  motion: DemoMotion,
  pauseFraction: number,
): DemoPoint | null {
  if (motion !== 'all') return sampleSingleDemoStroke(t01, motion)

  const motionCount = DEMO_SINGLE_MOTIONS.length
  const safePause = clamp(pauseFraction, 0, 0.22)
  const totalPause = safePause * (motionCount - 1)
  const motionSpan = Math.max(0.001, (1 - totalPause) / motionCount)
  let cursor = 0

  for (let i = 0; i < motionCount; i += 1) {
    const motionEnd = cursor + motionSpan
    if (t01 <= motionEnd || i === motionCount - 1) {
      return sampleSingleDemoStroke(clamp01((t01 - cursor) / motionSpan), DEMO_SINGLE_MOTIONS[i])
    }
    cursor = motionEnd

    const pauseEnd = cursor + safePause
    if (i < motionCount - 1 && t01 < pauseEnd) return null
    cursor = pauseEnd
  }

  return sampleSingleDemoStroke(1, DEMO_SINGLE_MOTIONS[motionCount - 1])
}

function getViewportSize(): { width: number; height: number } {
  const canvas = document.querySelector('canvas')
  const rect = canvas?.getBoundingClientRect()
  return {
    width: Math.max(1, rect?.width || window.innerWidth || 1),
    height: Math.max(1, rect?.height || window.innerHeight || 1),
  }
}

export function createDemoSplatDriver(
  fluid: DemoSplatTarget,
  options: DemoSplatDriverOptions = {},
): (elapsedSeconds: number) => void {
  const params = demoSearchParams()
  const fallbackMotion = options.motion ?? 'all'
  const motion = resolveDemoMotion(fallbackMotion)
  const duration = readNumberParam(
    params,
    'duration',
    options.durationSeconds ?? Number.POSITIVE_INFINITY,
  )
  const leadIn = readNumberParam(params, 'leadIn', options.leadInSeconds ?? 0.35)
  const outro = readNumberParam(params, 'outro', options.outroSeconds ?? 0.65)
  const hasDurationLimit = Number.isFinite(duration)
  const activeDuration = hasDurationLimit
    ? Math.max(0.25, duration - leadIn - outro)
    : Number.POSITIVE_INFINITY
  const defaultSequenceSeconds =
    motion === 'all' ? DEMO_REEL_SEQUENCE_SECONDS : DEMO_REEL_SINGLE_SEQUENCE_SECONDS
  const requestedSequenceSeconds = readNumberParam(
    params,
    'sequenceDuration',
    options.motionSequenceSeconds ?? defaultSequenceSeconds,
  )
  const sequenceSeconds = Math.max(
    0.25,
    Number.isFinite(activeDuration)
      ? Math.min(requestedSequenceSeconds, activeDuration)
      : requestedSequenceSeconds,
  )
  const repeatPauseSeconds = Math.max(
    0,
    readNumberParam(params, 'repeatPause', options.repeatPauseSeconds ?? DEMO_REEL_REPEAT_PAUSE_SECONDS),
  )
  const cycleSeconds = sequenceSeconds + repeatPauseSeconds
  const pauseSeconds = readNumberParam(params, 'motionPause', options.motionPauseSeconds ?? 1.2)
  const pauseFraction = pauseSeconds / sequenceSeconds
  const coloredStrokes = options.coloredStrokes ?? true
  const forceScale = readNumberParam(params, 'forceScale', options.forceScale ?? 1)
  let previous: DemoPoint | null = null
  let previousElapsed = -1

  return (elapsedSeconds: number): void => {
    if (elapsedSeconds < leadIn || (hasDurationLimit && elapsedSeconds > duration - outro)) {
      previous = null
      previousElapsed = elapsedSeconds
      return
    }

    const cycleElapsed = (elapsedSeconds - leadIn) % cycleSeconds
    if (cycleElapsed > sequenceSeconds) {
      previous = null
      previousElapsed = elapsedSeconds
      return
    }

    const t = clamp01(cycleElapsed / sequenceSeconds)
    const point = sampleDemoStroke(t, motion, pauseFraction)
    if (!point) {
      previous = null
      previousElapsed = elapsedSeconds
      return
    }
    if (!previous || elapsedSeconds < previousElapsed) {
      previous = point
      previousElapsed = elapsedSeconds
      return
    }

    const viewport = getViewportSize()
    const dxCss = (point.x - previous.x) * viewport.width
    const dyCss = (point.y - previous.y) * viewport.height
    previous = point
    previousElapsed = elapsedSeconds

    if (Math.abs(dxCss) + Math.abs(dyCss) < 0.05) return

    const dyeColor =
      options.colorize?.(dxCss, dyCss, elapsedSeconds, t) ??
      (coloredStrokes ? defaultDyeColor(t) : undefined)

    fluid.addSplat(
      point.x,
      point.y,
      dxCss * fluid.splatForce * forceScale,
      dyCss * fluid.splatForce * forceScale,
      dyeColor ? { dyeColor } : undefined,
    )
  }
}
