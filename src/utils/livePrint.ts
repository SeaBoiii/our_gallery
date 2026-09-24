export type LivePrintSize = { width: number; height: number; boundsWidth: number; boundsHeight: number }

export function mediaAspectRatio(width: number | null | undefined, height: number | null | undefined): number | null {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const ratio = width / height
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null
}

/** Fit the image and its mat/caption inside the slot, including the rotated corners. */
export function fitLivePrint(
  box: { width: number; height: number },
  aspect: number,
  insets: { width: number; height: number },
  rotation = 0,
): LivePrintSize | null {
  if (![box.width, box.height, aspect, insets.width, insets.height, rotation].every(Number.isFinite)
    || box.width <= 0 || box.height <= 0 || aspect <= 0 || insets.width < 0 || insets.height < 0) return null
  const radians = rotation * Math.PI / 180
  const cosine = Math.abs(Math.cos(radians))
  const sine = Math.abs(Math.sin(radians))
  const height = Math.min(
    (box.width - cosine * insets.width - sine * insets.height) / (cosine * aspect + sine),
    (box.height - sine * insets.width - cosine * insets.height) / (sine * aspect + cosine),
  )
  if (!Number.isFinite(height) || height <= 0) return null
  const frameWidth = height * aspect + insets.width
  const frameHeight = height + insets.height
  return {
    width: frameWidth, height: frameHeight,
    boundsWidth: cosine * frameWidth + sine * frameHeight,
    boundsHeight: sine * frameWidth + cosine * frameHeight,
  }
}
