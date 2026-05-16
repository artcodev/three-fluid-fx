const params = new URLSearchParams(window.location.search)
const hiddenUiClass = 'is-example-ui-hidden'

function isEnabled(value) {
  return value === '1' || value === 'true'
}

function shouldIgnoreShortcut(event) {
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

if (isEnabled(params.get('iframe'))) {
  document.body.classList.add('is-iframe-embed')
}

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Backquote' || shouldIgnoreShortcut(event)) return

  event.preventDefault()
  document.body.classList.toggle(hiddenUiClass)
})

let backgroundContainer = null
let demoLabel = null

function ensureBackgroundContainer() {
  if (backgroundContainer) return backgroundContainer
  backgroundContainer = document.createElement('div')
  backgroundContainer.className = 'bg-switcher'
  backgroundContainer.setAttribute('aria-label', 'Background')
  document.body.appendChild(backgroundContainer)
  return backgroundContainer
}

window.__fluidExamplePage = {
  registerBackgroundControl(registration) {
    const container = ensureBackgroundContainer()
    container.replaceChildren()

    const buttons = new Map()
    const setActive = (choice) => {
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

export {}
