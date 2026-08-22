package server

import "context"

type GCPProviderToolOptions struct {
	ControlPlaneURL      string
	ControlPlaneToken    string
	ControlPlaneAudience string
	ProjectID            string
	OAuthConfigJSON      string
}

// NewGCPAdapters creates the hosted data-plane implementations. The caller
// owns the returned cleanup function and should call it during shutdown.
func NewGCPAdapters(ctx context.Context, bucket, database string, providerOptions ...GCPProviderToolOptions) (RouterOptions, func() error, error) {
	artifacts, closeArtifacts, err := newGCSArtifactStore(ctx, bucket)
	if err != nil {
		return RouterOptions{}, nil, err
	}
	graph, closeGraph, err := newSpannerGraphStore(ctx, database)
	if err != nil {
		_ = closeArtifacts()
		return RouterOptions{}, nil, err
	}
	options := RouterOptions{ArtifactStore: artifacts, GraphStore: graph}
	if len(providerOptions) > 0 {
		providerOption := providerOptions[0]
		resolver, err := newControlPlaneCredentialResolver(providerOption.ControlPlaneURL, providerOption.ControlPlaneToken, providerOption.ControlPlaneAudience)
		if err != nil {
			closeGraph()
			_ = closeArtifacts()
			return RouterOptions{}, nil, err
		}
		secrets, err := newSecretManagerCredentialStore(ctx, providerOption.ProjectID)
		if err != nil {
			closeGraph()
			_ = closeArtifacts()
			return RouterOptions{}, nil, err
		}
		providerTools, err := newGCPProviderToolRegistry(resolver, secrets, providerOption.OAuthConfigJSON, resolver)
		if err != nil {
			closeGraph()
			_ = closeArtifacts()
			return RouterOptions{}, nil, err
		}
		options.ProviderTools = providerTools
	}
	return options, func() error {
		closeGraph()
		return closeArtifacts()
	}, nil
}
