package agents

import "strings"

// RegisteredDefinitions is the Runtime-side allowlist for Agent Definitions
// that may be executed by a Blueprint snapshot. A future persisted registry
// can replace this catalog, but an arbitrary model/user string must never be
// treated as an executable definition.
var RegisteredDefinitions = map[string]struct{}{
	"context.summarizer.v1":               {},
	"context.summarizer@1":                {},
	"context.synthesizer@1":               {},
	"context.synthesizer.v1":              {},
	"release-investigation.synthesizer@1": {},
}

func IsRegisteredDefinition(value string) bool {
	_, ok := RegisteredDefinitions[strings.TrimSpace(value)]
	return ok
}
