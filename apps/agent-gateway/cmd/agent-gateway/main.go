package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/andriishupta/encois/apps/agent-gateway/internal/config"
	"github.com/andriishupta/encois/apps/agent-gateway/internal/policy"
	gatewayserver "github.com/andriishupta/encois/apps/agent-gateway/internal/server"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := config.FromEnv()
	if cfg.CapabilitySecret == "" {
		logger.Error("execution capability secret is not configured")
		os.Exit(1)
	}

	if cfg.GinMode != "" {
		gatewayserver.SetGinMode(cfg.GinMode)
	}

	var routerOptions gatewayserver.RouterOptions
	var closeAdapters func() error
	var err error
	switch cfg.DataMode {
	case "gcp":
		routerOptions, closeAdapters, err = gatewayserver.NewGCPAdapters(context.Background(), cfg.StorageBucket, cfg.SpannerDatabase, gatewayserver.GCPProviderToolOptions{
			ControlPlaneURL:      cfg.ControlPlaneURL,
			ControlPlaneToken:    cfg.ControlPlaneToken,
			ControlPlaneAudience: cfg.ControlPlaneAudience,
			ProjectID:            cfg.GoogleCloudProject,
			OAuthConfigJSON:      cfg.OAuthConfigJSON,
		})
		if err != nil {
			logger.Error("failed to initialize GCP data adapters", "error", err)
			os.Exit(1)
		}
		defer func() { _ = closeAdapters() }()
	case "mock":
		// Explicit local/test fixture mode.
		if cfg.StorageMode == "gcs" {
			routerOptions.ArtifactStore, closeAdapters, err = gatewayserver.NewCloudStorageArtifactStore(context.Background(), cfg.StorageBucket)
			if err != nil {
				logger.Error("failed to initialize Cloud Storage artifact adapter", "error", err)
				os.Exit(1)
			}
			defer func() { _ = closeAdapters() }()
		} else if cfg.StorageMode != "memory" {
			logger.Error("unsupported agent gateway storage mode", "storage_mode", cfg.StorageMode, "allowed", []string{"memory", "gcs"})
			os.Exit(1)
		}
	default:
		logger.Error("unsupported agent gateway data mode", "data_mode", cfg.DataMode, "allowed", []string{"gcp", "mock"})
		os.Exit(1)
	}
	routerOptions.CapabilitySecret = cfg.CapabilitySecret
	routerOptions.RequireCapability = true
	router := gatewayserver.NewRouterWithOptions(policy.NewReadOnlyToolPolicy(cfg.PolicyVersion), logger, cfg.ServiceToken, routerOptions)
	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		logger.Info("agent gateway listening", "address", cfg.HTTPAddr, "policy_mode", "read_only_fixture", "data_mode", cfg.DataMode, "service_auth_configured", cfg.ServiceToken != "")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("agent gateway stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}()

	stop, stopSignal := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stopSignal()
	<-stop.Done()

	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		logger.Error("agent gateway shutdown failed", "error", err)
		os.Exit(1)
	}
	logger.Info("agent gateway stopped")
}
