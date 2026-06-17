const fallback = () => Math.random().toString(16).slice(2)

export function uuid() {
  try {
    const c = globalThis.crypto
    if (!c || typeof c.randomUUID !== "function") return fallback()
    if (typeof globalThis.isSecureContext === "boolean" && !globalThis.isSecureContext) return fallback()
    return c.randomUUID()
  } catch {
    return fallback()
  }
}
