import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const tutorials = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/tutorials' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number(),
    section: z.string(),
    badge: z.string().optional(),
  }),
})

export const collections = { tutorials }

