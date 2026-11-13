import { execFileSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checksum, validateArchive } from "./artifact.ts";
import {
  androidAbis,
  androidAsset,
  cliAsset,
  desktopRelease,
  linuxPackageFormats,
  releaseTargets,
  releaseVersion,
} from "./release-version.ts";

const repo = "https://github.com/openxbond/xbond";

// The Pages deployment carries exactly these files; the deployment digest is
// sha256 over a sha256sum --binary listing of them (the "*name" marker is
// part of that listing format).
const PAGES_FILES = [
  "index.html",
  "download/index.html",
  "release.json",
  "desktop.json",
];

function pagesDigest(files: Map<string, Buffer>): string {
  const listing = PAGES_FILES.map(
    (name) =>
      `${createHash("sha256")
        .update(files.get(name) ?? Buffer.alloc(0))
        .digest("hex")} *${name}\n`,
  ).join("");
  return createHash("sha256").update(listing).digest("hex");
}

function verifyTauriSignature(
  file: string,
  signature: string,
  publicKey: string,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xbond-signature-"));
  const keyFile = path.join(dir, "key.pub");
  const signatureFile = path.join(dir, "asset.minisig");
  try {
    fs.writeFileSync(keyFile, Buffer.from(publicKey, "base64"));
    fs.writeFileSync(signatureFile, Buffer.from(signature, "base64"));
    execFileSync("minisign", [
      "-V",
      "-q",
      "-p",
      keyFile,
      "-x",
      signatureFile,
      "-m",
      file,
    ]);
  } finally {
    fs.unlinkSync(keyFile);
    fs.unlinkSync(signatureFile);
    fs.rmdirSync(dir);
  }
}

function putJSON(directory: string, name: string, data: unknown) {
  fs.writeFileSync(
    path.join(directory, name),
    JSON.stringify(data, null, 2) + "\n",
  );
}

function readAsset(directory: string, name: string) {
  const file = path.join(directory, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size === 0)
    throw new Error(`Invalid asset: ${name}`);
  return file;
}

export function assemble(
  directory: string,
  tag: string,
  notes: string,
  privateKeyPEM: string,
  expectedPublicKey: string,
) {
  const { version, build } = releaseVersion(tag);
  const key = createPrivateKey(privateKeyPEM);
  const publicKey = createPublicKey(key).export({ format: "jwk" });
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !publicKey.x ||
    Buffer.from(publicKey.x, "base64url").toString("base64") !==
      expectedPublicKey
  ) {
    throw new Error("The release key does not match XBOND_RELEASE_PUBLIC_KEY");
  }
  const assets: Record<string, { name: string; url: string; sha256: string }> =
    {};
  const fileNames = new Set<string>();
  function asset(id: string, name: string) {
    fileNames.add(name);
    return (assets[id] = {
      name,
      url: `${repo}/releases/download/${tag}/${name}`,
      sha256: checksum(readAsset(directory, name)),
    });
  }
  const platforms: Record<string, { url: string; signature: string }> = {};
  for (const [os, arch] of releaseTargets) {
    asset(`cli-${os}-${arch}`, cliAsset(tag, os, arch));
    const names = desktopRelease(tag, os, arch);
    const installer = asset(`desktop-${os}-${arch}`, names.installer);
    for (const { format, name } of names.packages) {
      asset(`desktop-${os}-${arch}-${format}`, name);
    }
    const updater =
      os === "darwin"
        ? asset(`updater-${os}-${arch}`, names.updater)
        : installer;
    const signatureName = updater.name + ".sig";
    const signature = fs
      .readFileSync(readAsset(directory, signatureName), "utf8")
      .trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))
      throw new Error(`Invalid Tauri signature: ${signatureName}`);
    if (process.env.XBOND_TAURI_PUBLIC_KEY) {
      verifyTauriSignature(
        path.join(directory, updater.name),
        signature,
        process.env.XBOND_TAURI_PUBLIC_KEY,
      );
    }
    fileNames.add(signatureName);
    platforms[`${os}-${arch === "amd64" ? "x86_64" : "aarch64"}`] = {
      url: updater.url,
      signature,
    };
  }
  for (const abi of androidAbis) {
    asset(`android-${abi}`, androidAsset(tag, abi));
  }
  asset("android-universal", androidAsset(tag));
  asset("dashboard", "dashboard.zip");
  putJSON(directory, "desktop.json", { version, notes, platforms });
  asset("desktop-manifest", "desktop.json");
  asset("release-evidence", "release-evidence.json");
  const payload = Buffer.from(
    JSON.stringify({ version, build, notes, assets }),
  );
  putJSON(directory, "release.json", {
    payload: payload.toString("base64"),
    signature: sign(null, payload, key).toString("base64"),
  });
  fileNames.add("release.json");
  for (const name of fs.readdirSync(directory)) {
    if (!fileNames.has(name) && name !== "SHA256SUMS") {
      throw new Error(`Unexpected release asset: ${name}`);
    }
  }
  fs.writeFileSync(
    path.join(directory, "SHA256SUMS"),
    [...fileNames]
      .sort()
      .map((name) => `${checksum(path.join(directory, name))}  ${name}\n`)
      .join(""),
  );
}

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

type ReleaseAsset = { name: string; url: string; sha256: string };

function readManifest(directory: string, tag: string, publicKey: string) {
  const { version, build } = releaseVersion(tag);
  const manifestPath = readAsset(directory, "release.json");
  const envelope = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey))
    throw new Error("Invalid release public key");
  const key = createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: Buffer.from(publicKey, "base64").toString("base64url"),
    },
    format: "jwk",
  });
  const payload = Buffer.from(envelope.payload, "base64");
  if (!verify(null, payload, key, Buffer.from(envelope.signature, "base64")))
    throw new Error("Invalid release manifest signature");
  const manifest: {
    assets: Record<string, ReleaseAsset>;
    notes: string;
    version: string;
    build: number;
  } = JSON.parse(payload.toString("utf8"));
  if (manifest.version !== version || manifest.build !== build)
    throw new Error("Release manifest version mismatch");
  for (const { name, url } of Object.values(manifest.assets)) {
    if (
      !/^[a-zA-Z0-9._-]+$/.test(name) ||
      url !== `${repo}/releases/download/${tag}/${name}`
    ) {
      throw new Error(`Release asset mismatch: ${name}`);
    }
  }
  return manifest;
}

export function verifyManifestAsset(
  directory: string,
  tag: string,
  id: string,
  publicKey: string,
) {
  const asset = readManifest(directory, tag, publicKey).assets[id];
  if (!asset || checksum(readAsset(directory, asset.name)) !== asset.sha256) {
    throw new Error(`Release asset mismatch: ${id}`);
  }
}

const PLATFORM_ICON_PATHS = {
  windows:
    "M0,0H11.377V11.372H0ZM12.623,0H24V11.372H12.623ZM0,12.623H11.377V24H0Zm12.623,0H24V24H12.623",
  apple:
    "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701",
  android:
    "M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z",
  linux:
    "M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 01-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z",
  docker:
    "M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z",
  github:
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
};

function platformIcon(name: keyof typeof PLATFORM_ICON_PATHS) {
  // Brand-colored where the mark is famous for it; the rest follow the text.
  if (name === "windows") {
    return `<svg class="platform-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#F25022" d="M0,0H11.377V11.372H0Z"/><path fill="#7FBA00" d="M12.623,0H24V11.372H12.623Z"/><path fill="#00A4EF" d="M0,12.623H11.377V24H0Z"/><path fill="#FFB900" d="M12.623,12.623H24V24H12.623Z"/></svg>`;
  }
  const fill =
    name === "android"
      ? "#3DDC84"
      : name === "docker"
        ? "#2496ED"
        : "currentColor";
  return `<svg class="platform-icon" viewBox="0 0 24 24" fill="${fill}" aria-hidden="true"><path d="${PLATFORM_ICON_PATHS[name]}"/></svg>`;
}

// Locales mirror the cloud dash (apps/dash/locales); English is the no-JS
// fallback baked into the markup, the rest apply client-side.
type DownloadLocale = "en" | "zh" | "zh-HK" | "ko" | "fa";

const DOWNLOAD_LOCALES: Record<
  DownloadLocale,
  { lang: string; dir: "ltr" | "rtl"; name: string }
> = {
  en: { lang: "en", dir: "ltr", name: "English" },
  zh: { lang: "zh-Hans", dir: "ltr", name: "简体中文" },
  "zh-HK": { lang: "zh-Hant", dir: "ltr", name: "繁體中文" },
  ko: { lang: "ko", dir: "ltr", name: "한국어" },
  fa: { lang: "fa", dir: "rtl", name: "فارسی" },
};

const DOWNLOAD_STRINGS: Record<DownloadLocale, Record<string, string>> = {
  en: {
    title: "Download XBond",
    lede: "The dual-core proxy client for desktop and mobile — import your subscription and connect.",
    dashboard: "XBond Dashboard",
    download: "Download",
    abiHint:
      "Most phones run arm64-v8a. Not sure? universal works on any device, but is larger.",
    recommended: "Recommended",
    mostPhones: "most phones",
    iosInvite: "Contact the release maintainer for a TestFlight invitation.",
    dockerTitle: "Docker deployment",
    modeTun: "Gateway mode",
    modePort: "Port mode",
    tipTun: "All traffic from the host and LAN. Linux only.",
    tipPort: "Local HTTP or SOCKS proxy on any host.",
    cliHint: "Standalone binaries — no installation required.",
    releaseInfo: "Release information",
    githubRelease: "GitHub Release",
    checksums: "SHA-256 checksums",
    releaseNotes: "Release notes",
    copy: "Copy",
    copied: "Copied",
    otherBuilds: "Other builds",
    appleChip: "Apple silicon",
    intelChip: "Intel",
    langAria: "Language",
  },
  zh: {
    title: "下载 XBond",
    lede: "面向桌面与移动的双核代理客户端——导入订阅，即刻连接。",
    dashboard: "XBond 控制台",
    download: "下载",
    abiHint: "大多数手机是 arm64-v8a；不确定机型就选 universal，通用但更大。",
    recommended: "推荐",
    mostPhones: "大多数手机",
    iosInvite: "联系发布维护者获取 TestFlight 邀请。",
    dockerTitle: "Docker 部署",
    modeTun: "网关模式",
    modePort: "端口模式",
    tipTun: "接管主机与局域网全部流量，仅限 Linux。",
    tipPort: "本地 HTTP/SOCKS 代理，适用任意主机。",
    cliHint: "独立命令行二进制，无需安装。",
    releaseInfo: "发布信息",
    githubRelease: "GitHub Release",
    checksums: "SHA-256 校验和",
    releaseNotes: "发布说明",
    copy: "复制",
    copied: "已复制",
    otherBuilds: "其他构建",
    appleChip: "Apple 芯片",
    intelChip: "Intel 芯片",
    langAria: "语言",
  },
  "zh-HK": {
    title: "下載 XBond",
    lede: "面向桌面與流動的雙核代理用戶端——匯入訂閱，即刻連線。",
    dashboard: "XBond 控制台",
    download: "下載",
    abiHint: "大多數手機是 arm64-v8a；不確定機型就選 universal，通用但更大。",
    recommended: "推薦",
    mostPhones: "大多數手機",
    iosInvite: "聯絡發布維護者獲取 TestFlight 邀請。",
    dockerTitle: "Docker 部署",
    modeTun: "網關模式",
    modePort: "連接埠模式",
    tipTun: "接管主機與區域網絡全部流量，僅限 Linux。",
    tipPort: "本機 HTTP/SOCKS 代理，適用任何主機。",
    cliHint: "獨立命令列二進位檔，無需安裝。",
    releaseInfo: "發布資訊",
    githubRelease: "GitHub Release",
    checksums: "SHA-256 校驗和",
    releaseNotes: "發布說明",
    copy: "複製",
    copied: "已複製",
    otherBuilds: "其他構建",
    appleChip: "Apple 晶片",
    intelChip: "Intel 晶片",
    langAria: "語言",
  },
  ko: {
    title: "XBond 다운로드",
    lede: "데스크톱과 모바일을 위한 듀얼 코어 프록시 클라이언트 — 구독을 가져오고 바로 연결하세요.",
    dashboard: "XBond 콘솔",
    download: "다운로드",
    abiHint:
      "대부분의 휴대폰은 arm64-v8a입니다. 확실하지 않으면 universal을 선택하세요 — 모든 기기에서 작동하지만 더 큽니다.",
    recommended: "추천",
    mostPhones: "대부분의 휴대폰",
    iosInvite: "TestFlight 초대는 릴리스 담당자에게 문의하세요.",
    dockerTitle: "Docker 배포",
    modeTun: "게이트웨이 모드",
    modePort: "포트 모드",
    tipTun: "호스트와 로컬 네트워크의 모든 트래픽을 처리합니다. Linux 전용.",
    tipPort: "모든 호스트에서 로컬 HTTP/SOCKS 프록시로 사용합니다.",
    cliHint: "독립 실행 바이너리 — 설치가 필요 없습니다.",
    releaseInfo: "릴리스 정보",
    githubRelease: "GitHub Release",
    checksums: "SHA-256 체크섬",
    releaseNotes: "릴리스 노트",
    copy: "복사",
    copied: "복사됨",
    otherBuilds: "기타 빌드",
    appleChip: "Apple 실리콘",
    intelChip: "Intel",
    langAria: "언어",
  },
  fa: {
    title: "دانلود XBond",
    lede: "کلاینت پروکسی دو هسته‌ای برای دسکتاپ و موبایل — اشتراک خود را وارد کنید و متصل شوید.",
    dashboard: "کنسول XBond",
    download: "دانلود",
    abiHint:
      "بیشتر گوشی‌ها arm64-v8a هستند. اگر مطمئن نیستید، universal را انتخاب کنید — روی همه دستگاه‌ها کار می‌کند اما بزرگ‌تر است.",
    recommended: "پیشنهادی",
    mostPhones: "بیشتر گوشی‌ها",
    iosInvite: "برای دریافت دعوت‌نامه TestFlight با مسئول انتشار تماس بگیرید.",
    dockerTitle: "استقرار Docker",
    modeTun: "حالت دروازه",
    modePort: "حالت پورت",
    tipTun: "تمام ترافیک میزبان و شبکه محلی را عبور می‌دهد. فقط Linux.",
    tipPort: "پروکسی محلی HTTP/SOCKS روی هر میزبان.",
    cliHint: "باینری‌های مستقل — نیازی به نصب نیست.",
    releaseInfo: "اطلاعات انتشار",
    githubRelease: "GitHub Release",
    checksums: "چک‌سام SHA-256",
    releaseNotes: "یادداشت‌های انتشار",
    copy: "کپی",
    copied: "کپی شد",
    otherBuilds: "ساخت‌های دیگر",
    appleChip: "اپل سیلیکون",
    intelChip: "Intel",
    langAria: "زبان",
  },
};

export function buildPages(
  directory: string,
  output: string,
  tag: string,
  storeLinks: string[],
  publicKey: string,
) {
  const { version, assets, notes } = readManifest(directory, tag, publicKey);
  const sums = fs.readFileSync(readAsset(directory, "SHA256SUMS"), "utf8");
  const checksums = new Map<string, string>();
  for (const line of sums.trimEnd().split("\n")) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9._-]+)$/.exec(line);
    if (
      !match ||
      checksums.has(match[2]) ||
      checksum(readAsset(directory, match[2])) !== match[1]
    ) {
      throw new Error(`Release checksum mismatch: ${line}`);
    }
    checksums.set(match[2], match[1]);
  }
  for (const { name, sha256 } of Object.values(assets)) {
    if (checksums.get(name) !== sha256)
      throw new Error(`Release asset mismatch: ${name}`);
  }
  validateArchive(path.join(directory, "dashboard.zip"), undefined, output);
  for (const name of ["release.json", "desktop.json", "SHA256SUMS"]) {
    fs.copyFileSync(path.join(directory, name), path.join(output, name));
  }
  const downloadArrow = `<svg class="entry-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14m-7-7 7 7 7-7"/></svg>`;
  const externalArrow = `<svg class="entry-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>`;

  const copyIcons = `<svg class="icon-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

  // Download entries: the whole row is the link — label and format chip on
  // the left, a small icon-tile affordance on the right. The release
  // version lives once in the topbar chip, so rows stay quiet. Arch labels
  // and file formats are product vocabulary; the rest goes through
  // data-i18n.
  const fmtChip = (text: string) => `<span class="fmt">${text}</span>`;
  const entryRow = (options: {
    url: string;
    label: string;
    labelI18n?: [string, string];
    chip?: string;
    captionI18n?: [string, string] | null;
    recommended?: boolean;
  }) =>
    `<a class="entry${options.recommended ? " recommended" : ""}" href="${escape(options.url)}">
  <span class="entry-label"><strong${options.labelI18n ? ` data-i18n="${options.labelI18n[0]}"` : ""}>${options.label}</strong>${options.recommended ? `<span class="badge" data-i18n="recommended">Recommended</span>` : ""}${options.captionI18n ? `<span class="caption" data-i18n="${options.captionI18n[0]}">${options.captionI18n[1]}</span>` : ""}${options.chip ? fmtChip(options.chip) : ""}</span>
  <span class="entry-meta"><span class="entry-icon">${downloadArrow}</span><span class="sr-only" data-i18n="download">Download</span></span>
</a>`;

  const archLabel = (arch: string) => (arch === "amd64" ? "x64" : "ARM64");
  // Mac users pick by chip family, not instruction set.
  const macArch = (arch: string): [string, string] =>
    arch === "amd64" ? ["intelChip", "Intel"] : ["appleChip", "Apple silicon"];
  const osLabel: Record<string, string> = {
    windows: "Windows",
    darwin: "macOS",
    linux: "Linux",
  };
  const desktopFormat: Record<string, string | null> = {
    windows: ".exe",
    darwin: ".dmg",
    linux: null,
  };
  const desktopCard = (os: "windows" | "darwin" | "linux") => {
    const entries = ["amd64", "arm64"]
      .map((arch) =>
        entryRow({
          url: assets[`desktop-${os}-${arch}`].url,
          label: os === "darwin" ? macArch(arch)[1] : archLabel(arch),
          labelI18n: os === "darwin" ? macArch(arch) : undefined,
          chip: desktopFormat[os] ?? undefined,
        }),
      )
      .join("");
    return `<article class="card">
  <div class="card-head"><span class="icon-tile">${platformIcon(os === "windows" ? "windows" : os === "darwin" ? "apple" : "linux")}</span><h2>${osLabel[os]}</h2></div>
  <div class="entries">${entries}</div>
</article>`;
  };
  // Linux groups its three package formats per architecture; arch heads
  // share the card's top edge and the format buttons sit flat on the card.
  const linuxCard = `<article class="card">
  <div class="card-head"><span class="icon-tile">${platformIcon("linux")}</span><h2>Linux</h2></div>
  ${["amd64", "arm64"]
    .map(
      (arch) => `<div class="arch-group">
  <div class="group-head"><strong>Linux ${archLabel(arch)}</strong></div>
  <div class="group-actions">${linuxPackageFormats
    .filter((format) => assets[`desktop-linux-${arch}-${format}`])
    .map(
      (format) =>
        `<a class="btn" href="${escape(assets[`desktop-linux-${arch}-${format}`]!.url)}">.${format}</a>`,
    )
    .join(
      "",
    )}<a class="btn btn-primary" href="${escape(assets[`desktop-linux-${arch}`].url)}">AppImage</a></div>
</div>`,
    )
    .join("")}
</article>`;

  const desktopCards =
    desktopCard("windows") + desktopCard("darwin") + linuxCard;

  // Android card: the recommended default is the one prominent row; every
  // other build — universal included for unknown devices — stays reachable
  // as quiet links below it.
  const androidPrimary = entryRow({
    url: assets["android-arm64-v8a"].url,
    label: "arm64-v8a",
    chip: ".apk",
    captionI18n: ["mostPhones", "most phones"],
    recommended: true,
  });
  const otherBuilds = androidAbis
    .filter((abi) => abi !== "arm64-v8a")
    .map(
      (abi) =>
        `<a class="mini-link" href="${escape(assets[`android-${abi}`].url)}">${abi}</a>`,
    )
    .join("");
  const androidCard = `<article class="card android">
  <div class="card-head"><span class="icon-tile">${platformIcon("android")}</span><h2>Android</h2></div>
  <p class="card-hint" data-i18n="abiHint">Most phones run arm64-v8a. Not sure? universal works on any device, but is larger.</p>
  <div class="entries">${androidPrimary}</div>
  <div class="other-builds"><span class="other-builds-label" data-i18n="otherBuilds">Other builds</span>${otherBuilds}<a class="mini-link" href="${escape(assets["android-universal"].url)}">universal</a></div>
</article>`;

  const storeHosts = ["apps.apple.com", "testflight.apple.com"];
  const stores = ["App Store", "TestFlight"].map((label, index) => {
    const value = storeLinks[index]?.trim();
    if (!value) return "";
    const link = new URL(value);
    if (
      link.protocol !== "https:" ||
      link.host !== storeHosts[index] ||
      link.username ||
      link.password ||
      (label === "TestFlight" &&
        !/^\/join\/[a-zA-Z0-9]+\/?$/.test(link.pathname))
    )
      throw new Error(`Invalid ${label} URL`);
    return `<a class="entry" href="${escape(link.href)}">
  <span class="entry-label"><strong>${label}</strong></span>
  <span class="entry-meta"><span class="entry-icon">${externalArrow}</span></span>
</a>`;
  });
  const iosBody =
    stores.join("") ||
    `<p class="card-hint" data-i18n="iosInvite">Contact the release maintainer for a TestFlight invitation.</p>`;
  const iosCard = `<article class="card">
  <div class="card-head"><span class="icon-tile">${platformIcon("apple")}</span><h2>iOS</h2></div>
  <div class="entries">${iosBody}</div>
</article>`;

  // CLI binaries ship as their own card below the installers.
  const cliColumn = (os: "windows" | "darwin" | "linux") => {
    const entries = ["amd64", "arm64"]
      .map((arch) =>
        entryRow({
          url: assets[`cli-${os}-${arch}`].url,
          label: os === "darwin" ? macArch(arch)[1] : archLabel(arch),
          labelI18n: os === "darwin" ? macArch(arch) : undefined,
          chip: os === "windows" ? ".exe" : undefined,
        }),
      )
      .join("");
    const icon = platformIcon(
      os === "windows" ? "windows" : os === "darwin" ? "apple" : "linux",
    );
    return `<div class="cli-group">
  <div class="cli-group-head">${icon}<span>${osLabel[os]}</span></div>
  <div class="entries">${entries}</div>
</div>`;
  };
  const cliCard = `<article class="card">
  <div class="card-head"><span class="icon-tile"><svg class="platform-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 17 6-5-6-5M12 19h8"/></svg></span><h2>CLI</h2></div>
  <p class="card-hint" data-i18n="cliHint">Standalone binaries — no installation required.</p>
  <div class="cli-columns">${(["windows", "linux", "darwin"] as const)
    .map((os) => cliColumn(os))
    .join("")}</div>
</article>`;

  // Docker card distilled to its working parts: mode toggle, one-line tip,
  // the pull command and the run/compose panel — each command block with a
  // copy affordance wired by the template script. Commands carry no
  // SUB_URL; the web dashboard (OAuth device authorization) is the
  // intended setup path.
  const dockerInitial = [
    "docker run -d",
    "  --pull always",
    "  --name xbond",
    "  --restart unless-stopped",
    "  --network host",
    "  --cap-add NET_ADMIN",
    "  --device /dev/net/tun",
    "  -v xbond-data:/data",
    "  -e TZ='Asia/Shanghai'",
    "  -e XBOND_TAKEOVER_MODE='tun'",
    "  -e XBOND_MIXED_PORT='7890'",
    "  -e XBOND_DASHBOARD_LISTEN='127.0.0.1:19090'",
    "  ghcr.io/openxbond/xbond:latest",
  ].join(" \\\n");
  const dockerCard = `<article class="card">
  <div class="card-head"><span class="icon-tile">${platformIcon("docker")}</span><h2 data-i18n="dockerTitle">Docker deployment</h2></div>
  <div class="mode-toggle">
    <button type="button" class="mode-btn active" data-mode="tun"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg><span data-i18n="modeTun">Gateway mode</span></button>
    <button type="button" class="mode-btn" data-mode="port"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg><span data-i18n="modePort">Port mode</span></button>
  </div>
  <p class="card-hint" id="mode-tip">All traffic from the host and LAN. Linux only.</p>
  <div class="pull-line" dir="ltr"><code id="pull-code">docker pull ghcr.io/openxbond/xbond:latest</code><button type="button" class="copy-btn" id="pull-copy" aria-label="Copy">${copyIcons}</button></div>
  <div class="code-panel" dir="ltr">
    <div class="code-panel-head">
      <div class="code-tabs">
        <button type="button" class="code-tab active" data-form="run">docker run</button>
        <button type="button" class="code-tab" data-form="compose">docker compose</button>
      </div>
      <button type="button" class="copy-btn" id="cmd-copy" aria-label="Copy">${copyIcons}</button>
    </div>
    <pre class="code-cmd"><code id="docker-cmd-code">${dockerInitial}</code></pre>
  </div>
</article>`;

  const releaseCard = `<article class="card">
  <div class="card-head"><span class="icon-tile">${platformIcon("github")}</span><h2 data-i18n="releaseInfo">Release information</h2></div>
  <div class="release-links">
    <a class="btn" href="${escape(`${repo}/releases/tag/${tag}`)}" data-i18n="githubRelease">GitHub Release</a>
    <a class="btn" href="../SHA256SUMS" data-i18n="checksums">SHA-256 checksums</a>
  </div>
  <details><summary data-i18n="releaseNotes">Release notes</summary><pre dir="auto">${escape(notes)}</pre></details>
</article>`;

  // The page shell (CSS, topbar, hero, script) lives in
  // download-page.html.template
  // as plain HTML; this function only injects the per-release pieces. The
  // template's own script owns locale detection and the Docker command
  // builder, so no JS is authored inside this module's template strings.
  const template = fs.readFileSync(
    new URL("./download-page.html.template", import.meta.url),
    "utf8",
  );
  const replacements: Record<string, string> = {
    version,
    desktopCards,
    mobileCards: `${androidCard}${iosCard}`,
    cliCard,
    dockerCard,
    releaseCard,
    stringsJson: JSON.stringify(DOWNLOAD_STRINGS),
    localesJson: JSON.stringify(DOWNLOAD_LOCALES),
  };
  let html = template;
  for (const [name, value] of Object.entries(replacements)) {
    const token = `@@${name}@@`;
    if (!html.includes(token))
      throw new Error(`Download page template is missing ${token}`);
    html = html.replaceAll(token, value);
  }
  if (html.includes("@@"))
    throw new Error("Unresolved placeholder in download page template");
  fs.mkdirSync(path.join(output, "download"), { recursive: true });
  fs.writeFileSync(path.join(output, "download/index.html"), html);
  const pages = new Map<string, Buffer>(
    PAGES_FILES.map((name) => [name, fs.readFileSync(path.join(output, name))]),
  );
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `pages_digest=${pagesDigest(pages)}\n`,
    );
}

async function pagesVerify(pagesUrl: string, tag: string, expected: string) {
  const base = pagesUrl.replace(/\/+$/, "");
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const files = new Map<string, Buffer>();
    try {
      for (const name of PAGES_FILES) {
        // Mirror the curl cache-buster: index pages are fetched as directories.
        const target = `${base}/${name.replace("index.html", "")}?v=${tag}`;
        const response = await fetch(target);
        if (!response.ok)
          throw new Error(`${target} returned ${response.status}`);
        files.set(name, Buffer.from(await response.arrayBuffer()));
      }
      if (pagesDigest(files) === expected) {
        console.log(`Pages serve the verified release (${expected})`);
        return;
      }
      throw new Error("the served digest differs from the deployment");
    } catch (error) {
      if (attempt === 6)
        throw new Error(
          `GitHub Pages did not serve the verified Dashboard, download page and both update feeds: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

const [command, tag, directory, argument, ...rest] = process.argv.slice(2);
if (command === "assemble") {
  if (!process.env.XBOND_TAURI_PUBLIC_KEY)
    throw new Error("Missing Tauri update public key");
  assemble(
    directory,
    tag,
    fs.readFileSync(argument, "utf8"),
    process.env.XBOND_RELEASE_PRIVATE_KEY ?? "",
    process.env.XBOND_RELEASE_PUBLIC_KEY ?? "",
  );
} else if (command === "pages")
  buildPages(
    directory,
    argument,
    tag,
    rest,
    process.env.XBOND_RELEASE_PUBLIC_KEY ?? "",
  );
else if (command === "pages-verify")
  await pagesVerify(directory, tag, argument ?? "");
else if (command === "verify")
  verifyManifestAsset(
    directory,
    tag,
    argument,
    process.env.XBOND_RELEASE_PUBLIC_KEY ?? "",
  );
else if (command) throw new Error(`Unknown release asset command: ${command}`);
