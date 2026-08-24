package workflows

import "strings"

func workflowIDBelongsToOrganization(workflowID, organizationID string) bool {
	return organizationID != "" && (strings.HasPrefix(workflowID, "org:"+organizationID+":") ||
		strings.HasPrefix(workflowID, "workflow:"+organizationID+":"))
}
