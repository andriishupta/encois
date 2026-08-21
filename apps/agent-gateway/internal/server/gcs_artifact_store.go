package server

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"

	"cloud.google.com/go/storage"
	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
)

type gcsArtifactStore struct {
	client        *storage.Client
	defaultBucket string
}

func newGCSArtifactStore(ctx context.Context, bucket string) (ArtifactStore, func() error, error) {
	if strings.TrimSpace(bucket) == "" {
		return nil, nil, fmt.Errorf("GCP artifact mode requires GCP_STORAGE_BUCKET")
	}
	client, err := storage.NewClient(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("create Cloud Storage client: %w", err)
	}
	store := &gcsArtifactStore{client: client, defaultBucket: bucket}
	return store, client.Close, nil
}

func (s *gcsArtifactStore) Write(ctx context.Context, request domain.ArtifactWriteRequest) (domain.ArtifactWriteResponse, error) {
	objectKey, err := scopedArtifactKey(request)
	if err != nil {
		return domain.ArtifactWriteResponse{}, err
	}
	writer := s.client.Bucket(s.defaultBucket).Object(objectKey).NewWriter(ctx)
	writer.ContentType = request.ContentType
	if _, err := io.WriteString(writer, request.DataRef); err != nil {
		_ = writer.Close()
		return domain.ArtifactWriteResponse{}, fmt.Errorf("write artifact manifest: %w", err)
	}
	if err := writer.Close(); err != nil {
		return domain.ArtifactWriteResponse{}, fmt.Errorf("commit artifact manifest: %w", err)
	}
	return domain.ArtifactWriteResponse{
		ContractVersion: domain.ArtifactWriteResultContractVersion,
		RequestID:       request.RequestID,
		ArtifactRef:     "gs://" + s.defaultBucket + "/" + objectKey,
		ObjectKey:       objectKey,
		Status:          "completed",
		RetentionClass:  defaultRetentionClass(request.RetentionClass),
		RetentionUntil:  request.RetentionUntil,
	}, nil
}

func (s *gcsArtifactStore) Read(ctx context.Context, request domain.ArtifactReadRequest) (domain.ArtifactReadResponse, error) {
	bucket, object, err := parseGCSReference(request.ArtifactRef, s.defaultBucket)
	if err != nil {
		return domain.ArtifactReadResponse{}, err
	}
	if !artifactObjectInOrganization(object, request.OrganizationID) {
		return domain.ArtifactReadResponse{}, fmt.Errorf("artifact is outside the organization scope")
	}
	reader, err := s.client.Bucket(bucket).Object(object).NewReader(ctx)
	if err != nil {
		return domain.ArtifactReadResponse{}, fmt.Errorf("open Cloud Storage artifact: %w", err)
	}
	defer reader.Close()
	if reader.Attrs.Size > 20<<20 {
		return domain.ArtifactReadResponse{}, fmt.Errorf("Cloud Storage artifact exceeds the 20 MiB read limit")
	}
	bytes, err := io.ReadAll(io.LimitReader(reader, 20<<20))
	if err != nil {
		return domain.ArtifactReadResponse{}, fmt.Errorf("read Cloud Storage artifact: %w", err)
	}
	return domain.ArtifactReadResponse{ArtifactRef: request.ArtifactRef, ContentType: reader.ContentType(), Bytes: bytes}, nil
}

func artifactObjectInOrganization(object, organizationID string) bool {
	return strings.HasPrefix(object, organizationID+"/") || strings.HasPrefix(object, "organizations/"+organizationID+"/")
}

func parseGCSReference(reference, fallbackBucket string) (string, string, error) {
	parsed, err := url.Parse(reference)
	if err != nil || parsed.Scheme != "gs" || parsed.Host == "" || strings.Trim(parsed.Path, "/") == "" {
		return "", "", fmt.Errorf("artifactRef must be a gs://bucket/object reference")
	}
	if fallbackBucket != "" && parsed.Host != fallbackBucket {
		return "", "", fmt.Errorf("artifactRef bucket is outside configured bucket")
	}
	return parsed.Host, strings.TrimPrefix(parsed.Path, "/"), nil
}
