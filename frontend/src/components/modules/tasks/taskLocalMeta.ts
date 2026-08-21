// Shape of the table's Area / Start date side-map. Values now live on the
// task row itself (tasks.area, tasks.start_date) and are persisted via the API.
export interface TaskMeta {
  area?: string
  start?: string // 'YYYY-MM-DD'
}

export type TaskMetaMap = Record<string, TaskMeta>
