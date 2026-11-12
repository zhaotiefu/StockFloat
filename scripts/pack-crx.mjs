/**
 * Pack dist/ into a CRX3 file.
 *
 * Usage: node scripts/pack-crx.mjs
 *
 * Outputs:
 *   release/stock-float.crx
 *   release/stock-float.pem  (created once for stable extension id)
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");
const outDir = join(root, "release");
const crxPath = join(outDir, "stock-float.crx");
const pemPath = join(outDir, "stock-float.pem");

mkdirSync(outDir, { recursive: true });

if (!existsSync(join(dist, "manifest.json"))) {
  console.error("dist/ missing — run npm run build first");
  process.exit(1);
}

if (!existsSync(pemPath)) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(
    pemPath,
    privateKey.export({ type: "pkcs1", format: "pem" })
  );
  console.log("created signing key:", pemPath);
}

const keyObject = createPrivateKey(readFileSync(pemPath));
const pubDer = createPublicKey(keyObject).export({ type: "spki", format: "der" });
const extensionId = createHash("sha256")
  .update(pubDer)
  .digest("hex")
  .slice(0, 32)
  .split("")
  .map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
  .join("");

function collectFiles(dir, base = dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".map")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectFiles(full, base, files);
    } else {
      files.push({
        abs: full,
        name: relative(base, full).split("\\").join("/"),
      });
    }
  }
  return files;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const data = readFileSync(file.abs);
    const nameBuf = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const localFull = Buffer.concat([local, nameBuf, compressed]);
    localParts.push(localFull);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, nameBuf]));
    offset += localFull.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDir, end]);
}

function encodeVarint(value) {
  const out = [];
  let v = value >>> 0;
  while (true) {
    const bits = v & 0x7f;
    v >>>= 7;
    if (v) out.push(bits | 0x80);
    else {
      out.push(bits);
      break;
    }
  }
  return Buffer.from(out);
}

function protoBytes(field, data) {
  return Buffer.concat([
    encodeVarint((field << 3) | 2),
    encodeVarint(data.length),
    data,
  ]);
}

const files = collectFiles(dist);
const zipData = zipStore(files);

const crxId = createHash("sha256").update(pubDer).digest().subarray(0, 16);
const signedHeaderData = protoBytes(1, crxId);
const signedHeaderLen = Buffer.alloc(4);
signedHeaderLen.writeUInt32LE(signedHeaderData.length);

const signed = Buffer.concat([
  Buffer.from("CRX3 SignedData\x00"),
  signedHeaderLen,
  signedHeaderData,
  zipData,
]);

const sign = createSign("SHA256");
sign.update(signed);
sign.end();
const signature = sign.sign(keyObject);

const proof = Buffer.concat([protoBytes(1, pubDer), protoBytes(2, signature)]);
const header = Buffer.concat([
  protoBytes(2, proof),
  protoBytes(10000, signedHeaderData),
]);

const version = Buffer.alloc(4);
version.writeUInt32LE(3);
const headerSize = Buffer.alloc(4);
headerSize.writeUInt32LE(header.length);

const crx = Buffer.concat([
  Buffer.from("Cr24"),
  version,
  headerSize,
  header,
  zipData,
]);

writeFileSync(crxPath, crx);
console.log("packed", crxPath);
console.log("size", `${(crx.length / 1024).toFixed(1)} KB`);
console.log("extension id", extensionId);
console.log("files", files.length);
