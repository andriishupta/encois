package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path"
	"strings"
	"sync"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/domain"
	contracts "github.com/andriishupta/encois/packages/contracts"
)

// ArtifactStore is the data-plane boundary for tenant-scoped raw artifacts.
// The local implementation is deterministic; hosted wiring uses Cloud Storage
// without changing the execution contract or placing raw data in Temporal
// history.
type ArtifactStore interface {
	Write(context.Context, domain.ArtifactWriteRequest) (domain.ArtifactWriteResponse, error)
	Read(context.Context, domain.ArtifactReadRequest) (domain.ArtifactReadResponse, error)
}

type memoryArtifactStore struct {
	mu      sync.Mutex
	objects map[string]memoryArtifact
}

type memoryArtifact struct {
	ObjectKey      string
	ContentType    string
	DataRef        string
	RetentionClass contracts.ArtifactRetentionClass
	RetentionUntil string
}

func newMemoryArtifactStore() ArtifactStore {
	return &memoryArtifactStore{objects: make(map[string]memoryArtifact)}
}

func (s *memoryArtifactStore) Write(_ context.Context, request domain.ArtifactWriteRequest) (domain.ArtifactWriteResponse, error) {
	objectKey, err := scopedArtifactKey(request)
	if err != nil {
		return domain.ArtifactWriteResponse{}, err
	}

	digest := sha256.Sum256([]byte(request.OrganizationID + "\x00" + request.WorkflowID + "\x00" + objectKey + "\x00" + request.DataRef))
	artifactRef := "artifact://memory/" + hex.EncodeToString(digest[:])
	s.mu.Lock()
	s.objects[artifactRef] = memoryArtifact{
		ObjectKey:      objectKey,
		ContentType:    request.ContentType,
		DataRef:        request.DataRef,
		RetentionClass: defaultRetentionClass(request.RetentionClass),
		RetentionUntil: request.RetentionUntil,
	}
	s.mu.Unlock()

	return domain.ArtifactWriteResponse{
		ContractVersion: domain.ArtifactWriteResultContractVersion,
		RequestID:       request.RequestID,
		ArtifactRef:     artifactRef,
		ObjectKey:       objectKey,
		Status:          "mocked",
		RetentionClass:  defaultRetentionClass(request.RetentionClass),
		RetentionUntil:  request.RetentionUntil,
	}, nil
}

func (s *memoryArtifactStore) Read(_ context.Context, request domain.ArtifactReadRequest) (domain.ArtifactReadResponse, error) {
	if strings.TrimSpace(request.ArtifactRef) == "" {
		return domain.ArtifactReadResponse{}, fmt.Errorf("artifactRef is required")
	}
	s.mu.Lock()
	object, ok := s.objects[request.ArtifactRef]
	s.mu.Unlock()
	if !ok {
		// The API Gateway's local upload fixtures use this explicit namespace.
		// Unknown memory references must not silently become readable from every
		// organization, because the hash reference itself does not carry tenant
		// information.
		if !localArtifactReferenceInOrganization(request.ArtifactRef, request.OrganizationID) {
			return domain.ArtifactReadResponse{}, fmt.Errorf("artifact is not available in the local mock store")
		}
		// The API Gateway's local upload store is intentionally process-local. A
		// deterministic fixture keeps the multi-process local flow useful while
		// the GCP mode reads the real object from Cloud Storage.
		return domain.ArtifactReadResponse{
			ArtifactRef: request.ArtifactRef,
			ContentType: "text/plain",
			Bytes:       []byte("Encois mock source\nsource=" + request.ArtifactRef),
		}, nil
	}
	if !artifactObjectInOrganization(object.ObjectKey, request.OrganizationID) {
		return domain.ArtifactReadResponse{}, fmt.Errorf("artifact is outside the organization scope")
	}
	return domain.ArtifactReadResponse{
		ArtifactRef: request.ArtifactRef,
		ContentType: object.ContentType,
		Bytes:       []byte(object.DataRef),
	}, nil
}

func localArtifactReferenceInOrganization(reference, organizationID string) bool {
	return strings.HasPrefix(reference, "artifact://local/"+organizationID+"/") ||
		strings.HasPrefix(reference, "artifact://memory/organizations/"+organizationID+"/")
}

func defaultRetentionClass(value contracts.ArtifactRetentionClass) contracts.ArtifactRetentionClass {
	if value == "" {
		return contracts.RetentionInvestigation
	}
	return value
}

func scopedArtifactKey(request domain.ArtifactWriteRequest) (string, error) {
	raw := strings.TrimSpace(request.ObjectKey)
	if raw == "" || strings.HasPrefix(raw, "/") || strings.ContainsAny(raw, "\x00\r\n") {
		return "", fmt.Errorf("objectKey must be a relative, single-line path")
	}
	cleaned := path.Clean(raw)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("objectKey cannot escape the execution prefix")
	}
	if request.OrganizationID == "" || request.WorkflowID == "" {
		return "", fmt.Errorf("organizationId and workflowId are required for artifact storage")
	}
	return path.Join(request.OrganizationID, request.WorkflowID, cleaned), nil
}
