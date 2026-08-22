package config

import "os"

type Config struct {
	HTTPAddr              string
	RuntimeServiceToken   string
	TemporalHostPort      string
	TemporalNamespace     string
	TemporalAPIKey        string
	TaskQueue             string
	AgentAIMode           string
	GeminiAPIKey          string
	UseVertexAI           bool
	GoogleCloudProject    string
	GoogleCloudLocation   string
	GeminiModel           string
	CoordinatorModel      string
	CoordinatorThink      string
	AgentGatewayURL       string
	AgentGatewayToken     string
	AgentGatewayAudience  string
	ControlPlaneURL       string
	ControlPlaneToken     string
	ControlPlaneAudience  string
	MemoryMode            string
	MemoryReasoningEngine string
}

func FromEnv() Config {
	geminiKey := os.Getenv("GEMINI_API_KEY")
	if geminiKey == "" {
		geminiKey = os.Getenv("GOOGLE_API_KEY")
	}
	return Config{
		HTTPAddr:              runtimeHTTPAddr(),
		RuntimeServiceToken:   os.Getenv("AGENT_RUNTIME_SERVICE_TOKEN"),
		TemporalHostPort:      envOrDefault("TEMPORAL_HOST_PORT", "127.0.0.1:7233"),
		TemporalNamespace:     envOrDefault("TEMPORAL_NAMESPACE", "default"),
		TemporalAPIKey:        os.Getenv("TEMPORAL_API_KEY"),
		TaskQueue:             envOrDefault("TEMPORAL_TASK_QUEUE", "encois-agent-runtime"),
		AgentAIMode:           envOrDefault("AGENT_AI_MODE", "gemini"),
		GeminiAPIKey:          geminiKey,
		UseVertexAI:           envBool("GOOGLE_GENAI_USE_VERTEXAI"),
		GoogleCloudProject:    os.Getenv("GOOGLE_CLOUD_PROJECT"),
		GoogleCloudLocation:   envOrDefault("GOOGLE_CLOUD_LOCATION", "us-central1"),
		GeminiModel:           envOrDefault("GEMINI_MODEL", "gemini-3.7-flash"),
		CoordinatorModel:      envOrDefault("GEMINI_COORDINATOR_MODEL", "gemini-3.1-pro-preview"),
		CoordinatorThink:      envOrDefault("GEMINI_COORDINATOR_THINKING_LEVEL", "high"),
		AgentGatewayURL:       envOrDefault("AGENT_GATEWAY_URL", "http://127.0.0.1:8080"),
		AgentGatewayToken:     os.Getenv("AGENT_GATEWAY_SERVICE_TOKEN"),
		AgentGatewayAudience:  os.Getenv("AGENT_GATEWAY_AUDIENCE"),
		ControlPlaneURL:       os.Getenv("CONTROL_PLANE_URL"),
		ControlPlaneToken:     os.Getenv("CONTROL_PLANE_SERVICE_TOKEN"),
		ControlPlaneAudience:  os.Getenv("CONTROL_PLANE_AUDIENCE"),
		MemoryMode:            envOrDefault("AGENT_MEMORY_MODE", "gcp"),
		MemoryReasoningEngine: os.Getenv("VERTEX_MEMORY_REASONING_ENGINE"),
	}
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
