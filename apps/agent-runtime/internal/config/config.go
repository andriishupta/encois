package config

import "os"

type Config struct {
	TemporalHostPort  string
	TemporalNamespace string
	TemporalAPIKey    string
	TaskQueue         string
	GeminiAPIKey      string
	GeminiModel       string
	CoordinatorModel  string
	CoordinatorThink  string
	AgentGatewayURL   string
}

func FromEnv() Config {
	geminiKey := os.Getenv("GEMINI_API_KEY")
	if geminiKey == "" {
		geminiKey = os.Getenv("GOOGLE_API_KEY")
	}
	return Config{
		TemporalHostPort:  envOrDefault("TEMPORAL_HOST_PORT", "127.0.0.1:7233"),
		TemporalNamespace: envOrDefault("TEMPORAL_NAMESPACE", "default"),
		TemporalAPIKey:    os.Getenv("TEMPORAL_API_KEY"),
		TaskQueue:         envOrDefault("TEMPORAL_TASK_QUEUE", "encois-agent-runtime"),
		GeminiAPIKey:      geminiKey,
		GeminiModel:       envOrDefault("GEMINI_MODEL", "gemini-3.7-flash"),
		CoordinatorModel:  envOrDefault("GEMINI_COORDINATOR_MODEL", "gemini-3.1-pro-preview"),
		CoordinatorThink:  envOrDefault("GEMINI_COORDINATOR_THINKING_LEVEL", "high"),
		AgentGatewayURL:   envOrDefault("AGENT_GATEWAY_URL", "http://127.0.0.1:8080"),
	}
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
