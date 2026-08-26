package coordinator

import (
	"encoding/json"
	"testing"
)

func TestCoordinatorStartInputCarriesOnboardingSelections(t *testing.T) {
	raw := []byte(`{"contractVersion":"coordinator.v1","coordinatorId":"organization:org-1","organizationId":"org-1","scopeType":"organization","scope":{"ids":["unit-1"]},"policyVersion":"policy-v1","coordinationMode":"start-coordinator","selectedWorkflowRefs":["release-readiness","release-blueprint"],"state":{"status":"ONBOARDING","version":0,"onboardingComplete":false,"reconciliationCount":0}}`)

	var input CoordinatorStartInput
	if err := json.Unmarshal(raw, &input); err != nil {
		t.Fatal(err)
	}
	if input.CoordinationMode != "start-coordinator" {
		t.Fatalf("unexpected coordination mode: %q", input.CoordinationMode)
	}
	if len(input.SelectedWorkflowRefs) != 2 || input.SelectedWorkflowRefs[0] != "release-readiness" || input.SelectedWorkflowRefs[1] != "release-blueprint" {
		t.Fatalf("unexpected selected workflow refs: %#v", input.SelectedWorkflowRefs)
	}
}
