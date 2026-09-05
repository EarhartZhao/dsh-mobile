export type SystemBackRoute = 'list' | 'chat' | 'settings'

interface SystemBackOptions {
  route: SystemBackRoute
  now: number
  lastBackAt: number
  goToList: () => void
  showPrompt: () => void
  moveToBackground: () => void
}

interface SystemBackResult {
  handled: true
  lastBackAt: number
}

export function handleSystemBack(options: SystemBackOptions): SystemBackResult {
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
