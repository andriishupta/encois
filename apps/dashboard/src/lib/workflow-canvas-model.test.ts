import { describe, expect, it } from 'vitest'
import { getWorkflowCanvasStages, normalizeWorkflowNodeStatus } from './workflow-canvas-model'

const event = (status: string, id = status) => ({
  id,
  eventType: `activity_${status}`,
  status,
  activityName: 'Investigate critical issues',
  metadata: {},
  occurredAt: '2026-08-23T00:00:00.000Z',
})

describe('workflow canvas status model', () => {
  it('preserves terminal activity statuses instead of treating them as active', () => {
    expect(normalizeWorkflowNodeStatus('failed', 'running')).toBe('failed')
    expect(normalizeWorkflowNodeStatus('partial', 'running')).toBe('partial')
    expect(normalizeWorkflowNodeStatus('waiting_for_approval', 'running')).toBe('waiting')
  })

  it('uses the latest event for an activity and keeps the run terminal state visible', () => {
    expect(getWorkflowCanvasStages([event('running', 'started'), event('failed', 'failed')], 'failed')[0]?.status).toBe('failed')
    expect(getWorkflowCanvasStages([], 'completed')[0]?.status).toBe('completed')
  })
})
