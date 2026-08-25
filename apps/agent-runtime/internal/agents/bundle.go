package agents

import (
	"context"
	"fmt"
	"strings"

	localmock "github.com/andriishupta/encois/apps/agent-runtime/internal/mock"
	"google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/agent/llmagent"
	"google.golang.org/adk/v2/model"
	"google.golang.org/adk/v2/model/gemini"
	"google.golang.org/adk/v2/runner"
	"google.golang.org/genai"
)

type Config struct {
	Mode                string
	APIKey              string
	UseVertexAI         bool
	GoogleCloudProject  string
	GoogleCloudLocation string
	ModelName           string
	CoordinatorModel    string
	CoordinatorThinking string
}

type Bundle struct {
	Mode                     string
	Coordinator              agent.Agent
	WorkflowCreator          agent.Agent
	AgentModel               model.LLM
	Runner                   *runner.Runner
	WorkflowCreatorRunner    *runner.Runner
	ModelName                string
	CoordinatorModelName     string
	CoordinatorThinkingLevel genai.ThinkingLevel
	Enabled                  bool
}

const (
	ModeGemini = "gemini"
	ModeMock   = "mock"
)

func NewBundle(ctx context.Context, cfg Config) (*Bundle, error) {
	mode := strings.ToLower(strings.TrimSpace(cfg.Mode))
	if mode == "" {
		mode = ModeGemini
	}
	if mode != ModeGemini && mode != ModeMock {
		return nil, fmt.Errorf("unsupported agent AI mode %q; use mock or gemini", cfg.Mode)
	}
	modelName := cfg.ModelName
	if modelName == "" {
		modelName = "gemini-3.7-flash"
	}
	coordinatorModelName := cfg.CoordinatorModel
	if coordinatorModelName == "" {
		coordinatorModelName = "gemini-3.1-pro-preview"
	}
	thinkingLevel, err := parseThinkingLevel(cfg.CoordinatorThinking)
	if err != nil {
		return nil, err
	}
	bundle := &Bundle{
		Mode:                     mode,
		ModelName:                modelName,
		CoordinatorModelName:     coordinatorModelName,
		CoordinatorThinkingLevel: thinkingLevel,
	}
	if mode == ModeMock {
		bundle.Enabled = true
		return bundle, nil
	}
	if !cfg.UseVertexAI && cfg.APIKey == "" {
		return nil, fmt.Errorf("Gemini credentials are required for AGENT_AI_MODE=gemini; use AGENT_AI_MODE=mock explicitly for local fixtures")
	}

	clientConfig := &genai.ClientConfig{APIKey: cfg.APIKey}
	if cfg.UseVertexAI {
		// Cloud Run uses the service account's Application Default Credentials;
		// no long-lived Gemini API key is required for Vertex AI mode.
		clientConfig = &genai.ClientConfig{
			Backend:  genai.BackendVertexAI,
			Project:  cfg.GoogleCloudProject,
			Location: cfg.GoogleCloudLocation,
		}
	}

	model, err := gemini.NewModel(ctx, modelName, clientConfig)
	if err != nil {
		return nil, fmt.Errorf("create Gemini model: %w", err)
	}
	coordinatorModel, err := gemini.NewModel(ctx, coordinatorModelName, clientConfig)
	if err != nil {
		return nil, fmt.Errorf("create coordinator Gemini model: %w", err)
	}
	deepThinkingConfig := &genai.GenerateContentConfig{
		ThinkingConfig: &genai.ThinkingConfig{ThinkingLevel: thinkingLevel},
	}

	coordinator, err := llmagent.New(llmagent.Config{
		Name:        "coordinator",
		Description: "Coordinates onboarding, context discovery, and company-specific Blueprint proposals.",
		Model:       coordinatorModel,
		Instruction: "Coordinate only approved capabilities for the current organization and project. Discover available context, delegate through validated tools or Agent Definitions, and preserve evidence references. Never invent permissions, tools, providers, or facts.",
		// The coordinator owns cross-source planning and must use the deeper
		// reasoning profile configured for high-responsibility agents.
		GenerateContentConfig: deepThinkingConfig,
	})
	if err != nil {
		return nil, fmt.Errorf("create coordinator: %w", err)
	}

	workflowCreator, err := llmagent.New(llmagent.Config{
		Name:                  "workflow_creator",
		Description:           "Proposes versioned workflow blueprints from the approved catalog.",
		Model:                 coordinatorModel,
		Instruction:           "Propose only typed changes to the generic user-created Blueprint using approved tools, Agent Definitions, and authorized scopes. Never approve a plan, invent Go code, or make authorization decisions.",
		GenerateContentConfig: deepThinkingConfig,
	})
	if err != nil {
		return nil, fmt.Errorf("create workflow creator: %w", err)
	}

	adkRunner, err := runner.NewInMemory("encois-agent-runtime", coordinator)
	if err != nil {
		return nil, fmt.Errorf("create ADK runner: %w", err)
	}
	workflowCreatorRunner, err := runner.NewInMemory("encois-agent-runtime-workflow-creator", workflowCreator)
	if err != nil {
		return nil, fmt.Errorf("create workflow creator runner: %w", err)
	}
	bundle.Coordinator = coordinator
	bundle.WorkflowCreator = workflowCreator
	bundle.AgentModel = model
	bundle.Runner = adkRunner
	bundle.WorkflowCreatorRunner = workflowCreatorRunner
	bundle.Enabled = true
	return bundle, nil
}

// RunAgentStep executes an approved Agent Definition selected by a Blueprint.
// The definition and its tool allowlist are validated before this Activity is
// scheduled; this method does not let model output create capabilities.
func (b *Bundle) RunAgentStep(ctx context.Context, sessionID, definition string, input map[string]any) (string, error) {
	if b != nil && b.Mode == ModeMock {
		return localmock.AgentStepSummary(definition), nil
	}
	if b == nil || b.AgentModel == nil {
		return "", nil
	}
	agentDefinition, err := llmagent.New(llmagent.Config{
		Name:        "blueprint_agent_step",
		Description: "Executes one approved Encois Agent Definition inside a generic Blueprint.",
		Model:       b.AgentModel,
		Instruction: fmt.Sprintf("Execute the approved Agent Definition %q. Use only the supplied structured input and approved tool results. Return a concise structured result with evidence references where available. Do not make authorization decisions.", definition),
	})
	if err != nil {
		return "", fmt.Errorf("create blueprint agent step: %w", err)
	}
	agentRunner, err := runner.NewInMemory("encois-blueprint-agent-"+sessionID, agentDefinition)
	if err != nil {
		return "", fmt.Errorf("create blueprint agent runner: %w", err)
	}

	prompt := fmt.Sprintf("Approved Agent Definition: %s\nStructured input: %v", definition, input)
	content := genai.NewContentFromText(prompt, genai.RoleUser)
	var parts []string
	for event, runErr := range agentRunner.Run(ctx, "system", sessionID, content, agent.RunConfig{StreamingMode: agent.StreamingModeNone}) {
		if runErr != nil {
			return "", runErr
		}
		if event == nil || event.Content == nil {
			continue
		}
		for _, part := range event.Content.Parts {
			if part != nil && part.Text != "" {
				parts = append(parts, part.Text)
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n")), nil
}

func (b *Bundle) Summarize(ctx context.Context, sessionID, prompt string) (string, error) {
	if b != nil && b.Mode == ModeMock {
		return localmock.Summary(), nil
	}
	if b == nil || b.Runner == nil {
		return "", nil
	}

	content := genai.NewContentFromText(prompt, genai.RoleUser)
	var parts []string
	for event, err := range b.Runner.Run(ctx, "system", sessionID, content, agent.RunConfig{StreamingMode: agent.StreamingModeNone}) {
		if err != nil {
			return "", err
		}
		if event == nil || event.Content == nil {
			continue
		}
		for _, part := range event.Content.Parts {
			if part != nil && part.Text != "" {
				parts = append(parts, part.Text)
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n")), nil
}

func (b *Bundle) CreateWorkflowPlan(ctx context.Context, sessionID, prompt string) (string, error) {
	if b != nil && b.Mode == ModeMock {
		return localmock.WorkflowChangePlanJSON(prompt)
	}
	if b == nil || b.WorkflowCreatorRunner == nil {
		return "", nil
	}

	content := genai.NewContentFromText(prompt, genai.RoleUser)
	var parts []string
	for event, err := range b.WorkflowCreatorRunner.Run(ctx, "system", sessionID, content, agent.RunConfig{StreamingMode: agent.StreamingModeNone}) {
		if err != nil {
			return "", err
		}
		if event == nil || event.Content == nil {
			continue
		}
		for _, part := range event.Content.Parts {
			if part != nil && part.Text != "" {
				parts = append(parts, part.Text)
			}
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n")), nil
}

func parseThinkingLevel(value string) (genai.ThinkingLevel, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "high":
		return genai.ThinkingLevelHigh, nil
	case "medium":
		return genai.ThinkingLevelMedium, nil
	case "low":
		return genai.ThinkingLevelLow, nil
	default:
		return "", fmt.Errorf("unsupported coordinator thinking level %q; use low, medium, or high", value)
	}
}
