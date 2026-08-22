// Barrel kept for existing imports. Every function lives in lib/api/*; this
// file has no data access of its own any more.
export {
  fetchModerators,
  addModerator,
  updateModerator,
  addModeratorWarning,
  removeModerator,
  seedModerators,
  fetchPointsConfig,
  seedPointsConfig,
  upsertPointsMetric,
  deletePointsMetric,
  fetchConversionConfig,
  upsertConversionConfig,
  fetchModeratorMetrics,
  upsertModeratorMetric,
  fetchPayments,
  addPayment,
  type PointsMetricInput,
} from './api/moderators'
export { fetchTasks, addTask, updateTaskStatus, seedTasks } from './api/operations'
export {
  fetchPlatformMetrics,
  fetchPlatformMetricRows,
  fetchMemberMessageTrend,
  fetchMetricSnapshots,
  fetchMemberMessages,
  fetchTelegramMembershipCounts,
  type LiveMetrics,
  type PlatformMetricDay,
  type MetricSnapshot,
  type MemberMessageStat,
  type MembershipEventCounts,
} from './api/metrics'
export {
  submitFeedback,
  fetchRoadmapFeedback,
  fetchAllFeedback,
  updateFeedbackStatus,
  fetchIncidents,
  addIncident,
  seedIncidents,
  fetchKOLs,
  addKOL,
  seedKOLs,
} from './api/misc'
export { getProfile, updateProfileTimezone, markLayoutPromptSeen, defaultIntegrations, fetchIntegrations, type ProfileRow, type NewWorkspaceInput } from './api/workspaces'
