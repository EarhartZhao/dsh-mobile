/** Image intake helpers shared by the composer and attachment rendering.
 * Kept free of React so the intake limits and prompt payload shape stay
 * unit-testable without mounting the screen. */

export interface PendingImage {
  mediaType: string
  data: string
  width: number
  height: number
  name?: string | null
}

export interface ImageLimitsView {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  maxImageDimension: number
  mediaTypes: string[]
}

/** Why an image or a whole batch was refused at intake, if it was. */
export type ImageRejection =
  | { kind: 'format' }
  | { kind: 'perImageSize'; sizeLabel: string }
  | { kind: 'dimension'; size: number }
  | { kind: 'pixels' }
  | { kind: 'count'; count: number }
  | { kind: 'totalSize'; sizeLabel: string }

export function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${Math.round(size / (1024 * 1024) * 10) / 10}MB`
  return `${Math.round(size / 1024)}KB`
}

export function imageBytes(image: PendingImage): number {
  return Math.floor(image.data.length * 3 / 4)
}

export function validatePendingImage(image: PendingImage, limits: ImageLimitsView | null): ImageRejection | null {
  if (limits === null) return null
  if (!limits.mediaTypes.includes(image.mediaType)) return { kind: 'format' }
  const bytes = imageBytes(image)
  if (bytes > limits.maxImageBytes) return { kind: 'perImageSize', sizeLabel: formatBytes(limits.maxImageBytes) }
  if (image.width > limits.maxImageDimension || image.height > limits.maxImageDimension) {
    return { kind: 'dimension', size: limits.maxImageDimension }
  }
  if (image.width * image.height > limits.maxImagePixels) return { kind: 'pixels' }
  return null
}

/** Append one picked image unless it violates per-image or batch limits. */
export function appendPendingImage(
  current: PendingImage[],
  image: PendingImage,
  limits: ImageLimitsView | null,
): { next: PendingImage[]; rejection: ImageRejection | null } {
  const rejection = validatePendingImage(image, limits)
  if (rejection !== null) return { next: current, rejection }
  const next = [...current, image]
  if (limits !== null && next.length > limits.maxImagesPerMessage) {
    return { next: current, rejection: { kind: 'count', count: limits.maxImagesPerMessage } }
  }
  if (limits !== null) {
    const total = next.reduce((sum, item) => sum + imageBytes(item), 0)
    if (total > limits.maxMessageImageBytes) {
      return { next: current, rejection: { kind: 'totalSize', sizeLabel: formatBytes(limits.maxMessageImageBytes) } }
    }
  }
  return { next, rejection: null }
}

export type ComposerContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }
  | { type: 'file'; receiptId: string }

/** Assemble the prompt content array in the canonical images-then-text order. */
export function buildPromptContent(
  text: string,
  images: PendingImage[],
  readyFiles: { receiptId: string }[],
): ComposerContentPart[] {
  return [
    ...(text !== '' ? [{ type: 'text' as const, text }] : []),
    ...images.map(image => ({
      type: 'image' as const,
      mediaType: image.mediaType,
      data: image.data,
      ...(image.name === null || image.name === undefined ? {} : { name: image.name }),
    })),
    ...readyFiles.map(file => ({ type: 'file' as const, receiptId: file.receiptId })),
  ]
}
