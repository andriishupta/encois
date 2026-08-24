package config

import "os"

type Config struct {
	HTTPAddr             string
	GinMode              string
	PolicyVersion        string
	ServiceToken         string
	CapabilitySecret     string
	DataMode             string
	StorageMode          string
	StorageBucket        string
	SpannerDatabase      string
	GoogleCloudProject   string
	ControlPlaneURL      string
	ControlPlaneToken    string
	ControlPlaneAudience string
	OAuthConfigJSON      string
}

func FromEnv() Config {
	return Config{
		HTTPAddr:         envOrDefault("AGENT_GATEWAY_HTTP_ADDR", ":8080"),
		GinMode:          os.Getenv("GIN_MODE"),
		PolicyVersion:    envOrDefault("AGENT_GATEWAY_POLICY_VERSION", "policy-read-only-fixture-v1"),
		ServiceToken:     os.Getenv("AGENT_GATEWAY_SERVICE_TOKEN"),
		CapabilitySecret: os.Getenv("AGENT_GATEWAY_CAPABILITY_SECRET"),
		// Hosted and non-test processes must use the real data plane by default.
		// Local Compose and .env.example opt into mock mode explicitly.
		DataMode:             envOrDefault("AGENT_GATEWAY_DATA_MODE", "gcp"),
		StorageMode:          envOrDefault("AGENT_GATEWAY_STORAGE_MODE", "memory"),
		StorageBucket:        os.Getenv("GCP_STORAGE_BUCKET"),
		SpannerDatabase:      os.Getenv("SPANNER_DATABASE"),
		GoogleCloudProject:   os.Getenv("GOOGLE_CLOUD_PROJECT"),
		ControlPlaneURL:      os.Getenv("CONTROL_PLANE_URL"),
		ControlPlaneToken:    os.Getenv("CONTROL_PLANE_SERVICE_TOKEN"),
		ControlPlaneAudience: os.Getenv("CONTROL_PLANE_AUDIENCE"),
		OAuthConfigJSON:      os.Getenv("INTEGRATION_OAUTH_CONFIG_JSON"),
	}
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
