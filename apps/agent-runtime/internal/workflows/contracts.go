package workflows

type Scope struct {
	TeamIDs    []string `json:"teamIds,omitempty"`
	ProjectIDs []string `json:"projectIds,omitempty"`
}

type ReleaseRiskInput struct {
	ContractVersion string `json:"contractVersion"`
	RequestID       string `json:"requestId"`
	WorkflowID      string `json:"workflowId"`
	OrganizationID  string `json:"organizationId"`
	ActorID         string `json:"actorId"`
	Scope           Scope  `json:"scope"`
	ReleaseID       string `json:"releaseId"`
	PolicyVersion   string `json:"policyVersion"`
}

type EvidenceBatch struct {
	ContractVersion string         `json:"contractVersion"`
	BatchID         string         `json:"batchId"`
	Source          string         `json:"source"`
	ReleaseID       string         `json:"releaseId"`
	ObservedAt      string         `json:"observedAt"`
	Facts           map[string]any `json:"facts"`
	EvidenceRefs    []string       `json:"evidenceRefs"`
}

type SynthesisInput struct {
	Investigation ReleaseRiskInput `json:"investigation"`
	Jira          EvidenceBatch    `json:"jira"`
	GitHub        EvidenceBatch    `json:"github"`
}

type Insight struct {
	ContractVersion string   `json:"contractVersion"`
	Status          string   `json:"status"`
	Risk            string   `json:"risk"`
	Confidence      string   `json:"confidence"`
	Summary         string   `json:"summary"`
	EvidenceRefs    []string `json:"evidenceRefs"`
}

type ReleaseRiskResult struct {
	ContractVersion string        `json:"contractVersion"`
	WorkflowID      string        `json:"workflowId"`
	InvestigationID string        `json:"investigationId"`
	Jira            EvidenceBatch `json:"jira"`
	GitHub          EvidenceBatch `json:"github"`
	Insight         Insight       `json:"insight"`
}
