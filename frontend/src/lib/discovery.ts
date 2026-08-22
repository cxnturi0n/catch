// Public discovery form: data access lives behind the Catch API
// (/public/discovery/*). Only slug validation stays here.

/** Slugs are lowercase alphanumeric + hyphens only. Anything else is invalid. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug) && slug.length > 0 && slug.length <= 64
}

export {
  fetchDiscoveryForm,
  fetchAllDiscoveryResponses,
  submitDiscoveryResponse,
  type DiscoveryFormRow,
  type DiscoveryResponseRow,
  type SubmitResponseInput,
  type FetchFormResult,
  type FetchResponsesResult,
} from './api/misc'
