import { Outlet, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/organization/sources')({
  component: SourcesLayout,
})

function SourcesLayout() {
  return <Outlet />
}
