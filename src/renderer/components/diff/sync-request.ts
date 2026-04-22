import type { IPCResult, SyncPlan, SyncRequest } from '../../../shared/types'

export interface SyncRequestRouter {
  buildPlan(req: SyncRequest): Promise<IPCResult<SyncPlan>>
  execute(req: SyncRequest): Promise<IPCResult<{ executed: number; errors: number }>>
}

export function submitSyncRequest(
  router: SyncRequestRouter,
  req: SyncRequest & { dryRun: true }
): Promise<IPCResult<SyncPlan>>
export function submitSyncRequest(
  router: SyncRequestRouter,
  req: SyncRequest & { dryRun: false }
): Promise<IPCResult<{ executed: number; errors: number }>>
export function submitSyncRequest(router: SyncRequestRouter, req: SyncRequest) {
  return req.dryRun ? router.buildPlan(req) : router.execute(req)
}