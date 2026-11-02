/**
 * codec-node.mjs — installs the Node zlib codec.
 *
 * Importing this module has a side effect: from then on ZIP entries and PDF
 * streams are compressed with zlib. The CLI imports it once at startup.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { setCodec } from './codec.mjs';

setCodec({
  id: 'node',
  canDeflate: true,
  canInflate: true,
  deflate(raw) {
    return { data: deflateRawSync(raw, { level: 9 }), method: 8 };
  },
  inflate(raw) {
    return inflateRawSync(raw);
  },
  deflateRaw(raw) {
    return deflateRawSync(raw, { level: 9 });
  },
  inflateRaw(raw) {
    return inflateRawSync(raw);
  },
});
