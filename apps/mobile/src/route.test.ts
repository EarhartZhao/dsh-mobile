import {
  INITIAL_NAV,
  closeChat,
  closeTrajectory,
  closeTrajectoryRecord,
  openChat,
  openTrajectory,
  openTrajectoryRecord,
  routeTo,
} from './route'

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

  it('leaves a trajectory for its own conversation, not the list', () => {
    const chat = openChat(INITIAL_NAV, 'parent')
    const trajectory = openTrajectory(chat, 'parent')
    expect(trajectory.route).toEqual({ name: 'trajectory', sessionId: 'parent' })
    expect(closeTrajectory(trajectory)).toEqual(chat)
  })

  it('keeps the hop a trajectory was opened over', () => {
    // Parent → child, then the child's trajectory: back walks child → parent,
    // exactly as it would have without the trajectory in between.
    const child = openChat(openChat(INITIAL_NAV, 'parent'), 'child')
    const trajectory = openTrajectory(child, 'child')
    expect(trajectory.chatTrail).toEqual(['parent'])
    const backInChat = closeTrajectory(trajectory)
    expect(backInChat).toEqual(child)
    expect(closeChat(backInChat).route).toEqual({ name: 'chat', sessionId: 'parent' })
  })

  it('keeps the lineage when a trajectory is routed to directly', () => {
    const child = openChat(openChat(INITIAL_NAV, 'parent'), 'child')
    expect(routeTo(child, { name: 'trajectory', sessionId: 'child' }).chatTrail).toEqual(['parent'])
  })

  it('leaves a record for its own trajectory, not the conversation', () => {
    const trajectory = openTrajectory(openChat(INITIAL_NAV, 'parent'), 'parent')
    const record = openTrajectoryRecord(trajectory, 'parent', 7)
    expect(record.route).toEqual({ name: 'trajectoryRecord', sessionId: 'parent', index: 7 })
    expect(closeTrajectoryRecord(record)).toEqual(trajectory)
    // And the trajectory still knows the way out of the conversation.
    expect(closeTrajectory(closeTrajectoryRecord(record)).route)
      .toEqual({ name: 'chat', sessionId: 'parent' })
  })

  it('keeps the lineage a record was opened over', () => {
    const child = openChat(openChat(INITIAL_NAV, 'parent'), 'child')
    const record = openTrajectoryRecord(openTrajectory(child, 'child'), 'child', 3)
    expect(record.chatTrail).toEqual(['parent'])
    expect(routeTo(record, { name: 'list' }).chatTrail).toEqual([])
  })
})
