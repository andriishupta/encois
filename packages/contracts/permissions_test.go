package contracts

import "testing"

func TestGeneratedPermissions(t *testing.T) {
	if PermissionWorkflowsManage != "workflows:manage" {
		t.Fatalf("unexpected workflow manage permission: %q", PermissionWorkflowsManage)
	}
	if len(AllPermissions) != 12 {
		t.Fatalf("expected 12 permissions, got %d", len(AllPermissions))
	}
}
