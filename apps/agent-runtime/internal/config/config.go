package config

import (
	"fmt"
	"os"
)

type Config struct {
	HTTPAddr                     string
	RuntimeServiceToken          string
	TemporalHostPort             string
	TemporalNamespace            string
	TemporalAPIKey               string
	TaskQueue                    string
	AgentAIMode                  string
	GeminiAPIKey                 string
	UseAgentPlatform             bool
	GoogleCloudProject           string
	GoogleCloudLocation          string
	GoogleCloudModelLocation     string
	GeminiModel                  string
	ReasoningThink               string
	AgentGatewayURL              string
	AgentGatewayToken            string
	AgentGatewayAudience         string
	SourceMode                   string
	ControlPlaneURL              string
	ControlPlaneToken            string
	ControlPlaneAudience         string
	MemoryMode                   string
	AgentPlatformReasoningEngine string
}

func FromEnv() Config {
	geminiKey := os.Getenv("GEMINI_API_KEY")
	if geminiKey == "" {
		geminiKey = os.Getenv("GOOGLE_API_KEY")
	}
	return Config{
		HTTPAddr:                     runtimeHTTPAddr(),
		RuntimeServiceToken:          os.Getenv("AGENT_RUNTIME_SERVICE_TOKEN"),
		TemporalHostPort:             envOrDefault("TEMPORAL_HOST_PORT", "127.0.0.1:7233"),
		TemporalNamespace:            envOrDefault("TEMPORAL_NAMESPACE", "encois"),
		TemporalAPIKey:               os.Getenv("TEMPORAL_API_KEY"),
		TaskQueue:                    envOrDefault("TEMPORAL_TASK_QUEUE", "encois-agent-runtime"),
		AgentAIMode:                  envOrDefault("AGENT_AI_MODE", "gemini"),
		GeminiAPIKey:                 geminiKey,
		UseAgentPlatform:             envBool("GOOGLE_GENAI_USE_AGENT_PLATFORM"),
		GoogleCloudProject:           os.Getenv("GOOGLE_CLOUD_PROJECT"),
		GoogleCloudLocation:          envOrDefault("GOOGLE_CLOUD_LOCATION", "us-east1"),
		GoogleCloudModelLocation:     envOrDefault("GOOGLE_CLOUD_MODEL_LOCATION", "us"),
		GeminiModel:                  os.Getenv("GEMINI_MODEL"),
		ReasoningThink:               reasoningThinkingFromEnv(),
		AgentGatewayURL:              envOrDefault("AGENT_GATEWAY_URL", "http://127.0.0.1:8080"),
		AgentGatewayToken:            os.Getenv("AGENT_GATEWAY_SERVICE_TOKEN"),
		AgentGatewayAudience:         os.Getenv("AGENT_GATEWAY_AUDIENCE"),
		SourceMode:                   envOrDefault("AGENT_SOURCE_MODE", "gateway"),
		ControlPlaneURL:              os.Getenv("CONTROL_PLANE_URL"),
		ControlPlaneToken:            os.Getenv("CONTROL_PLANE_SERVICE_TOKEN"),
		ControlPlaneAudience:         os.Getenv("CONTROL_PLANE_AUDIENCE"),
		MemoryMode:                   envOrDefault("AGENT_MEMORY_MODE", "gcp"),
		AgentPlatformReasoningEngine: os.Getenv("AGENT_PLATFORM_MEMORY_REASONING_ENGINE"),
	}
}

func (c Config) Validate() error {
	if c.TemporalHostPort == "" || c.TemporalNamespace == "" || c.TaskQueue == "" {
		return fmt.Errorf("Temporal host, namespace, and task queue are required")
	}
	if c.AgentGatewayURL == "" {
		return fmt.Errorf("AGENT_GATEWAY_URL is required; disablement must be explicit in a different worker profile")
	}
	if c.AgentGatewayToken == "" {
		return fmt.Errorf("AGENT_GATEWAY_SERVICE_TOKEN is required")
	}
	if c.SourceMode != "gateway" && c.SourceMode != "mock" {
		return fmt.Errorf("unsupported AGENT_SOURCE_MODE %q; use gateway or explicit mock", c.SourceMode)
	}
	if c.AgentAIMode != "mock" && !c.UseAgentPlatform && c.GeminiAPIKey == "" {
		return fmt.Errorf("Gemini credentials are required unless AGENT_AI_MODE=mock or GOOGLE_GENAI_USE_AGENT_PLATFORM=true")
	}
	if c.MemoryMode != "mock" && c.AgentPlatformReasoningEngine == "" {
		return fmt.Errorf("AGENT_PLATFORM_MEMORY_REASONING_ENGINE is required unless AGENT_MEMORY_MODE=mock")
	}
	if c.MemoryMode != "mock" && c.GoogleCloudLocation == "" {
		return fmt.Errorf("GOOGLE_CLOUD_LOCATION is required unless AGENT_MEMORY_MODE=mock")
	}
	return nil
}

func runtimeHTTPAddr() string {
	if value := os.Getenv("AGENT_RUNTIME_HTTP_ADDR"); value != "" {
		return value
	}
	return ":" + envOrDefault("PORT", "8080")
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func envBool(name string) bool {
	value := os.Getenv(name)
	return value == "1" || value == "true" || value == "TRUE"
}

func reasoningThinkingFromEnv() string {
	return envOrDefault("GEMINI_REASONING_THINKING_LEVEL", "high")
}
