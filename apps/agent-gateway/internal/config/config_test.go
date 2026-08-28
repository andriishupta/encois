package config

import "testing"

func validMockConfig() Config {
	return Config{
		ServiceToken:     "gateway-token",
		CapabilitySecret: "capability-secret",
		PolicyVersion:    "policy-read-only-fixture-v1",
		DataMode:         "mock",
		StorageMode:      "memory",
	}
}

func TestValidateRequiresExplicitGatewayCredentials(t *testing.T) {
	if err := validMockConfig().Validate(); err != nil {
		t.Fatal(err)
	}
	config := validMockConfig()
	config.ServiceToken = ""
	if err := config.Validate(); err == nil {
		t.Fatal("expected missing service token to fail closed")
	}
	config = validMockConfig()
	config.DataMode = "implicit-mock"
	if err := config.Validate(); err == nil {
		t.Fatal("expected unsupported data mode to fail closed")
	}
}

func TestFromEnvDoesNotSelectDataPlaneImplicitly(t *testing.T) {
	t.Setenv("AGENT_GATEWAY_DATA_MODE", "")
	t.Setenv("AGENT_GATEWAY_STORAGE_MODE", "")
	config := FromEnv()
	if config.DataMode != "" || config.StorageMode != "" {
		t.Fatalf("gateway data-plane modes must be explicit: %#v", config)
	}
}

func TestValidateRequiresGCPDataPlaneConfiguration(t *testing.T) {
	config := validMockConfig()
	config.DataMode = "gcp"
	if err := config.Validate(); err == nil {
		t.Fatal("expected missing GCP data plane configuration")
	}
	config.StorageMode = "gcs"
	config.StorageBucket = "bucket"
	config.StorageMode = "gcs"
	config.SpannerDatabase = "projects/p/instances/i/databases/d"
	config.GoogleCloudProject = "project"
	config.ControlPlaneURL = "https://control-plane.example"
	config.ControlPlaneToken = "control-token"
	if err := config.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateDoesNotAllowMemoryStorageInGCPMode(t *testing.T) {
	config := validMockConfig()
	config.DataMode = "gcp"
	config.StorageBucket = "bucket"
	config.SpannerDatabase = "projects/p/instances/i/databases/d"
	config.GoogleCloudProject = "project"
	config.ControlPlaneURL = "https://control-plane.example"
	config.ControlPlaneToken = "control-token"
	if err := config.Validate(); err == nil {
		t.Fatal("expected GCP mode to require the Cloud Storage adapter")
	}
}

func TestValidateHybridRequiresSpannerAndProject(t *testing.T) {
	config := validMockConfig()
	config.DataMode = "hybrid"
	config.StorageMode = "gcs"
	config.StorageBucket = "demo-encois.appspot.com"
	if err := config.Validate(); err == nil {
		t.Fatal("expected hybrid mode to require Spanner and Google Cloud project configuration")
	}
	config.SpannerDatabase = "projects/p/instances/i/databases/d"
	config.GoogleCloudProject = "project"
	if err := config.Validate(); err != nil {
		t.Fatal(err)
	}
}
