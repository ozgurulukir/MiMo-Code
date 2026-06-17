import { describe, expect, test } from "bun:test"
import { decode64 } from "./base64"
import { base64Encode } from "@mimo-ai/shared/util/encode"

describe("decode64", () => {
  test("returns undefined for undefined input", () => {
    expect(decode64(undefined)).toBeUndefined()
  })

  test("decodes a valid base64 string", () => {
    const original = "Hello World! 123"
    const encoded = base64Encode(original)
    expect(decode64(encoded)).toBe(original)
  })

  test("returns undefined when base64Decode throws (invalid base64)", () => {
    // An invalid base64 string that will cause atob to throw
    expect(decode64("!@#$%^&*()")).toBeUndefined()
  })
})
