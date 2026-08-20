# Runtime integrations

Integration boundaries in the Runtime are Activities or typed clients. They do
not own the Gateway API control-plane database.

`corecoordinator` is the integration boundary for submitting validated
Coordinator workflow plans to the control plane. Provider packs such as Jira
and GitHub remain separate integrations behind the private Agent Gateway.
