import { describe, expect, it, vi } from 'vitest'
import type { SyncRequest } from '../../../shared/types'
import { submitSyncRequest } from './sync-request'

describe('submitSyncRequest', () => {
  it('routes dry-run requests to buildPlan without calling execute', async () => {
    const buildPlan = vi.fn(async (req: SyncRequest) => ({
      ok: true as const,
      data: { steps: [{ table: req.tables[0] ?? '', description: 'preview', sqls: [] }] }
    }))
    const execute = vi.fn(async () => ({ ok: true as const, data: { executed: 1, errors: 0 } }))
    const req = createSyncRequest(true)

    const result = await submitSyncRequest({ buildPlan, execute }, req)

    expect(buildPlan).toHaveBeenCalledTimes(1)
    expect(buildPlan).toHaveBeenCalledWith(req)
    expect(execute).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      data: { steps: [{ table: 'users', description: 'preview', sqls: [] }] }
    })
  })

  it('routes non-dry-run requests to execute without calling buildPlan', async () => {
    const buildPlan = vi.fn(async () => ({ ok: true as const, data: { steps: [] } }))
    const execute = vi.fn(async (req: SyncRequest) => ({
      ok: true as const,
      data: { executed: req.tables.length, errors: 0 }
    }))
    const req = createSyncRequest(false)

    const result = await submitSyncRequest({ buildPlan, execute }, req)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(req)
    expect(buildPlan).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, data: { executed: 1, errors: 0 } })
  })
})

function createSyncRequest(dryRun: true): SyncRequest & { dryRun: true }
function createSyncRequest(dryRun: false): SyncRequest & { dryRun: false }
function createSyncRequest(dryRun: boolean): SyncRequest {
  return {
    sourceConnectionId: 'source-conn',
    sourceDatabase: 'source_db',
    targetConnectionId: 'target-conn',
    targetDatabase: 'target_db',
    tables: ['users'],
    syncStructure: true,
    syncData: true,
    existingTableStrategy: 'skip',
    dryRun
  }
}