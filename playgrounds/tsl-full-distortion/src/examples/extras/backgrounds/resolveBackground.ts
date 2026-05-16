/** One of the three background variants the switcher can show. */
export type BackgroundChoice = 'dark' | 'bright' | 'slideshow'

const VALID: readonly BackgroundChoice[] = ['dark', 'bright', 'slideshow']
const STORAGE_KEY = 'background-choice'

function isValid(value: string | null): value is BackgroundChoice {
  return value !== null && (VALID as readonly string[]).includes(value)
}

/**
 * Resolve the background to show on page load. Priority order:
 *   1. `?background=…` URL query param (one-shot override, useful for sharing links)
 *   2. `localStorage` value from a previous session (skipped when `skipStorage`)
 *   3. Caller-supplied fallback
 *
 * @param fallback Used when neither URL nor localStorage hold a valid choice.
 * @param options.skipStorage When `true`, ignore localStorage entirely — the
 *   example always lands on the fallback (URL still respected for shareable
 *   links). Pair with `attachBackgroundSwitcher({ persist: false })` so user
 *   clicks within that example don't persist either.
 */
export function resolveBackground(
  fallback: BackgroundChoice,
  options: { skipStorage?: boolean } = {},
): BackgroundChoice {
  if (typeof window === 'undefined') return fallback
  const fromQuery = new URLSearchParams(window.location.search).get('background')
  if (isValid(fromQuery)) return fromQuery
  if (options.skipStorage) return fallback
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (isValid(stored)) return stored
  return fallback
}

/** Persist the user's pick to localStorage so subsequent visits remember it. */
export function persistBackground(choice: BackgroundChoice): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, choice)
}
