/* global globalThis */
/**
 * Minimal UTF-8 TextDecoder polyfill for Hermes. RN ships a native
 * TextEncoder but no TextDecoder (verified on RN 0.87); nats.ws and the
 * vendored contract layer both instantiate TextDecoder at module scope.
 * Supports the {stream:true} incremental mode via a carry buffer.
 * Note: lone-surrogate input becomes U+FFFD like the platform decoder.
 */
;(function (g) {
  if (typeof g.TextDecoder === 'function') return

  function decodeChunk(bytes, carry, stream) {
    let out = ''
    let i = 0
    while (i < bytes.length) {
      const b0 = bytes[i]
      if (b0 < 0x80) {
        out += String.fromCharCode(b0)
        i += 1
        continue
      }
      let needed
      let code
      if (b0 >= 0xc2 && b0 < 0xe0) { needed = 1; code = b0 & 0x1f }
      else if (b0 >= 0xe0 && b0 < 0xf0) { needed = 2; code = b0 & 0x0f }
      else if (b0 >= 0xf0 && b0 <= 0xf4) { needed = 3; code = b0 & 0x07 }
      else { out += '\ufffd'; i += 1; continue }
      if (i + needed >= bytes.length) {
        if (!stream) out += '\ufffd'
        break
      }
      let valid = true
      for (let j = 1; j <= needed; j += 1) {
        const b = bytes[i + j]
        if ((b & 0xc0) !== 0x80) { valid = false; break }
        code = (code << 6) | (b & 0x3f)
      }
      if (!valid) { out += '\ufffd'; i += 1; continue }
      out += code <= 0xffff ? String.fromCharCode(code) : String.fromCodePoint(code)
      i += needed + 1
    }
    return { text: out, nextCarry: stream ? Array.from(bytes.slice(i)) : [] }
  }

  class TextDecoderPolyfill {
    constructor() {
      this._carry = []
    }

    decode(input, options) {
      const bytes = input == null
        ? new Uint8Array(0)
        : input instanceof Uint8Array
          ? input
          : new Uint8Array(input.buffer !== undefined ? input.buffer : input)
      const stream = options != null && options.stream === true
      const joined = this._carry.length > 0 ? new Uint8Array(this._carry.concat(Array.from(bytes))) : bytes
      const { text, nextCarry } = decodeChunk(joined, this._carry, stream)
      this._carry = nextCarry
      return text
    }
  }

  g.TextDecoder = TextDecoderPolyfill
})(globalThis)
