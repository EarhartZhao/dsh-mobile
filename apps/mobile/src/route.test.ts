import { INITIAL_NAV, closeChat, openChat, routeTo } from './route'

describe('chat lineage', () => {
  it('backs out of a conversation opened from the list into the list', () => {
    const opened = openChat(INITIAL_NAV, 'parent')
    expect(opened.route).toEqual({ name: 'chat', sessionId: 'parent' })
    expect(closeChat(opened)).toEqual(INITIAL_NAV)
  })

  it('retraces the hop a subagent was opened through', () => {
    const parent = openChat(INITIAL_NAV, 'parent')
    const child = openChat(parent, 'child')
    expect(child.route).toEqual({ name: 'chat', sessionId: 'child' })
    // The child's own conversation is where back goes — not the session list,
    // which does not even carry a subagent row.
    const back = closeChat(child)
    expect(back.route).toEqual({ name: 'chat', sessionId: 'parent' })
    expect(closeChat(back)).toEqual(INITIAL_NAV)
  })

  it('retraces a grandchild one hop at a time', () => {
    const child = openChat(openChat(INITIAL_NAV, 'parent'), 'child')
    const grandchild = openChat(child, 'grandchild')
    expect(closeChat(closeChat(grandchild)).route).toEqual({ name: 'chat', sessionId: 'parent' })
  })

  it('starts a fresh lineage when a conversation is opened from the list again', () => {
    const child = openChat(openChat(INITIAL_NAV, 'parent'), 'child')
    // Out to the list, then into an unrelated conversation: the old hop must
    // not survive as a place back to.
    const fromList = openChat(routeTo(child, { name: 'list' }), 'other')
    expect(fromList.chatTrail).toEqual([])
    expect(closeChat(fromList)).toEqual(INITIAL_NAV)
  })

  it('keeps the lineage when the same conversation is opened again', () => {
    const child = openChat(openChat(INITIAL_NAV, 'parent'), 'child')
    expect(openChat(child, 'child')).toEqual(child)
  })

  it('drops the lineage on any other screen, so back never re-enters it', () => {
    const child = openChat(openChat(INITIAL_NAV, 'parent'), 'child')
    const settings = routeTo(child, { name: 'settings' })
    expect(settings.chatTrail).toEqual([])
    expect(closeChat(settings)).toEqual(INITIAL_NAV)
  })
})
