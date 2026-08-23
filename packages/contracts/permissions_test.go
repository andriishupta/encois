package contracts

import "testing"

func TestGeneratedPermissions(t *testing.T) {
	if PermissionWorkflowsManage != "workflows:manage" {
		t.Fatalf("unexpected workflow manage permission: %q", PermissionWorkflowsManage)
	}
	if len(AllPermissions) != 15 {
		t.Fatalf("expected 15 permissions, got %d", len(AllPermissions))
	}
}
