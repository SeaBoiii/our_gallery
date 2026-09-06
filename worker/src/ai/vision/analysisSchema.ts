import { z } from 'zod'

export const WEDDING_CATEGORY_NAMES = [
  'Couple', 'Family', 'Friends', 'Guests', 'Group Photo', 'Portrait', 'Selfie',
  'Candid', 'Ceremony', 'Reception', 'Stage / Pelamin', 'Decor', 'Venue', 'Food',
  'Wedding Details', 'Outfit', 'Table', 'Entrance', 'Performance',
  'Behind the Scenes', 'Night', 'Other',
] as const

export const visionAnalysisSchema = z.object({
  caption: z.string().trim().min(8).max(240),
  categories: z.array(z.object({
    name: z.enum(WEDDING_CATEGORY_NAMES),
    confidence: z.number().min(0).max(1),
  }).strip()).min(1).max(8),
  scene: z.string().trim().min(2).max(120),
  objects: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  quality: z.object({
    blur: z.enum(['low', 'medium', 'high', 'unknown']),
    brightness: z.enum(['dark', 'good', 'bright', 'unknown']),
  }).strip(),
}).strip()

export type VisionAnalysis = z.infer<typeof visionAnalysisSchema>

// This deliberately favors a neutral fallback over retaining uncertain prose.
// The taxonomy remains independently constrained by WEDDING_CATEGORY_NAMES.
const SENSITIVE_LANGUAGE = /\b(?:aleem|nurul|identity|identif(?:y|ies|ied)|named?|race|racial|ethnic(?:ity)?|asian|malay|chinese|indian|indigenous|caucasian|black|white|religion|religious|muslim|islam(?:ic)?|christian|catholic|hindu|buddhist|sikh|jewish|nationalit(?:y|ies)|singaporean|malaysian|disab(?:ility|led)|wheelchair|health|healthy|unhealthy|medical|ill|sick|sexual(?:ity| orientation)?|politic(?:al|s)|gender|male|female|man|men|woman|women|boy|boys|girl|girls|bride|groom|husband|wife|mother|father|parent|son|daughter|brother|sister|sibling|cousin|relative|age|aged|young|younger|old|older|elderly|teen(?:ager)?|adult|child|children|baby|babies|pregnan(?:t|cy)|attractiv(?:e|eness)|handsome|pretty|beautiful person|emotion(?:al)?|happy|happiness|sad|angry|joyful|excited|nervous|anxious|gay|lesbian|straight|transgender|nonbinary|relationship|married|dating)\b|\b\d{1,3}[ -]?(?:years? old|yo)\b/i

function safeText(value: string, fallback: string) {
  return SENSITIVE_LANGUAGE.test(value) ? fallback : value
}

export function parseAndSanitizeVisionAnalysis(value: unknown, eventDisplayName: string): VisionAnalysis {
  const parsed = visionAnalysisSchema.parse(value)
  const categories = Array.from(new Map(parsed.categories.map((category) => [category.name, category])).values())
  return {
    caption: safeText(parsed.caption, `A wedding memory from ${eventDisplayName}.`),
    categories,
    scene: safeText(parsed.scene, 'wedding celebration'),
    objects: parsed.objects.filter((object) => !SENSITIVE_LANGUAGE.test(object)),
    quality: parsed.quality,
  }
}

export const visionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['caption', 'categories', 'scene', 'objects', 'quality'],
  properties: {
    caption: { type: 'string', minLength: 8, maxLength: 240 },
    categories: {
      type: 'array', minItems: 1, maxItems: 8,
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'confidence'],
        properties: {
          name: { type: 'string', enum: WEDDING_CATEGORY_NAMES },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    scene: { type: 'string', minLength: 2, maxLength: 120 },
    objects: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 60 } },
    quality: {
      type: 'object', additionalProperties: false, required: ['blur', 'brightness'],
      properties: {
        blur: { type: 'string', enum: ['low', 'medium', 'high', 'unknown'] },
        brightness: { type: 'string', enum: ['dark', 'good', 'bright', 'unknown'] },
      },
    },
  },
} as const
