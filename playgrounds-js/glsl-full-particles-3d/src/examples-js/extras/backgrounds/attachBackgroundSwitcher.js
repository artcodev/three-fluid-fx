import { persistBackground } from './resolveBackground'
const LABELS = {
  dark: '☾ Dark',
  bright: '☀ Bright',
  slideshow: '☷ Slides',
}
const ORDER = ['dark', 'bright', 'slideshow']
/**
 * Mount a 3-button switcher (dark / bright / slideshow) in the bottom-right
 * corner of the page. Each button swaps the corresponding `Background`
 * instance into the supplied scene; the previous one stays cached so
 * toggling back is instant.
 *
 * Lazy construction: the factory for a variant runs only when that variant
 * is first selected — picking "slideshow" pays the texture-load cost once,
 * "dark" stays a no-op until clicked.
 *
 * @param options.scene     The three.js Scene to add/remove background meshes from.
 * @param options.initial   Starting variant — typically the result of {@link resolveBackground}.
 * @param options.factories One constructor per variant (`new Backdrop(...)`, `new Slideshow(...)`).
 * @param options.persist   When `false`, user clicks don't write to localStorage —
 *   the example always reverts to its hardcoded default on reload. Default `true`.
 * @param options.fadeDuration Cross-fade duration in seconds. Default `1.15`.
 */
export function attachBackgroundSwitcher(options) {
  const { scene, factories } = options
  const persist = options.persist ?? true
  const fadeDuration = options.fadeDuration ?? 1.15
  const cache = new Map()
  const visible = new Set()
  const opacityByBackground = new Map()
  function setOpacity(bg, opacity) {
    const value = Math.min(Math.max(opacity, 0), 1)
    opacityByBackground.set(bg, value)
    if (bg.setOpacity) {
      bg.setOpacity(value)
      return
    }
    bg.mesh.traverse((object) => {
      const material = object.material
      const materials = Array.isArray(material) ? material : material ? [material] : []
      for (const mat of materials) {
        mat.transparent = value < 1
        mat.opacity = value
      }
    })
    bg.mesh.visible = value > 0.001
  }
  function ensureVisible(bg) {
    if (visible.has(bg)) return
    visible.add(bg)
    scene.add(bg.mesh)
  }
  function removeVisible(bg) {
    if (!visible.delete(bg)) return
    scene.remove(bg.mesh)
    setOpacity(bg, 1)
  }
  function get(choice) {
    let bg = cache.get(choice)
    if (!bg) {
      bg = factories[choice]()
      cache.set(choice, bg)
    }
    return bg
  }
  let activeChoice = options.initial
  let activeBackground = get(activeChoice)
  ensureVisible(activeBackground)
  activeBackground.mesh.renderOrder = -1000
  setOpacity(activeBackground, 1)
  let transition = null
  function setActive(choice) {
    if (choice === activeChoice) return
    const next = get(choice)
    if (transition) {
      for (const bg of transition.outgoing) {
        if (bg !== next) removeVisible(bg)
      }
      if (transition.incoming !== next && transition.incoming !== activeBackground) {
        removeVisible(transition.incoming)
      }
      transition = null
    }
    const outgoing = Array.from(visible).filter((bg) => bg !== next)
    for (let i = 0; i < outgoing.length; i += 1) {
      outgoing[i].mesh.renderOrder = -1000 + i
      setOpacity(outgoing[i], 1)
    }
    ensureVisible(next)
    next.mesh.renderOrder = -990
    setOpacity(next, 0)
    activeBackground = next
    activeChoice = choice
    transition = { incoming: next, outgoing, elapsed: 0 }
    if (persist) persistBackground(choice)
    backgroundControl?.setActive(choice)
    // Mirror onto the public `switcher` handle so callers see the new instance.
    switcher.activeBackground = activeBackground
  }
  const pageRuntime = window
  const backgroundControl = pageRuntime.__fluidExamplePage?.registerBackgroundControl?.({
    choices: ORDER.map((choice) => ({ value: choice, label: LABELS[choice] })),
    active: activeChoice,
    onSelect: (choice) => setActive(choice),
  })
  const switcher = {
    activeBackground,
    update(dt, elapsed) {
      for (const bg of visible) bg.update(dt, elapsed)
      if (!transition) return
      transition.elapsed += dt
      const raw = fadeDuration <= 0 ? 1 : Math.min(transition.elapsed / fadeDuration, 1)
      const eased = raw * raw * (3 - 2 * raw)
      setOpacity(transition.incoming, eased)
      if (raw >= 1) {
        setOpacity(transition.incoming, 1)
        if (!transition.incoming.mesh.visible) return
        for (const bg of transition.outgoing) removeVisible(bg)
        transition.incoming.mesh.renderOrder = -1000
        transition = null
      }
    },
    select: setActive,
    dispose() {
      backgroundControl?.dispose()
      for (const bg of cache.values()) {
        scene.remove(bg.mesh)
        bg.dispose()
      }
      cache.clear()
    },
  }
  return switcher
}
