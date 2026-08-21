package server

import "context"

// NewGCPAdapters creates the hosted data-plane implementations. The caller
// owns the returned cleanup function and should call it during shutdown.
func NewGCPAdapters(ctx context.Context, bucket, database string) (RouterOptions, func() error, error) {
	artifacts, closeArtifacts, err := newGCSArtifactStore(ctx, bucket)
	if err != nil {
		return RouterOptions{}, nil, err
	}
	graph, closeGraph, err := newSpannerGraphStore(ctx, database)
	if err != nil {
		_ = closeArtifacts()
		return RouterOptions{}, nil, err
	}
	return RouterOptions{ArtifactStore: artifacts, GraphStore: graph}, func() error {
		closeGraph()
		return closeArtifacts()
	}, nil
}
