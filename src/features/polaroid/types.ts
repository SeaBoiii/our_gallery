export type FrameId = 'ivory' | 'airmail' | 'clouds'

export type PolaroidSettings = {
  frame: FrameId
  caption: string
  celebration: 'both' | 'solemnisation' | 'reception'
  finish: 'original' | 'warm' | 'mono'
  zoom: number
  positionX: number
  positionY: number
  rotation: 0 | 90 | 180 | 270
}

export type BoothLayout = 'strip' | 'grid' | 'single'
export type PhotoCrop = Pick<PolaroidSettings, 'zoom' | 'positionX' | 'positionY' | 'rotation'>
export type BoothSettings = Pick<PolaroidSettings, 'frame' | 'caption' | 'celebration' | 'finish'> & { layout: BoothLayout }
export type BoothPhoto = { photo: LoadedPhoto; crop: PhotoCrop }
export type PhotoRect = { x: number; y: number; width: number; height: number }
export type BoothLayoutGeometry = { width: number; height: number; photoRects: PhotoRect[] }

/** Owns its decoded local image. Call dispose when replacing it or leaving the editor. */
export type LoadedPhoto = {
  source: CanvasImageSource
  width: number
  height: number
  dispose: () => void
}

export type PhotoGeometry = {
  scale: number
  imageDrawWidth: number
  imageDrawHeight: number
  rotatedDrawWidth: number
  rotatedDrawHeight: number
  panLimitX: number
  panLimitY: number
  offsetX: number
  offsetY: number
  /** Crop bounds in the rotated source's coordinate system. */
  sourceCrop: { x: number; y: number; width: number; height: number }
}
