import { command } from './base'

export interface SnapshotInfo {
  id: string
  message: string
  timestamp: number
}

export interface AppendResult {
  projects: number
  categories: number
  entries: number
  tagSchemas: number
  relations: number
  links: number
  entryTypes: number
  ideaNotes: number
}

export const dbSnapshot = () =>
  command<void>('db_snapshot')

export const dbListSnapshots = () =>
  command<SnapshotInfo[]>('db_list_snapshots')

export const dbRollbackTo = (snapshotId: string) =>
  command<void>('db_rollback_to', { snapshotId })

export const dbAppendFrom = (snapshotId: string) =>
  command<AppendResult>('db_append_from', { snapshotId })
