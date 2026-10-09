import { handleSystemBack } from './system-back'

/** The uninteresting handlers every case has to supply. */
function stubs(): {
  goToList: jest.Mock
  goToSettings: jest.Mock
  closeTrajectory: jest.Mock
  closeTrajectoryRecord: jest.Mock
  showPrompt: jest.Mock
  moveToBackground: jest.Mock
} {
  return {
    goToList: jest.fn(),
    goToSettings: jest.fn(),
    closeTrajectory: jest.fn(),
    closeTrajectoryRecord: jest.fn(),
    showPrompt: jest.fn(),
    moveToBackground: jest.fn(),
  }
}

describe('handleSystemBack', () => {
  it('returns to the list when the current route has a previous page', () => {
    const handlers = stubs()

    const result = handleSystemBack({
      route: 'chat',
      now: 10_000,
      lastBackAt: 0,
      ...handlers,
    })

    expect(result).toEqual({ handled: true, lastBackAt: 0 })
    expect(handlers.goToList).toHaveBeenCalledTimes(1)
    expect(handlers.showPrompt).not.toHaveBeenCalled()
    expect(handlers.moveToBackground).not.toHaveBeenCalled()
  })

  it('returns from a trajectory to the conversation it belongs to', () => {
    const handlers = stubs()

    const result = handleSystemBack({
      route: 'trajectory',
      now: 10_000,
      lastBackAt: 0,
      ...handlers,
    })

    // The trajectory is a page inside one conversation, so back walks into it
    // rather than out to the list.
    expect(result).toEqual({ handled: true, lastBackAt: 0 })
    expect(handlers.closeTrajectory).toHaveBeenCalledTimes(1)
    expect(handlers.goToList).not.toHaveBeenCalled()
    expect(handlers.goToSettings).not.toHaveBeenCalled()
  })

  it('returns from a record to the trajectory it was opened from', () => {
    const handlers = stubs()

    const result = handleSystemBack({
      route: 'trajectoryRecord',
      now: 10_000,
      lastBackAt: 0,
      ...handlers,
    })

    // A record is a page inside one trajectory, so back steps up to it rather
    // than out to the conversation or the list.
    expect(result).toEqual({ handled: true, lastBackAt: 0 })
    expect(handlers.closeTrajectoryRecord).toHaveBeenCalledTimes(1)
    expect(handlers.closeTrajectory).not.toHaveBeenCalled()
    expect(handlers.goToList).not.toHaveBeenCalled()
  })

  it('returns from the plugin page to settings, one step back', () => {
    const handlers = stubs()

    const result = handleSystemBack({
      route: 'plugins',
      now: 10_000,
      lastBackAt: 0,
      ...handlers,
    })

    expect(result).toEqual({ handled: true, lastBackAt: 0 })
    expect(handlers.goToSettings).toHaveBeenCalledTimes(1)
    expect(handlers.goToList).not.toHaveBeenCalled()
  })

  it('shows a prompt on the first root-page back press', () => {
    const result = handleSystemBack({
      route: 'list',
      now: 10_000,
      lastBackAt: 0,
      ...stubs(),
    })

    expect(result).toEqual({ handled: true, lastBackAt: 10_000 })
  })

  it('moves the app to the background when back is pressed again within two seconds', () => {
    const handlers = stubs()
    const result = handleSystemBack({
      route: 'list',
      now: 11_999,
      lastBackAt: 10_000,
      ...handlers,
    })

    expect(result).toEqual({ handled: true, lastBackAt: 0 })
    expect(handlers.moveToBackground).toHaveBeenCalledTimes(1)
  })

  it('starts a new confirmation window after two seconds', () => {
    const handlers = stubs()
    const result = handleSystemBack({
      route: 'list',
      now: 12_000,
      lastBackAt: 10_000,
      ...handlers,
    })

    expect(result).toEqual({ handled: true, lastBackAt: 12_000 })
    expect(handlers.showPrompt).toHaveBeenCalledTimes(1)
  })
})
