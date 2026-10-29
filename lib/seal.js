'use strict';
// The sealed container, shared with the Janus 
//
//   "JANUSENC" | version(1) | kdf(1 = scrypt) | log2N | r | p | salt(16) | iv(12) | ciphertext | tag(16)
//
const crypto = require('crypto');

const MAGIC = Buffer.from('JANUSENC', 'ascii');
const VERSION = 1, KDF_SCRYPT = 1, SALT = 16, IV = 12, TAG = 16;
const HEADER = MAGIC.length + 5 + SALT + IV;
const MIN_PASSPHRASE = 8;
const DEFAULT_KDF = { logN: 15, r: 8, p: 1 };

class WrongPassphraseError extends Error { constructor() { super('Wrong passphrase, or the file has been altered.'); this.name = 'WrongPassphraseError'; } }

const isSealed = (b) => b.length >= HEADER + TAG && Buffer.from(b.subarray(0, MAGIC.length)).equals(MAGIC);
const norm = (p) => Buffer.from(String(p).normalize('NFKC'), 'utf8');
const opts = (k) => ({ N: 2 ** k.logN, r: k.r, p: k.p, maxmem: 128 * (2 ** k.logN) * k.r * 2 + 4 * 1024 * 1024 });
const deriveKey = (pass, salt, k = DEFAULT_KDF) => crypto.scryptSync(norm(pass), salt, 32, opts(k));

function readHeader(b) {
  if (!isSealed(b)) throw new Error('That is not a Janus sealed file.');
  let o = MAGIC.length;
  const version = b[o++], kdf = b[o++];
  if (version !== VERSION || kdf !== KDF_SCRYPT) throw new Error('This sealed file uses a format this version cannot read.');
  const logN = b[o++], r = b[o++], p = b[o++];
  if (logN < 10 || logN > 22 || r < 1 || r > 32 || p < 1 || p > 8) throw new Error('The sealed file has invalid key-derivation settings.');
  return { logN, r, p, salt: b.subarray(o, o + SALT), iv: b.subarray(o + SALT, o + SALT + IV) };
}

function seal(plain, passphrase, k = DEFAULT_KDF) {
  if (String(passphrase).length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  const salt = crypto.randomBytes(SALT), iv = crypto.randomBytes(IV);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION, KDF_SCRYPT, k.logN, k.r, k.p]), salt, iv]);
  const c = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt, k), iv);
  c.setAAD(header);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([header, body, c.getAuthTag()]);
}

function open(data, passphrase) {
  const h = readHeader(data);
  const key = deriveKey(passphrase, h.salt, h);
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, h.iv);
    d.setAAD(data.subarray(0, HEADER));
    d.setAuthTag(data.subarray(data.length - TAG));
    return Buffer.concat([d.update(data.subarray(HEADER, data.length - TAG)), d.final()]);
  } catch { throw new WrongPassphraseError(); }
}

module.exports = { seal, open, isSealed, MIN_PASSPHRASE, DEFAULT_KDF, WrongPassphraseError };
