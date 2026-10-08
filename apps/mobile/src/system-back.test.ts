import { handleSystemBack } from './system-back'

describe('handleSystemBack', () => {
  it('returns to the list when the current route has a previous page', () => {
    const goToList = jest.fn()
    const goToSettings = jest.fn()
    const showPrompt = jest.fn()
    const moveToBackground = jest.fn()

    const result = handleSystemBack({
      route: 'chat',
      now: 10_000,
      lastBackAt: 0,
      goToList,
      goToSettings,
      closeTrajectory: jest.fn(),
      showPrompt,
      moveToBackground,
    })

    expect(result).toEqual({ handled: true, lastBackAt: 0 })
    expect(goToList).toHaveBeenCalledTimes(1)
    expect(showPrompt).not.toHaveBeenCalled()
    expect(moveToBackground).not.toHaveBeenCalled()
  })

  it('returns from a trajectory to the conversation it belongs to', () => {
    const closeTrajectory = jest.fn()
    const goToList = jest.fn()
    const goToSettings = jest.fn()

    const result = handleSystemBack({
      route: 'trajectory',
      now: 10_000,
      lastBackAt: 0,
      goToList,
      goToSettings,
      closeTrajectory,
      showPrompt: jest.fn(),
      moveToBackground: jest.fn(),
    })

    // The trajectory is a page inside one conversation, so back walks into it
    // rather than out to the list.
    expect(result).toEqual({ handled: true, lastBackAt: 0 })
    expect(closeTrajectory).toHaveBeenCalledTimes(1)
    expect(goToList).not.toHaveBeenCalled()
    expect(goToSettings).not.toHaveBeenCalled()
  })

  it('returns from the plugin page to settings, one step back', () => {
    const goToList = jest.fn()
    const goToSettings = jest.fn()

    const result = handleSystemBack({
      route: 'plugins',
      now: 10_000,
      lastBackAt: 0,
      goToList,
      goToSettings,
      closeTrajectory: jest.fn(),
      showPrompt: jest.fn(),
      moveToBackground: jest.fn(),
    })

    expect(result).toEqual({ handled: true, lastBackAt: 0 })
    expect(goToSettings).toHaveBeenCalledTimes(1)
    expect(goToList).not.toHaveBeenCalled()
  })

  it('shows a prompt on the first root-page back press', () => {
    const result = handleSystemBack({
      route: 'list',
      now: 10_000,
      lastBackAt: 0,
      goToList: jest.fn(),
      goToSettings: jest.fn(),
      closeTrajectory: jest.fn(),
      showPrompt: jest.fn(),
      moveToBackground: jest.fn(),
    })

    expect(result).toEqual({ handled: true, lastBackAt: 10_000 })
  })

  it('moves the app to the background when back is pressed again within two seconds', () => {
    const moveToBackground = jest.fn()
    const result = handleSystemBack({
      route: 'list',
      now: 11_999,
      lastBackAt: 10_000,
      goToList: jest.fn(),
      goToSettings: jest.fn(),
      closeTrajectory: jest.fn(),
      showPrompt: jest.fn(),
      moveToBackground,
    })

    expect(result).toEqual({ handled: true, lastBackAt: 0 })
    expect(moveToBackground).toHaveBeenCalledTimes(1)
  })

  it('starts a new confirmation window after two seconds', () => {
    const showPrompt = jest.fn()
    const result = handleSystemBack({
      route: 'list',
      now: 12_000,
      lastBackAt: 10_000,
      goToList: jest.fn(),
      goToSettings: jest.fn(),
      closeTrajectory: jest.fn(),
      showPrompt,
      moveToBackground: jest.fn(),
    })

    expect(result).toEqual({ handled: true, lastBackAt: 12_000 })
    expect(showPrompt).toHaveBeenCalledTimes(1)
  })
})
