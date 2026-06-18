const fallback = () => Math.random().toString(16).slice(2)

export function uuid() {
  let c: Crypto | undefined
  try {
    c = globalThis.crypto as Crypto
  } catch {
    return fallback()
  }
  if (!c || typeof c.randomUUID !== "function") return fallback()
  if (typeof globalThis.isSecureContext === "boolean" && !globalThis.isSecureContext) return fallback()
  try {
    return c.randomUUID()
  } catch {
    return fallback()
  }
}
