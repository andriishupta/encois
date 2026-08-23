export type BrandConfig = {
  productName: string
  workspaceName: string
  logoUrl?: string
  faviconUrl?: string
  supportUrl?: string
  poweredByVisible: boolean
}

export type BrandOverrides = Partial<BrandConfig>

const environment = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}

const defaultBrandConfig: BrandConfig = {
  productName: environment.VITE_PRODUCT_NAME?.trim() || 'Encois',
  workspaceName: environment.VITE_WORKSPACE_NAME?.trim() || 'Organization',
  ...(environment.VITE_PRODUCT_LOGO_URL?.trim() ? { logoUrl: environment.VITE_PRODUCT_LOGO_URL.trim() } : {}),
  ...(environment.VITE_PRODUCT_FAVICON_URL?.trim() ? { faviconUrl: environment.VITE_PRODUCT_FAVICON_URL.trim() } : {}),
  ...(environment.VITE_SUPPORT_URL?.trim() ? { supportUrl: environment.VITE_SUPPORT_URL.trim() } : {}),
  poweredByVisible: environment.VITE_POWERED_BY_VISIBLE?.trim().toLowerCase() === 'true',
}

export function getBranding(workspaceName?: string, overrides: BrandOverrides = {}): BrandConfig {
  const resolved = { ...defaultBrandConfig, ...overrides }
  return {
    ...resolved,
    workspaceName: workspaceName?.trim() || resolved.workspaceName,
  }
}

export function getPublicWorkspaceTitle(): string {
  return `${defaultBrandConfig.productName} workspace`
}
