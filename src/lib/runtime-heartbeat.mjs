const DEFAULT_STALE_MS = 120_000

export async function touchRuntimeHeartbeat(prisma, input) {
  const service = String(input?.service || '').trim()
  if (!service) return null

  const now = new Date()
  const data = {
    status: String(input?.status || 'ok'),
    pid: Number.isFinite(Number(input?.pid)) ? Number(input.pid) : process.pid,
    detail: String(input?.detail || ''),
    payload: input?.payload && typeof input.payload === 'object' ? input.payload : {},
    lastSeenAt: now,
  }

  try {
    return await prisma.runtimeHeartbeat.upsert({
      where: { service },
      create: { service, ...data },
      update: data,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!process.env.GOAL_MATE_SUPPRESS_HEARTBEAT_WARNINGS) {
      console.warn(`[runtime] heartbeat failed service=${service}: ${message}`)
    }
    return null
  }
}

export function summarizeRuntimeHeartbeat(record, options = {}) {
  if (!record) {
    return {
      status: 'missing',
      online: false,
      label: '未观察到进程心跳',
      evidence: 'no heartbeat',
      lastSeenAt: null,
    }
  }

  const staleMs = Number(options.staleMs || DEFAULT_STALE_MS)
  const lastSeenAt = record.lastSeenAt ? new Date(record.lastSeenAt) : null
  const ageMs = lastSeenAt && !Number.isNaN(lastSeenAt.getTime()) ? Date.now() - lastSeenAt.getTime() : Number.POSITIVE_INFINITY
  const stale = ageMs > staleMs

  if (stale) {
    return {
      status: 'stale',
      online: false,
      label: '进程心跳已过期',
      evidence: `last=${lastSeenAt?.toISOString?.() || 'unknown'}; status=${record.status}`,
      lastSeenAt,
      pid: record.pid,
    }
  }

  return {
    status: record.status || 'ok',
    online: true,
    label: record.detail || '进程在线',
    evidence: `pid=${record.pid || 'unknown'}; last=${lastSeenAt?.toISOString?.() || 'unknown'}`,
    lastSeenAt,
    pid: record.pid,
    payload: record.payload || {},
  }
}
