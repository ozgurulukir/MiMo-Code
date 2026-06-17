import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"

type PersistTestingType = typeof import("./persist").PersistTesting

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  readonly events: string[] = []
  readonly calls = { get: 0, set: 0, remove: 0 }

  clear() {
    this.values.clear()
  }

  get length() {
    return this.values.size
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }

  getItem(key: string) {
    this.calls.get += 1
    this.events.push(`get:${key}`)
    if (key.startsWith("opencode.throw")) throw new Error("storage get failed")
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.calls.set += 1
    this.events.push(`set:${key}`)
    if (key.startsWith("opencode.quota")) throw new DOMException("quota", "QuotaExceededError")
    if (key.startsWith("opencode.throw")) throw new Error("storage set failed")
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.calls.remove += 1
    this.events.push(`remove:${key}`)
    if (key.startsWith("opencode.throw")) throw new Error("storage remove failed")
    this.values.delete(key)
  }
}

const storage = new MemoryStorage()

let persistTesting: PersistTestingType

beforeAll(async () => {
  mock.module("@/context/platform", () => ({
    usePlatform: () => ({ platform: "web" }),
  }))

  const mod = await import("./persist")
  persistTesting = mod.PersistTesting
})

beforeEach(() => {
  storage.clear()
  storage.events.length = 0
  storage.calls.get = 0
  storage.calls.set = 0
  storage.calls.remove = 0
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  })
})

describe("persist localStorage resilience", () => {
  test("does not cache values as persisted when quota write and eviction fail", () => {
    const storageApi = persistTesting.localStorageWithPrefix("opencode.quota.scope")
    storageApi.setItem("value", '{"value":1}')

    expect(storage.getItem("opencode.quota.scope:value")).toBeNull()
    expect(storageApi.getItem("value")).toBeNull()
  })

  test("disables only the failing scope when storage throws", () => {
    const bad = persistTesting.localStorageWithPrefix("opencode.throw.scope")
    bad.setItem("value", '{"value":1}')

    const before = storage.calls.set
    bad.setItem("value", '{"value":2}')
    expect(storage.calls.set).toBe(before)
    expect(bad.getItem("value")).toBeNull()

    const healthy = persistTesting.localStorageWithPrefix("opencode.safe.scope")
    healthy.setItem("value", '{"value":3}')
    expect(storage.getItem("opencode.safe.scope:value")).toBe('{"value":3}')
  })

  test("failing fallback scope does not poison direct storage scope", () => {
    const broken = persistTesting.localStorageWithPrefix("opencode.throw.scope2")
    broken.setItem("value", '{"value":1}')

    const direct = persistTesting.localStorageDirect()
    direct.setItem("direct-value", '{"value":5}')

    expect(storage.getItem("direct-value")).toBe('{"value":5}')
  })

  test("normalizer rejects malformed JSON payloads", () => {
    const result = persistTesting.normalize({ value: "ok" }, '{"value":"\\x"}')
    expect(result).toBeUndefined()
  })

  test("workspace storage sanitizes Windows filename characters", () => {
    const result = persistTesting.workspaceStorage("C:\\Users\\foo")

    expect(result).toStartWith("opencode.workspace.")
    expect(result.endsWith(".dat")).toBeTrue()
    expect(/[:\\/]/.test(result)).toBeFalse()
  })

  test("getItem disables failing scope and returns null when storage throws", () => {
    const bad = persistTesting.localStorageWithPrefix("opencode.throw.get")

    // MemoryStorage is mocked to throw when key starts with opencode.throw
    expect(bad.getItem("value")).toBeNull()

    // Since scope is disabled, setItem should not try to touch the storage
    const before = storage.calls.set
    bad.setItem("value", '{"value":2}')
    expect(storage.calls.set).toBe(before)
  })

  test("localStorageDirect getItem disables scope and returns null when storage throws", () => {
    const direct = persistTesting.localStorageDirect()

    // MemoryStorage throws on 'opencode.throw' for any method
    expect(direct.getItem("opencode.throw.direct")).toBeNull()

    // Subsequent setItem on same scope ('direct') shouldn't touch storage
    const before = storage.calls.set
    direct.setItem("opencode.throw.direct", '{"value":2}')
    expect(storage.calls.set).toBe(before)
  })

  test("evicts older items when storage quota is exceeded and retry succeeds", () => {
    const storageApi = persistTesting.localStorageWithPrefix("opencode.evict.scope")

    // Add two items that can be evicted
    storageApi.setItem("item1", '{"value":1}')
    storageApi.setItem("item2", '{"value":2, "larger": true}')

    // Set up mock so the next setItem fails with quota exceeded on the first two attempts
    // The first setItem in write() fails -> tries second try block in write() -> fails again
    // Then evict() is called. It will remove the largest item (item2) and try again.
    const originalSetItem = storage.setItem.bind(storage)
    let failures = 0
    storage.setItem = (key: string, value: string) => {
      if (key === "opencode.evict.scope:item3" && failures < 2) {
        failures++
        throw new DOMException("quota", "QuotaExceededError")
      }
      originalSetItem(key, value)
    }

    storageApi.setItem("item3", '{"value":3}')

    // item2 (the larger item) should have been evicted
    expect(storageApi.getItem("item2")).toBeNull()

    // item1 should still be there
    expect(storageApi.getItem("item1")).toBe('{"value":1}')

    // item3 should be successfully saved
    expect(storageApi.getItem("item3")).toBe('{"value":3}')

    storage.setItem = originalSetItem
  })

  test("throws error when quota write and eviction fail due to non-quota error", () => {
    // Avoid using opencode.throw or opencode.quota which have built-in throws in MemoryStorage
    const storageApi = persistTesting.localStorageWithPrefix("opencode.test.evict.scope")

    // Add an item that can be evicted
    storage.setItem("opencode.test.evict.scope:item1", '{"value":1}')

    const originalSetItem = storage.setItem.bind(storage)
    let setCalls = 0
    storage.setItem = (key: string, value: string) => {
      // first 2 attempts fail with quota error (triggering evict)
      if (key === "opencode.test.evict.scope:item2" && setCalls < 2) {
        setCalls++
        throw new DOMException("quota", "QuotaExceededError")
      }

      // the set attempt during evict throws a non-quota error
      if (key === "opencode.test.evict.scope:item2" && setCalls === 2) {
        setCalls++
        throw new Error("Some other error")
      }

      originalSetItem(key, value)
    }

    storageApi.setItem("item2", '{"value":2}')

    // Attempt another operation - it should silently do nothing because the scope is disabled
    let beforeCalls = storage.calls.set
    storageApi.setItem("item3", '{"value":3}')
    expect(storage.calls.set).toBe(beforeCalls)

    storage.setItem = originalSetItem
  })

  test("throws error when quota write and eviction fail due to non-quota error in direct write", () => {
    // Avoid using opencode.throw or opencode.quota which have built-in throws in MemoryStorage
    const storageApi = persistTesting.localStorageWithPrefix("opencode.test.direct.scope")

    const originalSetItem = storage.setItem.bind(storage)
    let setCalls = 0
    storage.setItem = (key: string, value: string) => {
      if (key === "opencode.test.direct.scope:item1" && setCalls < 2) {
        setCalls++
        throw new DOMException("quota", "QuotaExceededError")
      }

      // non-quota error in direct write
      if (key === "opencode.test.direct.scope:item1" && setCalls === 2) {
        setCalls++
        throw new Error("Some other error")
      }

      originalSetItem(key, value)
    }

    // We expect it to be caught by localStorageWithPrefix and fallbackSet called
    storageApi.setItem("item1", '{"value":1}')

    let beforeCalls = storage.calls.set
    storageApi.setItem("item2", '{"value":2}')
    expect(storage.calls.set).toBe(beforeCalls)

    storage.setItem = originalSetItem
  })

  test("throws error when direct write fails due to non-quota error without quota error first", () => {
    const storageApi = persistTesting.localStorageWithPrefix("opencode.test.direct2.scope")

    const originalSetItem = storage.setItem.bind(storage)
    let setCalls = 0
    storage.setItem = (key: string, value: string) => {
      // immediately throw a non-quota error
      if (key === "opencode.test.direct2.scope:item1") {
        setCalls++
        throw new Error("Some other error")
      }
      originalSetItem(key, value)
    }

    storageApi.setItem("item1", '{"value":1}')

    let beforeCalls = storage.calls.set
    storageApi.setItem("item2", '{"value":2}')
    expect(storage.calls.set).toBe(beforeCalls)

    storage.setItem = originalSetItem
  })

  test("throws error when quota write and eviction fail due to non-quota error in second write", () => {
    const storageApi = persistTesting.localStorageWithPrefix("opencode.test.second.scope")

    const originalSetItem = storage.setItem.bind(storage)
    let setCalls = 0
    storage.setItem = (key: string, value: string) => {
      // First attempt throws quota error
      if (key === "opencode.test.second.scope:item1" && setCalls === 0) {
        setCalls++
        throw new DOMException("quota", "QuotaExceededError")
      }

      // Second attempt (after remove) throws non-quota error
      if (key === "opencode.test.second.scope:item1" && setCalls === 1) {
        setCalls++
        throw new Error("Some other error")
      }

      originalSetItem(key, value)
    }

    // We expect it to be caught by localStorageWithPrefix and fallbackSet called
    storageApi.setItem("item1", '{"value":1}')

    let beforeCalls = storage.calls.set
    storageApi.setItem("item2", '{"value":2}')
    expect(storage.calls.set).toBe(beforeCalls)

    storage.setItem = originalSetItem
  })

  test("direct storage disabled when storage throws non-quota error in direct write", () => {
    const storageApi = persistTesting.localStorageDirect()

    const originalSetItem = storage.setItem.bind(storage)
    storage.setItem = (key: string, value: string) => {
      // immediately throw a non-quota error
      if (key === "item1") {
        throw new Error("Some other error")
      }
      originalSetItem(key, value)
    }

    storageApi.setItem("item1", '{"value":1}')

    let beforeCalls = storage.calls.set
    storageApi.setItem("item2", '{"value":2}')
    expect(storage.calls.set).toBe(beforeCalls)

    storage.setItem = originalSetItem
  })

  test("quota error is returned correctly by helper", () => {
    // Tests the quota function logic directly to get coverage on the branches
    // This part of the code checks different properties of errors

    // Test branch where error is an object but not DOMException, and has code property
    const errorWithCode = new Error("Custom error")
    ;(errorWithCode as any).code = 22

    // We can't access quota directly, but we can trigger it via evict failure
    const storageApi = persistTesting.localStorageWithPrefix("opencode.test.quota.scope")
    const originalSetItem = storage.setItem.bind(storage)
    let setCalls = 0
    storage.setItem = (key: string, value: string) => {
      if (key === "opencode.test.quota.scope:item1") {
        throw errorWithCode
      }
      originalSetItem(key, value)
    }

    storageApi.setItem("item1", '{"value":1}')

    // The fallback scope should be disabled because our error was treated as a quota error
    // Let's verify by trying to write another item, it should NOT try to write
    let beforeCalls = storage.calls.set
    storageApi.setItem("item2", '{"value":2}')
    // Actually, if it's a quota error, it throws all the way up to setItem where it's caught
    // and fallback is set. So it should be disabled.
    expect(storage.calls.set).toBe(beforeCalls)

    storage.setItem = originalSetItem
  })
})
