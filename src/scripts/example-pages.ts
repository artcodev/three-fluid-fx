interface BackgroundChoiceItem {
  value: string
  label: string
}

interface BackgroundControlRegistration {
  choices: readonly BackgroundChoiceItem[]
  active: string
  onSelect: (choice: string) => void
}

interface BackgroundControlHandle {
  setActive: (choice: string) => void
  dispose: () => void
}

interface ExamplePageRuntime {
  registerBackgroundControl: (
    registration: BackgroundControlRegistration,
  ) => BackgroundControlHandle
  setDemoMode: (label: string) => void
}

declare global {
  interface Window {
    __fluidExamplePage?: ExamplePageRuntime
  }
}

const modules = import.meta.glob('../../examples/**/main.ts')
const params = new URLSearchParams(window.location.search)
const hiddenUiClass = 'is-example-ui-hidden'

function isEnabled(value: string | null): boolean {
  return value === '1' || value === 'true'
}

function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true

  const target = event.target
  if (!(target instanceof HTMLElement)) return false

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

function createExamplePageRuntime(): ExamplePageRuntime {
  if (isEnabled(params.get('iframe'))) {
    document.body.classList.add('is-iframe-embed')
  }

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Backquote' || shouldIgnoreShortcut(event)) return

    event.preventDefault()
    const isHidden = document.body.classList.toggle(hiddenUiClass)
    const siteMenu = document.querySelector('[data-site-menu]')
    if (isHidden && siteMenu instanceof HTMLDialogElement && siteMenu.open) {
      siteMenu.close()
    }
  })

  let backgroundContainer: HTMLDivElement | null = null
  let demoLabel: HTMLDivElement | null = null

  function ensureBackgroundContainer(): HTMLDivElement {
    if (backgroundContainer) return backgroundContainer
    backgroundContainer = document.createElement('div')
    backgroundContainer.className = 'bg-switcher'
    backgroundContainer.setAttribute('aria-label', 'Background')
    document.body.appendChild(backgroundContainer)
    return backgroundContainer
  }

  return {
    registerBackgroundControl(registration) {
      const container = ensureBackgroundContainer()
      container.replaceChildren()

      const buttons = new Map<string, HTMLButtonElement>()
      const setActive = (choice: string): void => {
        for (const [value, button] of buttons) {
          button.classList.toggle('is-active', value === choice)
        }
      }

      for (const choice of registration.choices) {
        const button = document.createElement('button')
        button.className = 'toggle'
        button.type = 'button'
        button.textContent = choice.label
        button.addEventListener('click', () => registration.onSelect(choice.value))
        container.appendChild(button)
        buttons.set(choice.value, button)
      }

      setActive(registration.active)

      return {
        setActive,
        dispose() {
          container.replaceChildren()
          if (backgroundContainer === container) {
            backgroundContainer.remove()
            backgroundContainer = null
          }
        },
      }
    },

    setDemoMode(label) {
      document.body.classList.add('is-demo-reel')
      if (demoLabel) {
        demoLabel.textContent = label
        return
      }

      demoLabel = document.createElement('div')
      demoLabel.className = 'demo-reel-label'
      demoLabel.textContent = label
      document.body.appendChild(demoLabel)
    },
  }
}

export function initExamplePage(): void {
  window.__fluidExamplePage = createExamplePageRuntime()

  const stage = document.getElementById('stage')
  const slug = stage instanceof HTMLElement ? stage.dataset.exampleSlug : undefined
  const key = slug ? `../../examples/${slug}/main.ts` : undefined
  const loadExample = key ? modules[key] : undefined

  if (!slug || !loadExample) {
    const known = Object.keys(modules)
      .map((modulePath) => modulePath.replace('../../examples/', '').replace('/main.ts', ''))
      .sort()
      .join(', ')

    throw new Error(`Unknown example "${slug ?? 'missing'}". Known examples: ${known}`)
  }

  void loadExample()
}
