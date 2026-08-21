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

func TestInvalidAgentAIModeIsRejected(t *testing.T) {
	if _, err := NewBundle(context.Background(), Config{Mode: "unknown"}); err == nil {
		t.Fatal("expected unsupported AI mode error")
	}
}
