package workflows

import "strings"

func workflowIDBelongsToOrganization(workflowID, organizationID string) bool {
	return strings.HasPrefix(workflowID, "workflow:"+organizationID+":")
}
