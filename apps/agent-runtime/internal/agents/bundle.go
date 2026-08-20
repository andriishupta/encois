package agents

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/adk/v2/agent"
	"google.golang.org/adk/v2/agent/llmagent"
	"google.golang.org/adk/v2/model/gemini"
	"google.golang.org/adk/v2/runner"
	"google.golang.org/genai"
)

type Config struct {
	APIKey              string
	ModelName           string
	CoordinatorModel    string
	CoordinatorThinking string
}

type Bundle struct {
	Coordinator              agent.Agent
	WorkflowCreator          agent.Agent
	Runner                   *runner.Runner
	WorkflowCreatorRunner    *runner.Runner
	ModelName                string
	CoordinatorModelName     string
	CoordinatorThinkingLevel genai.ThinkingLevel
	Enabled                  bool
}

func NewBundle(ctx context.Context, cfg Config) (*Bundle, error) {
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
		ModelName:                modelName,
		CoordinatorModelName:     coordinatorModelName,
		CoordinatorThinkingLevel: thinkingLevel,
	}
	if cfg.APIKey == "" {
		return bundle, nil
	}

	model, err := gemini.NewModel(ctx, modelName, &genai.ClientConfig{APIKey: cfg.APIKey})
	if err != nil {
		return nil, fmt.Errorf("create Gemini model: %w", err)
	}
	coordinatorModel, err := gemini.NewModel(ctx, coordinatorModelName, &genai.ClientConfig{APIKey: cfg.APIKey})
	if err != nil {
		return nil, fmt.Errorf("create coordinator Gemini model: %w", err)
	}
	deepThinkingConfig := &genai.GenerateContentConfig{
		ThinkingConfig: &genai.ThinkingConfig{ThinkingLevel: thinkingLevel},
	}

	jiraSpecialist, err := llmagent.New(llmagent.Config{
		Name:        "jira_specialist",
		Description: "Reads Jira release task evidence through the Agent Gateway.",
		Model:       model,
		Instruction: "Analyze only Jira release task evidence supplied through approved tools. Do not invent facts or permissions.",
	})
	if err != nil {
		return nil, fmt.Errorf("create Jira specialist: %w", err)
	}
	githubSpecialist, err := llmagent.New(llmagent.Config{
		Name:        "github_specialist",
		Description: "Reads GitHub release activity evidence through the Agent Gateway.",
		Model:       model,
		Instruction: "Analyze only GitHub release evidence supplied through approved tools. Do not invent facts or permissions.",
	})
	if err != nil {
		return nil, fmt.Errorf("create GitHub specialist: %w", err)
	}
	coordinator, err := llmagent.New(llmagent.Config{
		Name:        "release_risk_coordinator",
		Description: "Coordinates Jira and GitHub specialists for a release-risk investigation.",
		Model:       coordinatorModel,
		Instruction: "Synthesize evidence from Jira and GitHub specialists into a concise, evidence-linked release-risk assessment.",
		SubAgents:   []agent.Agent{jiraSpecialist, githubSpecialist},
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
		Instruction:           "Propose only typed workflow changes using registered workflow types, allowed tools, and authorized scopes. Never approve a plan, invent Go code, or make authorization decisions.",
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
	bundle.Runner = adkRunner
	bundle.WorkflowCreatorRunner = workflowCreatorRunner
	bundle.Enabled = true
	return bundle, nil
}

func (b *Bundle) Summarize(ctx context.Context, sessionID, prompt string) (string, error) {
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
