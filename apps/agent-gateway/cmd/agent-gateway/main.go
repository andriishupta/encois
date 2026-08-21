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

	if cfg.GinMode != "" {
		gatewayserver.SetGinMode(cfg.GinMode)
	}

	router := gatewayserver.NewRouter(policy.NewReadOnlyToolPolicy(cfg.PolicyVersion), logger, cfg.ServiceToken)
	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		logger.Info("agent gateway listening", "address", cfg.HTTPAddr, "policy_mode", "read_only_fixture", "service_auth_configured", cfg.ServiceToken != "")
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
