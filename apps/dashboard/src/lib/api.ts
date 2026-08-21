import type {
  WorkflowExecutionProjection,
  WorkflowStartRequest,
} from '@encois/contracts'

const apiBaseUrl = ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')

type ApiEnvelope<T> = { data: T }

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body) headers.set('Content-Type', 'application/json')
  if (env?.VITE_ENCOIS_ACCESS_TOKEN) headers.set('Authorization', `Bearer ${env.VITE_ENCOIS_ACCESS_TOKEN}`)
  if (env?.VITE_ENCOIS_ORGANIZATION_ID) headers.set('X-Organization-ID', env.VITE_ENCOIS_ORGANIZATION_ID)

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers })
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | { error?: { message?: string } } | null
  if (!response.ok) {
    const message = body && 'error' in body && body.error?.message ? body.error.message : `API request failed (${response.status})`
    throw new ApiError(response.status, message)
  }
  if (!body || !('data' in body)) throw new ApiError(response.status, 'API returned an invalid response.')
  return body.data
}

export function listWorkflows(): Promise<readonly WorkflowExecutionProjection[]> {
  return request<readonly WorkflowExecutionProjection[]>('/workflows')
}

export function getWorkflow(workflowId: string): Promise<WorkflowExecutionProjection> {
  return request<WorkflowExecutionProjection>(`/workflows/${encodeURIComponent(workflowId)}`)
}

export function startWorkflow(input: WorkflowStartRequest): Promise<WorkflowExecutionProjection> {
  return request<WorkflowExecutionProjection>('/workflows', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
