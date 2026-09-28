import { CARD_REGISTRY, cardRenderer } from './tool-cards'

describe('cardRenderer', () => {
  it('maps a known card tag to its own entry', () => {
    for (const card of ['terminal', 'diff', 'read', 'search', 'web']) {
      expect(cardRenderer({ card })).toBe(CARD_REGISTRY[card])
    }
    expect(cardRenderer({ card: 'generic' })).toBe(CARD_REGISTRY['generic'])
  })

  it('degrades an unknown tag to the generic entry instead of showing nothing', () => {
    // `card` is an open vocabulary: a newer host or a plugin can send a tag this
    // build has never seen, and the row must still render something readable.
    expect(cardRenderer({ card: 'hologram' })).toBe(CARD_REGISTRY['generic'])
    expect(cardRenderer({})).toBe(CARD_REGISTRY['generic'])
    expect(cardRenderer(null)).toBe(CARD_REGISTRY['generic'])
  })

  it('keeps the generic entry body-less, so the row falls back to the raw result', () => {
    // That fallback is what makes the miss rule above safe: the generic entry
    // contributes the host's title and lets the row print the model-facing text.
    expect(CARD_REGISTRY['generic']?.body).toBeUndefined()
    expect(typeof CARD_REGISTRY['generic']?.title).toBe('function')
  })

  it('declares at least one facet per entry, and only functions', () => {
    for (const [card, entry] of Object.entries(CARD_REGISTRY)) {
      const facets = Object.entries(entry)
      expect([card, facets.length > 0]).toEqual([card, true])
      for (const [name, facet] of facets) expect([card, name, typeof facet]).toEqual([card, name, 'function'])
    }
  })
})
