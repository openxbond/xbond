import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

const EXTENSIONS = new Set([
  ".js",
  ".css",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

const ROOT_FILES = new Set([
  "index.html",
  "manifest.webmanifest",
  ".nojekyll",
  "LICENSE",
  "THIRD_PARTY_NOTICES.txt",
]);

const SOURCE_MAP_PATTERN = /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/;
const SECRET_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ghp_|github_pat_|ghs_)[A-Za-z0-9_]{20,}/;
const MAX_SIZE = 200 * 1024 * 1024;

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;

export interface ZipEntryInput {
  name: string;
  data: Buffer | string;
  externalAttr?: number;
  createSystem?: number;
}

interface ParsedZipEntry {
  name: string;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  externalAttr: number;
  localHeaderOffset: number;
  data: Buffer;
}

export function validateTag(tag: string): {
  version: [number, number, number];
  prerelease: string | null;
} {
  if (tag.includes("\n") || tag.includes("\r")) {
    throw new Error("Expected a version tag such as v0.4.0");
  }
  const match = TAG_PATTERN.exec(tag);
  if (!match) {
    throw new Error("Expected a version tag such as v0.4.0");
  }
  return {
    version: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

export function checksum(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function buildZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const item of entries) {
    const nameBytes = Buffer.from(item.name, "utf8");
    const rawData =
      typeof item.data === "string"
        ? Buffer.from(item.data, "utf8")
        : item.data;
    const compressed = zlib.deflateRawSync(rawData);
    const crc = zlib.crc32(rawData) >>> 0;
    const createSystem = item.createSystem ?? 3;
    const externalAttr = item.externalAttr ?? ((S_IFREG | 0o644) << 16) >>> 0;

    // Fixed DOS date/time (1980-01-01 00:00:00) for deterministic output
    const dosTime = 0;
    const dosDate = (1 << 5) | 1;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8); // DEFLATE
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((createSystem << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10); // DEFLATE
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(externalAttr >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localParts.push(localHeader, nameBytes, compressed);
    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function parseZipBuffer(buf: Buffer): ParsedZipEntry[] {
  let eocdOffset = -1;
  const minEocdSearch = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minEocdSearch; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("Invalid zip archive: missing EOCD");
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);
  const entries: ParsedZipEntry[] = [];
  let ptr = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error("Invalid zip archive: corrupt central directory");
    }
    const compressionMethod = buf.readUInt16LE(ptr + 10);
    const crc32 = buf.readUInt32LE(ptr + 16);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const fileNameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const externalAttr = buf.readUInt32LE(ptr + 38);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);

    const name = buf
      .subarray(ptr + 46, ptr + 46 + fileNameLen)
      .toString("utf8");
    ptr += 46 + fileNameLen + extraLen + commentLen;

    if (
      localHeaderOffset + 30 > buf.length ||
      buf.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw new Error(`Invalid local header for: ${name}`);
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const localName = buf
      .subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLen)
      .toString("utf8");
    if (localName !== name) {
      throw new Error(`Unsafe archive path: ${localName}`);
    }
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawSlice = buf.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (compressionMethod === 0) {
      data = Buffer.from(rawSlice);
    } else if (compressionMethod === 8) {
      data = zlib.inflateRawSync(rawSlice);
    } else {
      throw new Error(
        `Unsupported compression method ${compressionMethod} in: ${name}`,
      );
    }
    if (zlib.crc32(data) >>> 0 !== crc32 || data.length !== uncompressedSize) {
      throw new Error(`CRC or size mismatch in: ${name}`);
    }
    entries.push({
      name,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      externalAttr,
      localHeaderOffset,
      data,
    });
  }

  return entries;
}

function isSafeRelativePosixPath(name: string): boolean {
  if (
    !name ||
    name.includes("\\") ||
    name.startsWith("/") ||
    name.includes(":")
  ) {
    return false;
  }
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) < 32) {
      return false;
    }
  }
  const stripped = name.replace(/\/+$/, "");
  if (!stripped || stripped.includes("//")) {
    return false;
  }
  const normalized = path.posix.normalize(stripped);
  if (normalized !== stripped) {
    return false;
  }
  const parts = stripped.split("/");
  if (parts.some((p) => p === "." || p === "..")) {
    return false;
  }
  if (parts.some((p) => p.startsWith(".") && p !== ".nojekyll")) {
    return false;
  }
  return true;
}

export function validateArchive(
  archivePath: string,
  checksumsPath?: string,
  extractDir?: string,
): string {
  const digest = checksum(archivePath);
  if (checksumsPath) {
    const expected = `${digest}  dashboard.zip\n`;
    const actual = fs.readFileSync(checksumsPath, "utf8");
    if (actual !== expected) {
      throw new Error("SHA256SUMS does not match dashboard.zip");
    }
  }

  const entries = parseZipBuffer(fs.readFileSync(archivePath));
  const totalBytes = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
  if (entries.length > 10000 || totalBytes > MAX_SIZE) {
    throw new Error("Archive exceeds distribution limits");
  }

  const seen = new Set<string>();
  let hasRootIndex = false;

  for (const entry of entries) {
    const name = entry.name;
    if (!isSafeRelativePosixPath(name)) {
      throw new Error(`Unsafe archive path: ${name}`);
    }
    const folded = name.toLowerCase();
    if (seen.has(folded)) {
      throw new Error(`Duplicate archive path: ${name}`);
    }
    seen.add(folded);

    const mode = entry.externalAttr >>> 16;
    const fmt = mode & S_IFMT;
    if (fmt === S_IFLNK || (fmt !== 0 && fmt !== S_IFREG && fmt !== S_IFDIR)) {
      throw new Error(`Unsupported archive entry: ${name}`);
    }

    if (name.endsWith("/") || fmt === S_IFDIR) {
      continue;
    }

    if (name === "index.html") {
      hasRootIndex = true;
    }

    const parts = name.split("/");
    const ext = path.posix.extname(name).toLowerCase();
    const allowed =
      ROOT_FILES.has(name) ||
      (EXTENSIONS.has(ext) &&
        (parts.length === 1 || parts[0] === "assets" || parts[0] === "icons"));
    if (!allowed) {
      throw new Error(`Not a compiled distribution file: ${name}`);
    }

    const text = entry.data.toString("latin1");
    if (
      SECRET_PATTERN.test(text) ||
      ((ext === ".js" || ext === ".css") && SOURCE_MAP_PATTERN.test(text))
    ) {
      throw new Error(`Secret or source map reference in: ${name}`);
    }
  }

  if (!hasRootIndex) {
    throw new Error("index.html must be at the archive root");
  }

  if (extractDir) {
    for (const entry of entries) {
      if (
        entry.name.endsWith("/") ||
        ((entry.externalAttr >>> 16) & S_IFMT) === S_IFDIR
      ) {
        continue;
      }
      const target = path.join(extractDir, ...entry.name.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.data);
    }
  }

  return digest;
}

function collectFilesRecursive(
  rootDir: string,
  currentDir = rootDir,
): string[] {
  const results: string[] = [];
  const items = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(currentDir, item.name);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink in distribution: ${fullPath}`);
    }
    if (stat.isDirectory()) {
      results.push(...collectFilesRecursive(rootDir, fullPath));
    } else if (stat.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

export function packageDistribution(
  directory: string,
  outputDir: string,
): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const files = collectFilesRecursive(directory).sort((a, b) => {
    const relA = path.relative(directory, a).split(path.sep).join("/");
    const relB = path.relative(directory, b).split(path.sep).join("/");
    return relA < relB ? -1 : relA > relB ? 1 : 0;
  });

  const zipInputs: ZipEntryInput[] = files.map((filePath) => ({
    name: path.relative(directory, filePath).split(path.sep).join("/"),
    data: fs.readFileSync(filePath),
    externalAttr: ((S_IFREG | 0o644) << 16) >>> 0,
  }));

  const archivePath = path.join(outputDir, "dashboard.zip");
  fs.writeFileSync(archivePath, buildZipBuffer(zipInputs));
  const digest = validateArchive(archivePath);
  fs.writeFileSync(
    path.join(outputDir, "SHA256SUMS"),
    `${digest}  dashboard.zip\n`,
    "utf8",
  );
  return digest;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [, , command, ...rest] = process.argv;
  if (command === "package") {
    const [directory, output] = rest;
    if (!directory || !output) {
      throw new Error("Usage: artifact.ts package <directory> <output>");
    }
    console.log(packageDistribution(directory, output));
  } else if (command === "validate") {
    const [archive, checksums, maybeExtractFlag, extractDir] = rest;
    if (!archive || !checksums) {
      throw new Error(
        "Usage: artifact.ts validate <archive> <checksums> [--extract <dir>]",
      );
    }
    const extract = maybeExtractFlag === "--extract" ? extractDir : undefined;
    console.log(validateArchive(archive, checksums, extract));
  } else {
    throw new Error(`Unknown command: ${command ?? ""}`);
  }
}
