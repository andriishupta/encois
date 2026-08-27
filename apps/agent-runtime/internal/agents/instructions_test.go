package agents

import (
	"strings"
	"testing"

	contracts "github.com/andriishupta/encois/packages/contracts"
)

func TestDecodeAgentResultAddsWarningWhenSuccessHasNoGrounding(t *testing.T) {
	result, err := DecodeAgentResult(`{"contractVersion":"agent-result.v1","status":"success","summary":"No grounded records were returned.","sources":[],"evidence":[],"warnings":[]}`)
	if err != nil {
		t.Fatalf("decode agent result: %v", err)
	}
	if len(result.Warnings) != 1 || !strings.Contains(result.Warnings[0], "No source") {
		t.Fatalf("expected grounding warning, got %+v", result.Warnings)
	}
}

func TestDecodeAgentResultRejectsInconsistentGroundingStatus(t *testing.T) {
	_, err := DecodeAgentResult(`{"contractVersion":"agent-result.v1","status":"no_evidence","summary":"No evidence.","sources":[],"evidence":[{"reference":"source://one","claim":"Claim"}],"warnings":[]}`)
	if err == nil {
		t.Fatal("expected no_evidence result with evidence to be rejected")
	}
}

func TestBuildInstructionUsesVersionedContract(t *testing.T) {
	instruction := BuildInstruction("test-agent", string(contracts.ContractAgentResult))
	if !strings.Contains(instruction, `"contractVersion":"agent-instructions.v1"`) {
		t.Fatalf("instruction does not contain its contract version: %s", instruction)
	}
	if !strings.Contains(instruction, `"outputContract":"agent-result.v1"`) {
		t.Fatalf("instruction does not name the output contract: %s", instruction)
	}
}
