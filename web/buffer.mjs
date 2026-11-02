/**
 * buffer.mjs — a minimal Buffer for browsers.
 *
 * The writers were written against Node's Buffer, which is a Uint8Array with a
 * handful of extra methods. This polyfill implements exactly the surface the
 * project uses, so the same source runs in the browser without a bundler.
 */

function copyOf(bytes) {
  const out = new Buffer(bytes.length);
  out.set(bytes);
  return out;
}

function viewOf(buf) {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

class Buffer extends Uint8Array {
  static from(input, encoding) {
    if (typeof input === 'string') {
      const enc = (encoding || 'utf8').toLowerCase();
      if (enc === 'latin1' || enc === 'binary') {
        const out = new Buffer(input.length);
        for (let i = 0; i < input.length; i++) out[i] = input.charCodeAt(i) & 0xff;
        return out;
      }
      if (enc === 'hex') {
        const out = new Buffer(Math.floor(input.length / 2));
        for (let i = 0; i < out.length; i++) out[i] = parseInt(input.substr(i * 2, 2), 16);
        return out;
      }
      return copyOf(new TextEncoder().encode(input));
    }
    if (input instanceof Uint8Array) return copyOf(input);
    if (Array.isArray(input)) return copyOf(Uint8Array.from(input));
    throw new Error('Buffer.from: unsupported input');
  }

  static alloc(size) {
    return new Buffer(size);
  }

  static concat(list, totalLength) {
    const total = totalLength === undefined
      ? list.reduce((sum, item) => sum + item.length, 0)
      : totalLength;
    const out = new Buffer(total);
    let offset = 0;
    for (const item of list) {
      out.set(item, offset);
      offset += item.length;
    }
    return out;
  }

  static isBuffer(value) {
    return value instanceof Buffer;
  }

  toString(encoding) {
    const enc = (encoding || 'utf8').toLowerCase();
    if (enc === 'latin1' || enc === 'binary') {
      let out = '';
      for (let i = 0; i < this.length; i += 8192) {
        out += String.fromCharCode.apply(null, this.subarray(i, i + 8192));
      }
      return out;
    }
    if (enc === 'hex') {
      let out = '';
      for (let i = 0; i < this.length; i++) out += this[i].toString(16).padStart(2, '0');
      return out;
    }
    return new TextDecoder().decode(this);
  }

  writeUInt32LE(value, offset) { viewOf(this).setUint32(offset, value >>> 0, true); return offset + 4; }
  writeUInt16LE(value, offset) { viewOf(this).setUint16(offset, value & 0xffff, true); return offset + 2; }
  readUInt32LE(offset) { return viewOf(this).getUint32(offset, true); }
  readUInt16LE(offset) { return viewOf(this).getUint16(offset, true); }
}

/** Install Buffer on the global object. Call once before importing the core. */
export function installBuffer() {
  if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;
  return globalThis.Buffer;
}

export { Buffer };
