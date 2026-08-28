package agents

import contractschemas "github.com/andriishupta/encois/packages/contracts"

// RegisteredDefinitions is the Runtime-side allowlist for Agent Definitions
// that may be executed by a Blueprint snapshot. A future persisted registry
// can replace this catalog, but an arbitrary model/user string must never be
// treated as an executable definition.
var RegisteredDefinitions = contractschemas.RegisteredAgentDefinitions

func IsRegisteredDefinition(value string) bool {
	return contractschemas.IsRegisteredAgentDefinition(value)
}
