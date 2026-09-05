import { handleSystemBack } from './system-back'

describe('handleSystemBack', () => {
  it('returns to the list when the current route has a previous page', () => {
    const goToList = jest.fn()
    const showPrompt = jest.fn()
    const moveToBackground = jest.fn()

    const result = handleSystemBack({
      route: 'chat',
      now: 10_000,
      lastBackAt: 0,
      goToList,
      showPrompt,
      moveToBackground,
    })

    expect(result).toEqual({ handled: true, lastBackAt: 0 })
    expect(goToList).toHaveBeenCalledTimes(1)
    expect(showPrompt).not.toHaveBeenCalled()
    expect(moveToBackground).not.toHaveBeenCalled()
  })

  it('shows a prompt on the first root-page back press', () => {
    const result = handleSystemBack({
      route: 'list',
      now: 10_000,
      lastBackAt: 0,
      goToList: jest.fn(),
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
      showPrompt,
      moveToBackground: jest.fn(),
    })

    expect(result).toEqual({ handled: true, lastBackAt: 12_000 })
    expect(showPrompt).toHaveBeenCalledTimes(1)
  })
})
