const VALID = ['performance', 'balanced', 'quality']
/**
 * Read the fluid simulation profile from `?profile=…` URL query param,
 * falling back to the supplied default. Profile dictates internal FBO
 * resolution and other quality knobs in {@link FluidSimulation}; baked at
 * construction time, not switchable in flight (a profile change reloads
 * the page — see {@link addProfileSwitcher} in shared/controls).
 *
 * @param fallback Used when no valid `?profile=…` is present.
 */
export function resolveProfile(fallback) {
  if (typeof window === 'undefined') return fallback
  const fromQuery = new URLSearchParams(window.location.search).get('profile')
  if (fromQuery && VALID.includes(fromQuery)) {
    return fromQuery
  }
  return fallback
}
