export type SystemBackRoute = 'list' | 'chat' | 'settings' | 'plugins' | 'connections' | 'pairing'

interface SystemBackOptions {
  route: SystemBackRoute
  now: number
  lastBackAt: number
  goToList: () => void
  goToSettings: () => void
  showPrompt: () => void
  moveToBackground: () => void
}

interface SystemBackResult {
  handled: true
  lastBackAt: number
}

export function handleSystemBack(options: SystemBackOptions): SystemBackResult {
  // The plugin and connection pages sit one step past settings, so back walks
  // the stack instead of jumping straight to the root. The add-a-connection
  // scanner belongs to the connection list, which is where it came from.
  if (options.route === 'plugins' || options.route === 'connections') {
    options.goToSettings()
    return { handled: true, lastBackAt: 0 }
  }

  if (options.route !== 'list') {
    options.goToList()
    return { handled: true, lastBackAt: 0 }
  }

  if (options.lastBackAt > 0 && options.now - options.lastBackAt < 2_000) {
    options.moveToBackground()
    return { handled: true, lastBackAt: 0 }
  }

  options.showPrompt()
  return { handled: true, lastBackAt: options.now }
}
