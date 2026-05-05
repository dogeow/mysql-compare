export const isElectronRenderer = () => typeof window !== 'undefined' && typeof window.api !== 'undefined'

export const isWebRuntime = () => !isElectronRenderer()
