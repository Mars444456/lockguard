const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pipeline}=require('node:stream/promises');
const MAGIC=Buffer.from('LGBACK01');
function key(value=process.env.LOCKGUARD_BACKUP_KEY) {
  if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw new Error('LOCKGUARD_BACKUP_KEY must be a base64-encoded 32-byte key stored separately from backups.');
  const bytes=Buffer.from(value,'base64');if(bytes.length!==32)throw new Error('Invalid backup key');return bytes;
}
async function encrypt(source,target,secret) {
  const bytes=key(secret),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',bytes,iv);
  let created=false;
  try {
    const fd=fs.openSync(target,'wx',0o600);created=true;
    try{fs.writeSync(fd,Buffer.concat([MAGIC,iv,Buffer.alloc(16)]));}finally{fs.closeSync(fd);}
    await pipeline(fs.createReadStream(source),cipher,fs.createWriteStream(target,{flags:'a',mode:0o600}));
    const handle=fs.openSync(target,'r+');try{fs.writeSync(handle,cipher.getAuthTag(),0,16,20);}finally{fs.closeSync(handle);}
    return target;
  }catch(error){if(created)fs.unlinkSync(target);throw error;}
}
async function plaintext(source, secret = process.env.LOCKGUARD_BACKUP_KEY, { requireEncrypted = false } = {}) {
  const fd=fs.openSync(source,'r'),header=Buffer.alloc(36);let length;
  try{length=fs.readSync(fd,header);}finally{fs.closeSync(fd);}
  if (!header.subarray(0, 8).equals(MAGIC)) {
    if (requireEncrypted || /\.enc$/i.test(source)) throw new Error('Invalid encrypted backup header');
    return { file: source, cleanup() {} };
  }
  if(length!==36)throw new Error('Truncated encrypted backup');
  const bytes=key(secret),dir=fs.mkdtempSync(path.join(os.tmpdir(),'lockguard-decrypted-')),file=path.join(dir,'backup.sqlite3');
  fs.chmodSync(dir,0o700);
  const cleanup=()=>{if(path.dirname(file)!==dir||path.dirname(dir)!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('lockguard-decrypted-'))throw new Error('Invalid backup temporary path');if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);};
  try {
    const decipher=crypto.createDecipheriv('aes-256-gcm',bytes,header.subarray(8,20));decipher.setAuthTag(header.subarray(20,36));
    await pipeline(fs.createReadStream(source,{start:36}),decipher,fs.createWriteStream(file,{flags:'wx',mode:0o600}));
    return {file,cleanup};
  }catch{cleanup();throw new Error('Encrypted backup authentication failed. Check the key and backup integrity.');}
}
module.exports={encrypt,plaintext};
