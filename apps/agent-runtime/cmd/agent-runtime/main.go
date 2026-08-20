package main

import (
	"context"
	"log/slog"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/agents"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/config"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/workflows"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := config.FromEnv()

	temporalOptions := client.Options{
		HostPort:  cfg.TemporalHostPort,
		Namespace: cfg.TemporalNamespace,
	}
	if cfg.TemporalAPIKey != "" {
		temporalOptions.Credentials = client.NewAPIKeyStaticCredentials(cfg.TemporalAPIKey)
	}

	temporalClient, err := client.Dial(temporalOptions)
	if err != nil {
		logger.Error("failed to connect to Temporal", "error", err, "hostPort", cfg.TemporalHostPort, "namespace", cfg.TemporalNamespace)
		os.Exit(1)
	}
	defer temporalClient.Close()

	agentBundle, err := agents.NewBundle(context.Background(), agents.Config{
		APIKey:              cfg.GeminiAPIKey,
		ModelName:           cfg.GeminiModel,
		CoordinatorModel:    cfg.CoordinatorModel,
		CoordinatorThinking: cfg.CoordinatorThink,
	})
	if err != nil {
		logger.Error("failed to initialize ADK bundle", "error", err)
		os.Exit(1)
	}
	logger.Info("agent bundle initialized", "specialistModel", agentBundle.ModelName, "coordinatorModel", agentBundle.CoordinatorModelName, "coordinatorThinkingLevel", agentBundle.CoordinatorThinkingLevel, "geminiEnabled", agentBundle.Enabled)

	activities := workflows.NewActivities(agentBundle, cfg.AgentGatewayURL)
	w := worker.New(temporalClient, cfg.TaskQueue, worker.Options{})
	w.RegisterWorkflow(coordinator.CoordinatorWorkflow)
	w.RegisterWorkflow(coordinator.BootstrapProjectWorkflow)
	w.RegisterDynamicWorkflow(workflows.DynamicBlueprintWorkflow, workflow.DynamicRegisterOptions{})
	w.RegisterActivity(activities.ExecuteBlueprintStep)

	logger.Info("agent runtime worker starting", "taskQueue", cfg.TaskQueue)
	if err := w.Run(worker.InterruptCh()); err != nil {
		logger.Error("agent runtime worker stopped with error", "error", err)
		os.Exit(1)
	}
	logger.Info("agent runtime worker stopped")
}
