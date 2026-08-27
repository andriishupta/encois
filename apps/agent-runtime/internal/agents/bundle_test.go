package agents

import (
	"context"
	"testing"
)

func TestMockBundleDoesNotRequireGeminiCredentials(t *testing.T) {
	bundle, err := NewBundle(context.Background(), Config{Mode: ModeMock})
	if err != nil {
		t.Fatalf("create mock bundle: %v", err)
	}
	if !bundle.Enabled || bundle.Mode != ModeMock {
		t.Fatalf("unexpected mock bundle: %+v", bundle)
	}
	result, err := bundle.RunAgentStep(context.Background(), "session-1", "context.summarizer.v1", nil)
	if err != nil {
		t.Fatalf("run mock agent step: %v", err)
	}
	if result == "" {
		t.Fatal("expected mock agent result")
	}
}

func TestBundleUsesOneModelForAllAgentRoles(t *testing.T) {
	bundle, err := NewBundle(context.Background(), Config{Mode: ModeMock})
	if err != nil {
		t.Fatalf("create mock bundle: %v", err)
	}
	if bundle.ModelName != DefaultModel || bundle.ReasoningModelName != DefaultModel {
		t.Fatalf("unexpected default model: standard=%q highLevel=%q", bundle.ModelName, bundle.ReasoningModelName)
	}
	if bundle.ReasoningThinkingLevel == "" {
		t.Fatal("reasoning profile must have an explicit thinking level")
	}

	bundle, err = NewBundle(context.Background(), Config{
		Mode:              ModeMock,
		ModelName:         "gemini-3.7-flash-custom",
		ReasoningThinking: "medium",
	})
	if err != nil {
		t.Fatalf("create custom mock bundle: %v", err)
	}
	if bundle.ModelName != "gemini-3.7-flash-custom" || bundle.ReasoningModelName != "gemini-3.7-flash-custom" || string(bundle.ReasoningThinkingLevel) != "MEDIUM" {
		t.Fatalf("custom model was not applied to all roles: standard=%q highLevel=%q thinking=%q", bundle.ModelName, bundle.ReasoningModelName, bundle.ReasoningThinkingLevel)
	}
}

func TestInvalidAgentAIModeIsRejected(t *testing.T) {
	if _, err := NewBundle(context.Background(), Config{Mode: "unknown"}); err == nil {
		t.Fatal("expected unsupported AI mode error")
	}
}
