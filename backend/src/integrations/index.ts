import { discord } from './discord.js'
import { galxe } from './galxe.js'
import { telegram } from './telegram.js'
import { zealy } from './zealy.js'
import type { PlatformClient } from './types.js'

export * from './types.js'

// Registry keyed by the integration platform id stored in the database.
export const platformClients = {
  discord,
  telegram,
  galxe,
  zealy,
} satisfies Record<string, PlatformClient<Record<string, string>, unknown>>

export type IntegrationPlatform = keyof typeof platformClients
