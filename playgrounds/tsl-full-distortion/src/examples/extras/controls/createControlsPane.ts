import type { FolderApi } from 'tweakpane'
import { Pane } from 'tweakpane'
import type { FluidProfile } from 'three-fluid-fx'

export interface ControlsPane<T extends object> {
  pane: Pane
  params: T
  dispose: () => void
}

/**
 * Adds a Profile selector that reloads the page with `?profile=…` because
 * FluidSimulation FBOs are sized at construction time and can't be resized
 * in flight.
 */
export function addProfileSwitcher(parent: FolderApi | Pane, current: FluidProfile): void {
  const state = { profile: current }
  parent
    .addBinding(state, 'profile', {
      options: {
        performance: 'performance',
        balanced: 'balanced',
        quality: 'quality',
      },
    })
    .on('change', (ev) => {
      if (ev.value === current) return
      const url = new URL(window.location.href)
      url.searchParams.set('profile', ev.value)
      window.location.href = url.toString()
    })
}

export function createControlsPane<T extends object>(
  title: string,
  params: T,
  build: (pane: Pane, params: T) => void,
): ControlsPane<T> {
  const container = document.createElement('div')
  container.className = 'tp-container'
  document.body.appendChild(container)

  const pane = new Pane({ title, container })
  build(pane, params)

  return {
    pane,
    params,
    dispose() {
      pane.dispose()
      container.remove()
    },
  }
}
