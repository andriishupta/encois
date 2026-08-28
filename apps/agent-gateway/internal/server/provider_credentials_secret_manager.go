package server

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"google.golang.org/api/secretmanager/v1"
)

type secretManagerCredentialStore struct {
	service   *secretmanager.Service
	projectID string
}

func newSecretManagerCredentialStore(ctx context.Context, projectID string) (ProviderCredentialStore, error) {
	if strings.TrimSpace(projectID) == "" {
		return nil, fmt.Errorf("Google Cloud project is required for provider credentials")
	}
	service, err := secretmanager.NewService(ctx)
	if err != nil {
		return nil, fmt.Errorf("create Secret Manager client: %w", err)
	}
	return &secretManagerCredentialStore{service: service, projectID: projectID}, nil
}

func (s *secretManagerCredentialStore) Read(ctx context.Context, reference string) ([]byte, error) {
	pathValue, err := s.secretPath(reference)
	if err != nil {
		return nil, err
	}
	access, err := s.service.Projects.Secrets.Versions.Access(pathValue + "/versions/latest").Context(ctx).Do()
	if err != nil {
		return nil, err
	}
	if access.Payload == nil || len(access.Payload.Data) == 0 {
		return nil, ErrProviderCredential
	}
	decoded, err := base64.StdEncoding.DecodeString(access.Payload.Data)
	if err != nil {
		return nil, fmt.Errorf("decode Secret Manager payload: %w", err)
	}
	return decoded, nil
}

func (s *secretManagerCredentialStore) Write(ctx context.Context, reference string, payload []byte) error {
	pathValue, err := s.secretPath(reference)
	if err != nil {
		return err
	}
	_, err = s.service.Projects.Secrets.AddVersion(pathValue, &secretmanager.AddSecretVersionRequest{
		Payload: &secretmanager.SecretPayload{Data: base64.StdEncoding.EncodeToString(payload)},
	}).Context(ctx).Do()
	if err != nil {
		return fmt.Errorf("add provider credential version: %w", err)
	}
	return nil
}

func (s *secretManagerCredentialStore) secretPath(reference string) (string, error) {
	const prefix = "secretmanager://projects/"
	if !strings.HasPrefix(reference, prefix) {
		return "", fmt.Errorf("unsupported credential reference")
	}
	pathValue := strings.TrimPrefix(reference, "secretmanager://")
	parts := strings.Split(pathValue, "/")
	if len(parts) != 4 || parts[0] != "projects" || parts[2] != "secrets" || parts[1] != s.projectID || parts[3] == "" || strings.ContainsAny(parts[3], "\r\n") {
		return "", fmt.Errorf("credential reference is outside the configured project")
	}
	return pathValue, nil
}
