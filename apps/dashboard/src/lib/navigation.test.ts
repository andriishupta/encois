import { describe, expect, it } from 'vitest'
import { isNavigationItemActive } from './navigation'

describe('isNavigationItemActive', () => {
  it('does not keep the Workflows list active on Blueprint pages', () => {
    expect(isNavigationItemActive('/workflows/blueprints', '/workflows')).toBe(false)
    expect(isNavigationItemActive('/workflows/blueprints', '/workflows/blueprints')).toBe(true)
    expect(isNavigationItemActive('/workflows/blueprints/v1', '/workflows/blueprints')).toBe(true)
  })

  it('maps workflow execution detail pages to Runs', () => {
    expect(isNavigationItemActive('/workflows/run-123', '/workflows/runs')).toBe(true)
    expect(isNavigationItemActive('/workflows/new', '/workflows/runs')).toBe(false)
    expect(isNavigationItemActive('/workflows/new', '/workflows')).toBe(true)
    expect(isNavigationItemActive('/workflows/blueprints', '/workflows/runs')).toBe(false)
    expect(isNavigationItemActive('/workflows/memory', '/workflows/runs')).toBe(false)
    expect(isNavigationItemActive('/workflows/memory', '/workflows/memory')).toBe(true)
  })

  it('keeps nested organization source and integration pages active under their list item', () => {
    expect(isNavigationItemActive('/organization/sources/source-123', '/organization/sources')).toBe(true)
    expect(isNavigationItemActive('/organization/integrations/github', '/organization/integrations')).toBe(true)
  })
})
