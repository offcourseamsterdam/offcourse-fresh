// pdfjs-dist's legacy Node build constructs a module-level `new DOMMatrix()`
// (`SCALE_MATRIX`) as soon as it's imported — before any of our code runs.
// It tries to self-polyfill DOMMatrix via the optional native `@napi-rs/canvas`
// package, but that package's platform-specific binary isn't reliably picked
// up by Vercel's serverless bundling (it's required through an indirection
// pdfjs uses specifically to dodge webpack, which also defeats Vercel's
// dependency tracer). The result: importing pdfjs-dist works locally (where
// @napi-rs/canvas happens to be installed and requirable) but throws
// "ReferenceError: DOMMatrix is not defined" as soon as it's imported on
// Vercel.
//
// We only ever call `getTextContent()` — never `page.render()` — so we never
// exercise the canvas/SVG rendering code that actually does matrix math with
// this. Defining a real (if minimal) 2D affine DOMMatrix here, before pdfjs
// is imported, satisfies pdfjs's own `if (!globalThis.DOMMatrix)` check so it
// never attempts the native-canvas require at all.
//
// Import this file (for its side effect) before dynamically importing
// 'pdfjs-dist/legacy/build/pdf.mjs'.

class DOMMatrixPolyfill {
  a = 1
  b = 0
  c = 0
  d = 1
  e = 0
  f = 0

  constructor(init?: number[]) {
    if (init?.length === 6) {
      const [a, b, c, d, e, f] = init
      this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f
    }
  }

  get is2D() { return true }

  translate(tx = 0, ty = 0): DOMMatrixPolyfill {
    return this.multiply(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty]))
  }

  scale(sx = 1, sy = sx): DOMMatrixPolyfill {
    return this.multiply(new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0]))
  }

  multiply(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
    return new DOMMatrixPolyfill([
      this.a * other.a + this.c * other.b,
      this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d,
      this.b * other.c + this.d * other.d,
      this.a * other.e + this.c * other.f + this.e,
      this.b * other.e + this.d * other.f + this.f,
    ])
  }

  multiplySelf(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
    return Object.assign(this, this.multiply(other))
  }

  preMultiplySelf(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
    return Object.assign(this, other.multiply(this))
  }

  invertSelf(): DOMMatrixPolyfill {
    const det = this.a * this.d - this.b * this.c
    if (det === 0) {
      this.a = this.b = this.c = this.d = this.e = this.f = NaN
      return this
    }
    const { a, b, c, d, e, f } = this
    this.a = d / det
    this.b = -b / det
    this.c = -c / det
    this.d = a / det
    this.e = -(e * this.a + f * this.c)
    this.f = -(e * this.b + f * this.d)
    return this
  }
}

if (typeof globalThis.DOMMatrix === 'undefined') {
  // @ts-expect-error — minimal Node-only polyfill, not the full DOM type
  globalThis.DOMMatrix = DOMMatrixPolyfill
}

export {}

