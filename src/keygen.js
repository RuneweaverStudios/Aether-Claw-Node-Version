/**
 * Aether-Claw Key Manager (Node)
 * RSA key pair for signing/verifying skills. Keys in ~/.claude/secure/
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_KEY_DIR = path.join(os.homedir(), '.claude', 'secure');
const PRIVATE_KEY_FILE = 'secure_key.pem';
const PUBLIC_KEY_FILE = 'public_key.pem';

class KeyManager {
  constructor(keyDir = null) {
    this.keyDir = keyDir || DEFAULT_KEY_DIR;
    this.privateKeyPath = path.join(this.keyDir, PRIVATE_KEY_FILE);
    this.publicKeyPath = path.join(this.keyDir, PUBLIC_KEY_FILE);
  }

  _ensureKeyDir() {
    if (!fs.existsSync(this.keyDir)) {
      fs.mkdirSync(this.keyDir, { recursive: true });
      try {
        fs.chmodSync(this.keyDir, 0o700);
      } catch (e) {}
    }
  }

  generateKeyPair(keySize = 2048, overwrite = false) {
    if (fs.existsSync(this.privateKeyPath) && !overwrite) {
      throw new Error(`Key file already exists: ${this.privateKeyPath}. Use overwrite=true to replace.`);
    }
    this._ensureKeyDir();
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: keySize,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    fs.writeFileSync(this.privateKeyPath, privateKey, 'utf8');
    fs.writeFileSync(this.publicKeyPath, publicKey, 'utf8');
    try {
      fs.chmodSync(this.privateKeyPath, 0o600);
      fs.chmodSync(this.publicKeyPath, 0o644);
    } catch (e) {}
    return [this.privateKeyPath, this.publicKeyPath];
  }

  loadPrivateKey() {
    if (!fs.existsSync(this.privateKeyPath)) {
      throw new Error(`Private key not found: ${this.privateKeyPath}`);
    }
    return fs.readFileSync(this.privateKeyPath, 'utf8');
  }

  loadPublicKey() {
    if (!fs.existsSync(this.publicKeyPath)) {
      throw new Error(`Public key not found: ${this.publicKeyPath}`);
    }
    return fs.readFileSync(this.publicKeyPath, 'utf8');
  }

  keyExists() {
    return fs.existsSync(this.privateKeyPath) && fs.existsSync(this.publicKeyPath);
  }

  getKeyInfo() {
    const st = fs.existsSync(this.privateKeyPath) ? fs.statSync(this.privateKeyPath) : null;
    return {
      key_dir: this.keyDir,
      private_key_exists: fs.existsSync(this.privateKeyPath),
      public_key_exists: fs.existsSync(this.publicKeyPath),
      private_key_created: st ? new Date(st.birthtime).toISOString() : null,
      private_key_modified: st ? new Date(st.mtime).toISOString() : null,
      private_key_size_bytes: st ? st.size : null
    };
  }

  signData(data) {
    const pem = this.loadPrivateKey();
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
    return sign.sign(pem);
  }

  verifySignature(data, signature, publicKeyPem = null) {
    try {
      const pem = publicKeyPem || this.loadPublicKey();
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
      return verify.verify(pem, Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'hex'));
    } catch (e) {
      return false;
    }
  }
}

module.exports = { KeyManager, DEFAULT_KEY_DIR };
