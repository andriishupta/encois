import { describe, expect, it } from 'vitest'
import {
  getEffectiveUnitIds,
  getManagedUnitIds,
  initialOrganizationUnits,
  initialUnitPermissions,
} from '@/lib/organization'

describe('organization scope helpers', () => {
  it('propagates a manager permission to descendants without sibling branches', () => {
    expect(getEffectiveUnitIds(initialOrganizationUnits, initialUnitPermissions, 'jamie-davis')).toEqual([
      'engineering',
      'payments',
      'checkout',
    ])
  })

  it('keeps a member with explicit unit grants limited to those units', () => {
    expect(getEffectiveUnitIds(initialOrganizationUnits, initialUnitPermissions, 'priya-shah')).toEqual([
      'payments',
      'checkout',
    ])
  })

  it('separates management scope from read or contribute visibility', () => {
    expect(getManagedUnitIds(initialOrganizationUnits, initialUnitPermissions, 'jamie-davis')).toEqual([
      'engineering',
      'payments',
      'checkout',
    ])
    expect(getManagedUnitIds(initialOrganizationUnits, initialUnitPermissions, 'priya-shah')).toEqual([])
  })
})
