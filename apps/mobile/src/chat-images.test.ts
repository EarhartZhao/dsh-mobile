import {
  appendPendingImage,
  buildPromptContent,
  formatBytes,
  imageBytes,
  validatePendingImage,
  type ImageLimitsView,
  type PendingImage,
} from './chat-images'

const limits: ImageLimitsView = {
  maxImageBytes: 1000,
  maxImagesPerMessage: 2,
  maxMessageImageBytes: 1500,
  maxImagePixels: 1000 * 1000,
  maxImageDimension: 1600,
  mediaTypes: ['image/jpeg', 'image/png'],
}

function image(overrides: Partial<PendingImage> = {}): PendingImage {
  return {
    mediaType: 'image/png',
    data: 'a'.repeat(100),
    width: 100,
    height: 100,
    name: null,
    ...overrides,
  }
}

describe('chat image intake', () => {
  it('formats bytes as KB and MB', () => {
    expect(formatBytes(512)).toBe('1KB')
    expect(formatBytes(1536)).toBe('2KB')
    expect(formatBytes(1024 * 1024)).toBe('1MB')
    expect(formatBytes(1536 * 1024)).toBe('1.5MB')
  })

  it('estimates bytes from base64 data length', () => {
    expect(imageBytes({ ...image(), data: 'a'.repeat(8) })).toBe(6)
  })

  it('rejects unsupported media types before any size check', () => {
    expect(validatePendingImage(image({ mediaType: 'image/gif' }), limits)).toEqual({ kind: 'format' })
  })

  it('rejects images above the per-image byte limit', () => {
    expect(validatePendingImage(image({ data: 'a'.repeat(2000) }), limits)).toEqual({
      kind: 'perImageSize',
      sizeLabel: '1KB',
    })
  })

  it('rejects oversized edges and oversized pixel counts', () => {
    expect(validatePendingImage(image({ width: 2000, height: 100 }), limits)).toEqual({
      kind: 'dimension',
      size: 1600,
    })
    expect(validatePendingImage(image({ width: 1500, height: 1500 }), limits)).toEqual({ kind: 'pixels' })
  })

  it('accepts a valid image and skips checks without limits', () => {
    expect(validatePendingImage(image(), limits)).toBeNull()
    expect(validatePendingImage(image(), null)).toBeNull()
  })

  it('refuses a batch that exceeds the per-message image count', () => {
    const first = appendPendingImage([], image({ name: 'one.png' }), limits)
    const second = appendPendingImage(first.next, image({ name: 'two.png' }), limits)
    const third = appendPendingImage(second.next, image({ name: 'three.png' }), limits)

    expect(first.next).toHaveLength(1)
    expect(second.next).toHaveLength(2)
    expect(third).toEqual({ next: second.next, rejection: { kind: 'count', count: 2 } })
  })

  it('refuses a batch that exceeds the total message byte limit', () => {
    const tight: ImageLimitsView = { ...limits, maxMessageImageBytes: 150 }
    const first = appendPendingImage([], image({ data: 'a'.repeat(120) }), tight)
    const second = appendPendingImage(first.next, image({ data: 'a'.repeat(120) }), tight)

    expect(first.next).toHaveLength(1)
    expect(second).toEqual({ next: first.next, rejection: { kind: 'totalSize', sizeLabel: '0KB' } })
  })

  it('keeps an invalid single image out of the batch', () => {
    const result = appendPendingImage([], image({ mediaType: 'image/bmp' }), limits)
    expect(result.next).toEqual([])
    expect(result.rejection).toEqual({ kind: 'format' })
  })
})

describe('chat prompt content assembly', () => {
  it('keeps text, images, then files and omits absent parts', () => {
    const content = buildPromptContent('hello', [
      image({ name: 'shot.png' }),
      image({ name: null }),
    ], [{ receiptId: 'f1' }])

    expect(content).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'image', mediaType: 'image/png', data: expect.any(String), name: 'shot.png' },
      { type: 'image', mediaType: 'image/png', data: expect.any(String) },
      { type: 'file', receiptId: 'f1' },
    ])
  })

  it('drops the text part when the draft is empty', () => {
    expect(buildPromptContent('', [], [])).toEqual([])
  })
})
