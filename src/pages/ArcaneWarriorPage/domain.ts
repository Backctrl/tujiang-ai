export type IssueSeverity = 'none' | 'warning' | 'blocker'
export type RunStatus = 'idle' | 'running' | 'succeeded' | 'failed'
export type Freshness = 'current' | 'stale'
export type ApprovalStatus = 'draft' | 'in_review' | 'approved'

export type StageId = 'setup' | 'facts' | 'story' | 'chapters' | 'market' | 'qa'

export interface Source {
  id: string
  name: string
  meta: string
  status: RunStatus
  facts: number
}

export interface Fact {
  id: string
  claim: string
  kind: '确认' | '冲突' | '缺证据'
  confidence: number | null
  evidence: number
  confirmed: boolean
  locked: boolean
  freshness: Freshness
  severity: IssueSeverity
  source: string
  excerpt: string
}

export interface StorySection {
  id: string
  title: string
  purpose: string
  status: ApprovalStatus
  locked: boolean
  freshness: Freshness
}

export interface Market {
  id: string
  name: string
  channel: string
  language: string
  status: ApprovalStatus
  progress: number
}

export interface QaIssue {
  id: string
  category: string
  title: string
  detail: string
  severity: Exclude<IssueSeverity, 'none'>
  resolved: boolean
  owner: string
  markets: string[]
}

export interface AuditEvent {
  id: number
  time: string
  action: string
  actor: '你' | 'Agent' | '系统'
}

