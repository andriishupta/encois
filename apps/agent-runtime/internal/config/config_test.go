package config

import "testing"

func validMockConfig() Config {
	return Config{
		TemporalHostPort:  "127.0.0.1:7233",
		TemporalNamespace: "default",
		TaskQueue:         "encois-agent-runtime",
		AgentGatewayURL:   "http://127.0.0.1:8080",
		AgentGatewayToken: "runtime-token",
		SourceMode:        "mock",
		AgentAIMode:       "mock",
		MemoryMode:        "mock",
	}
}

func TestValidateRequiresExplicitRuntimeDependencies(t *testing.T) {
	if err := validMockConfig().Validate(); err != nil {
		t.Fatal(err)
	}
	config := validMockConfig()
	config.AgentGatewayToken = ""
	if err := config.Validate(); err == nil {
		t.Fatal("expected missing Agent Gateway token to fail closed")
	}
	config = validMockConfig()
	config.SourceMode = "implicit-mock"
	if err := config.Validate(); err == nil {
		t.Fatal("expected unsupported source mode to fail closed")
	}
}

func TestValidateRequiresRealCredentialsOutsideMockModes(t *testing.T) {
	config := validMockConfig()
	config.AgentAIMode = "gemini"
	if err := config.Validate(); err == nil {
		t.Fatal("expected Gemini credentials to be required")
	}
	config = validMockConfig()
	config.MemoryMode = "gcp"
	if err := config.Validate(); err == nil {
		t.Fatal("expected Memory Bank target to be required")
	}
}

func TestModelConfigurationUsesOneCanonicalName(t *testing.T) {
	t.Setenv("GEMINI_MODEL", "gemini-model-custom")
	t.Setenv("GEMINI_REASONING_THINKING_LEVEL", "medium")
	if got := FromEnv().GeminiModel; got != "gemini-model-custom" {
		t.Fatalf("canonical model variable was not used: %q", got)
	}
	if got := reasoningThinkingFromEnv(); got != "medium" {
		t.Fatalf("canonical reasoning thinking variable was not used: %q", got)
	}
}
