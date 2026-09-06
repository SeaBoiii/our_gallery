import type { AdminMedia, AdminStats, GalleryEvent, GalleryMedia, GallerySettings } from '../../shared/contracts'

export const mockEvents: GalleryEvent[] = [
  { id: 'event-solemnisation', slug: 'solemnisation', name: 'solemnisation', eventDate: '2027-08-21', displayName: 'Solemnisation', uploadEnabled: true },
  { id: 'event-reception', slug: 'reception', name: 'reception', eventDate: '2027-08-22', displayName: "Groom's Reception", uploadEnabled: true },
]

const memory = (id: string, eventIndex: 0 | 1, mediaType: 'photo' | 'video', guestName: string | null, guestMessage: string | null, aspect: 'portrait' | 'landscape'): GalleryMedia => ({
  id,
  event: mockEvents[eventIndex],
  mediaType,
  mimeType: mediaType === 'photo' ? 'image/webp' : 'video/mp4',
  thumbnailUrl: `/samples/sample-${Number(id.split('-')[1]) % 4 || 4}.webp`,
  displayUrl: mediaType === 'video' ? '/samples/sample-video.mp4' : `/samples/sample-${Number(id.split('-')[1]) % 4 || 4}.webp`,
  width: mediaType === 'video' ? 360 : aspect === 'portrait' ? 900 : 1400,
  height: mediaType === 'video' ? 480 : aspect === 'portrait' ? 1200 : 900,
  durationSeconds: mediaType === 'video' ? 4 : null,
  guestName,
  guestMessage,
  createdAt: `2027-08-${eventIndex ? '22' : '21'}T${String(9 + Number(id.split('-')[1])).padStart(2, '0')}:15:00.000Z`,
})

export const mockGallery: GalleryMedia[] = [
  memory('memory-1', 0, 'photo', 'Aisyah', 'A quiet moment before the ceremony.', 'portrait'),
  memory('memory-2', 0, 'photo', 'Faris & Hana', 'The details were beautiful.', 'landscape'),
  memory('memory-3', 1, 'photo', null, 'To a lifetime of new adventures.', 'portrait'),
  memory('memory-4', 1, 'video', 'Uncle Rahman', 'The room when you both arrived!', 'landscape'),
  memory('memory-5', 1, 'photo', 'Mei Lin', null, 'landscape'),
  memory('memory-6', 0, 'photo', 'Sara', 'Every little detail felt like you.', 'portrait'),
  memory('memory-7', 1, 'photo', 'The cousins', 'From SIN to forever.', 'landscape'),
  memory('memory-8', 1, 'video', null, null, 'portrait'),
]

export const mockAdminStats: AdminStats = {
  totalUploads: 148,
  totalPhotos: 134,
  totalVideos: 14,
  uploadsToday: 72,
  dayOne: 63,
  dayTwo: 85,
  approved: 121,
  pending: 19,
  rejected: 8,
  derivativeFailures: 3,
  storage: {
    totalBytes: 83.4 * 1024 ** 3,
    originalBytes: 79.1 * 1024 ** 3,
    displayBytes: 3.6 * 1024 ** 3,
    thumbnailBytes: 0.7 * 1024 ** 3,
    photoBytes: 31.2 * 1024 ** 3,
    videoBytes: 52.2 * 1024 ** 3,
    referenceTargetBytes: 500 * 1024 ** 3,
    softWarningBytes: 450 * 1024 ** 3,
    hardLimitBytes: null,
  },
}

export const mockAdminMedia: AdminMedia[] = mockGallery.slice(0, 6).map((item, index) => ({
  id: item.id,
  eventSlug: item.event.slug,
  eventDisplayName: item.event.displayName,
  mediaType: item.mediaType,
  mimeType: item.mimeType,
  originalFilename: index === 3 ? 'VID_0274.MOV' : `IMG_${4210 + index}.JPG`,
  guestName: item.guestName,
  guestMessage: item.guestMessage,
  status: index < 4 ? 'pending' : 'approved',
  derivativeStatus: index === 2 ? 'partial' : 'ready',
  sizeBytes: item.mediaType === 'video' ? 86 * 1024 ** 2 : 8.4 * 1024 ** 2,
  createdAt: item.createdAt,
  thumbnailUrl: item.thumbnailUrl,
  originalDownloadUrl: item.displayUrl,
}))

export const mockSettings: GallerySettings = {
  uploadsEnabled: true,
  autoApproveUploads: false,
  liveWallSource: 'all',
  events: mockEvents,
}
