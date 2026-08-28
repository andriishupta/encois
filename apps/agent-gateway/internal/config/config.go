package config

import (
	"fmt"
	"os"
)

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
		HTTPAddr:             envOrDefault("AGENT_GATEWAY_HTTP_ADDR", ":8080"),
		GinMode:              os.Getenv("GIN_MODE"),
		PolicyVersion:        os.Getenv("AGENT_GATEWAY_POLICY_VERSION"),
		ServiceToken:         os.Getenv("AGENT_GATEWAY_SERVICE_TOKEN"),
		CapabilitySecret:     os.Getenv("AGENT_GATEWAY_CAPABILITY_SECRET"),
		DataMode:             os.Getenv("AGENT_GATEWAY_DATA_MODE"),
		StorageMode:          os.Getenv("AGENT_GATEWAY_STORAGE_MODE"),
		StorageBucket:        os.Getenv("GCP_STORAGE_BUCKET"),
		SpannerDatabase:      os.Getenv("SPANNER_DATABASE"),
		GoogleCloudProject:   os.Getenv("GOOGLE_CLOUD_PROJECT"),
		ControlPlaneURL:      os.Getenv("CONTROL_PLANE_URL"),
		ControlPlaneToken:    os.Getenv("CONTROL_PLANE_SERVICE_TOKEN"),
		ControlPlaneAudience: os.Getenv("CONTROL_PLANE_AUDIENCE"),
		OAuthConfigJSON:      os.Getenv("INTEGRATION_OAUTH_CONFIG_JSON"),
	}
}

func (c Config) Validate() error {
	if c.ServiceToken == "" {
		return fmt.Errorf("AGENT_GATEWAY_SERVICE_TOKEN is required")
	}
	if c.CapabilitySecret == "" {
		return fmt.Errorf("AGENT_GATEWAY_CAPABILITY_SECRET is required")
	}
	if c.PolicyVersion == "" {
		return fmt.Errorf("AGENT_GATEWAY_POLICY_VERSION is required")
	}
	if c.DataMode != "mock" && c.DataMode != "gcp" && c.DataMode != "hybrid" {
		return fmt.Errorf("unsupported AGENT_GATEWAY_DATA_MODE %q; use gcp, hybrid, or explicit mock", c.DataMode)
	}
	if c.StorageMode != "memory" && c.StorageMode != "gcs" {
		return fmt.Errorf("unsupported AGENT_GATEWAY_STORAGE_MODE %q; use memory or gcs", c.StorageMode)
	}
	if (c.DataMode == "gcp" || c.DataMode == "hybrid") && c.StorageMode != "gcs" {
		return fmt.Errorf("AGENT_GATEWAY_STORAGE_MODE=gcs is required for AGENT_GATEWAY_DATA_MODE=%s", c.DataMode)
	}
	if c.StorageMode == "gcs" && c.StorageBucket == "" {
		return fmt.Errorf("GCP_STORAGE_BUCKET is required for AGENT_GATEWAY_STORAGE_MODE=gcs")
	}
	if c.DataMode == "gcp" {
		for name, value := range map[string]string{
			"GCP_STORAGE_BUCKET":          c.StorageBucket,
			"SPANNER_DATABASE":            c.SpannerDatabase,
			"GOOGLE_CLOUD_PROJECT":        c.GoogleCloudProject,
			"CONTROL_PLANE_URL":           c.ControlPlaneURL,
			"CONTROL_PLANE_SERVICE_TOKEN": c.ControlPlaneToken,
		} {
			if value == "" {
				return fmt.Errorf("%s is required for AGENT_GATEWAY_DATA_MODE=gcp", name)
			}
		}
	}
	if c.DataMode == "hybrid" {
		for name, value := range map[string]string{
			"GCP_STORAGE_BUCKET":   c.StorageBucket,
			"SPANNER_DATABASE":     c.SpannerDatabase,
			"GOOGLE_CLOUD_PROJECT": c.GoogleCloudProject,
		} {
			if value == "" {
				return fmt.Errorf("%s is required for AGENT_GATEWAY_DATA_MODE=hybrid", name)
			}
		}
	}
	return nil
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
