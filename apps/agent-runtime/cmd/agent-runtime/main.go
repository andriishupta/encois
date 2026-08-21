package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"

	"github.com/andriishupta/encois/apps/agent-runtime/internal/agents"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/config"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/coordinator"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/health"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/integrations/corecoordinator"
	"github.com/andriishupta/encois/apps/agent-runtime/internal/memory"
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
		Mode:                cfg.AgentAIMode,
		APIKey:              cfg.GeminiAPIKey,
		UseVertexAI:         cfg.UseVertexAI,
		GoogleCloudProject:  cfg.GoogleCloudProject,
		GoogleCloudLocation: cfg.GoogleCloudLocation,
		ModelName:           cfg.GeminiModel,
		CoordinatorModel:    cfg.CoordinatorModel,
		CoordinatorThinking: cfg.CoordinatorThink,
	})
	if err != nil {
		logger.Error("failed to initialize ADK bundle", "error", err)
		os.Exit(1)
	}
	modelBackend := agentBundle.Mode
	if agentBundle.Mode == agents.ModeGemini && cfg.UseVertexAI {
		modelBackend = "vertex-ai"
	}
	logger.Info("agent bundle initialized", "specialistModel", agentBundle.ModelName, "coordinatorModel", agentBundle.CoordinatorModelName, "coordinatorThinkingLevel", agentBundle.CoordinatorThinkingLevel, "modelBackend", modelBackend, "geminiEnabled", agentBundle.Enabled)

	healthServer := &health.Server{}
	fatalWorkerErrors := make(chan error, 1)
	activities := workflows.NewActivities(agentBundle, cfg.AgentGatewayURL, cfg.AgentGatewayToken, cfg.AgentGatewayAudience)
	controlPlaneClient := corecoordinator.NewHTTPClient(cfg.ControlPlaneURL, cfg.ControlPlaneToken, cfg.ControlPlaneAudience)
	controlPlaneActivities := workflows.NewCoordinatorControlPlaneActivities(controlPlaneClient)
	memoryActivities := workflows.NewMemoryActivities(memory.DeferredStore{})
	w := worker.New(temporalClient, cfg.TaskQueue, worker.Options{
		OnFatalError: func(err error) {
			healthServer.Ready.Store(false)
			select {
			case fatalWorkerErrors <- err:
			default:
			}
		},
	})
	w.RegisterWorkflow(coordinator.CoordinatorWorkflow)
	w.RegisterWorkflow(coordinator.BootstrapProjectWorkflow)
	w.RegisterWorkflow(workflows.SourceIngestionWorkflow)
	w.RegisterDynamicWorkflow(workflows.DynamicBlueprintWorkflow, workflow.DynamicRegisterOptions{})
	w.RegisterActivity(workflows.ValidateBlueprintContract)
	w.RegisterActivity(workflows.ValidateBlueprintResult)
	w.RegisterActivity(workflows.ValidateSourceIngestionContract)
	w.RegisterActivity(workflows.ValidateSourceIngestionResult)
	w.RegisterActivity(workflows.ProcessSourceRevision)
	w.RegisterActivity(activities.CreateBootstrapPlan)
	w.RegisterActivity(activities.CreateCoordinatorPlan)
	w.RegisterActivity(activities.ExecuteBlueprintStep)
	w.RegisterActivity(memoryActivities.ExecuteAgentMemory)
	w.RegisterActivity(controlPlaneActivities.SubmitWorkflowChangePlan)
	w.RegisterActivity(controlPlaneActivities.StartApprovedWorkflow)

	httpServer := &http.Server{Addr: cfg.HTTPAddr, Handler: healthServer.Handler()}
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("agent runtime health server stopped with error", "error", err, "address", cfg.HTTPAddr)
		}
	}()
	defer func() {
		healthServer.Ready.Store(false)
		_ = httpServer.Close()
	}()

	if err := w.Start(); err != nil {
		logger.Error("agent runtime worker failed to start", "error", err, "taskQueue", cfg.TaskQueue)
		os.Exit(1)
	}
	healthServer.Ready.Store(true)
	logger.Info("agent runtime worker started", "taskQueue", cfg.TaskQueue, "healthAddress", cfg.HTTPAddr)

	select {
	case <-worker.InterruptCh():
		logger.Info("agent runtime worker stopping", "taskQueue", cfg.TaskQueue)
		w.Stop()
	case err := <-fatalWorkerErrors:
		logger.Error("agent runtime worker stopped with error", "error", err)
		os.Exit(1)
	}
	logger.Info("agent runtime worker stopped")
}
