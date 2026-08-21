package config

import "os"

type Config struct {
	HTTPAddr      string
	GinMode       string
	PolicyVersion string
	ServiceToken  string
}

func FromEnv() Config {
	return Config{
		HTTPAddr:      envOrDefault("AGENT_GATEWAY_HTTP_ADDR", ":8080"),
		GinMode:       os.Getenv("GIN_MODE"),
		PolicyVersion: envOrDefault("AGENT_GATEWAY_POLICY_VERSION", "policy-read-only-fixture-v1"),
		ServiceToken:  os.Getenv("AGENT_GATEWAY_SERVICE_TOKEN"),
	}
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
