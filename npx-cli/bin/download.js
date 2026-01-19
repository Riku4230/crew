const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// GitHub repository info - replaced during npm pack by workflow
const GITHUB_OWNER = "__GITHUB_OWNER__";
const GITHUB_REPO = "__GITHUB_REPO__";
const BINARY_TAG = "__BINARY_TAG__"; // e.g., v0.0.135-20251215122030
const CACHE_DIR = path.join(require("os").homedir(), ".crew", "bin");

// Local development mode: use binaries from npx-cli/dist/ instead of GitHub
// Only activate if dist/ exists (i.e., running from source after local-build.sh)
const LOCAL_DIST_DIR = path.join(__dirname, "..", "dist");
const LOCAL_DEV_MODE = fs.existsSync(LOCAL_DIST_DIR) || process.env.CREW_LOCAL === "1";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "crew-cli",
        "Accept": "application/json"
      }
    };

    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}`));
        }
      });
    }).on("error", reject);
  });
}

async function downloadFile(url, destPath, onProgress) {
  const tempPath = destPath + ".tmp";
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tempPath);
    const hash = crypto.createHash("sha256");

    const cleanup = () => {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    };

    const options = {
      headers: {
        "User-Agent": "crew-cli",
        "Accept": "application/octet-stream"
      }
    };

    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        cleanup();
        return downloadFile(res.headers.location, destPath, onProgress)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode !== 200) {
        file.close();
        cleanup();
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }

      const totalSize = parseInt(res.headers["content-length"], 10);
      let downloadedSize = 0;

      res.on("data", (chunk) => {
        downloadedSize += chunk.length;
        hash.update(chunk);
        if (onProgress) onProgress(downloadedSize, totalSize);
      });
      res.pipe(file);

      file.on("finish", () => {
        file.close();
        try {
          fs.renameSync(tempPath, destPath);
          resolve(destPath);
        } catch (err) {
          cleanup();
          reject(err);
        }
      });
    }).on("error", (err) => {
      file.close();
      cleanup();
      reject(err);
    });
  });
}

async function ensureBinary(platform, binaryName, onProgress) {
  // In local dev mode, use binaries directly from npx-cli/dist/
  if (LOCAL_DEV_MODE) {
    const localZipPath = path.join(LOCAL_DIST_DIR, platform, `${binaryName}.zip`);
    if (fs.existsSync(localZipPath)) {
      return localZipPath;
    }
    throw new Error(
      `Local binary not found: ${localZipPath}\n` +
      `Run ./local-build.sh first to build the binaries.`
    );
  }

  const cacheDir = path.join(CACHE_DIR, BINARY_TAG, platform);
  const zipPath = path.join(cacheDir, `${binaryName}.zip`);

  if (fs.existsSync(zipPath)) return zipPath;

  fs.mkdirSync(cacheDir, { recursive: true });

  // Download from GitHub Releases
  const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${BINARY_TAG}/${platform}-${binaryName}.zip`;
  await downloadFile(url, zipPath, onProgress);

  return zipPath;
}

async function getLatestVersion() {
  // Check if we're in local dev mode or placeholders aren't replaced
  if (LOCAL_DEV_MODE || GITHUB_OWNER.startsWith("__")) {
    return null;
  }

  try {
    const release = await fetchJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    );
    // Extract version from tag (e.g., "v0.0.1" -> "0.0.1")
    const tag = release.tag_name;
    return tag.startsWith("v") ? tag.slice(1).split("-")[0] : tag.split("-")[0];
  } catch {
    return null;
  }
}

module.exports = { GITHUB_OWNER, GITHUB_REPO, BINARY_TAG, CACHE_DIR, LOCAL_DEV_MODE, LOCAL_DIST_DIR, ensureBinary, getLatestVersion };
