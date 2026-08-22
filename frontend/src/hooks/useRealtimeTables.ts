// Live updates will arrive over Server-Sent Events from the API in a later
// step. Until then this hook is a no-op: every consumer keeps its own polling
// interval as the floor, exactly as before.
export function useRealtimeTables(_workspaceId: string | null | undefined, _tables: readonly string[], _onChange: () => void) {}
