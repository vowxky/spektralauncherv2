import fs from "fs"
import path from "path"
import crypto from "crypto"
import { execFileSync } from "child_process"
import "dotenv/config"

const BRAND = "Spektra"
const SLUG = "spektra"
const CDN = "https://cdn.stackedhost.crysistudio.xyz/spektra/release/latest"
// Con --target x86_64-pc-windows-msvc el bundle va a target/x86_64-pc-windows-msvc/release/...
// Sin --target va a target/release/... — soportar ambos para CI y local
function resolveBundleDir() {
  const candidates = [
    path.resolve("target/release/bundle/nsis"),
    path.resolve("target/x86_64-pc-windows-msvc/release/bundle/nsis"),
    path.resolve("target/x86_64-unknown-linux-gnu/release/bundle"),
    path.resolve("target/aarch64-apple-darwin/release/bundle"),
  ]
  for (const p of candidates) if (fs.existsSync(p)) return p
  // Fallback: buscar cualquier bundle/nsis bajo target
  try {
    const targetDir = path.resolve("target")
    if (fs.existsSync(targetDir)) {
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) {
            if (full.endsWith("bundle/nsis") && fs.existsSync(full)) return full
            const found = walk(full)
            if (found) return found
          }
        }
        return null
      }
      const found = walk(targetDir)
      if (found) return found
    }
  } catch {}
  return path.resolve("target/release/bundle/nsis")
}
const bundleDir = resolveBundleDir()
const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"))
const version = config.version
const releaseDate = new Date().toISOString()

if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  console.error("Falta TAURI_SIGNING_PRIVATE_KEY en .env")
  process.exit(1)
}

if (!fs.existsSync(bundleDir)) {
  console.error(`No existe el directorio de instaladores: ${bundleDir}`)
  process.exit(1)
}

const expectedName = `${BRAND}_${version}_x64-setup.exe`
const generated = path.join(bundleDir, expectedName)
const installerName = `${SLUG}-setup.exe`
const installer = path.join(bundleDir, installerName)

if (!fs.existsSync(generated)) {
  console.error(`No se encontro el instalador generado: ${generated}`)
  process.exit(1)
}

for (const file of fs.readdirSync(bundleDir)) {
  if (file.endsWith(".sig")) fs.rmSync(path.join(bundleDir, file), { force: true })
  if (file.startsWith(`${BRAND}_`) && file.endsWith(".exe") && file !== expectedName) {
    fs.rmSync(path.join(bundleDir, file), { force: true })
  }
}

fs.rmSync(installer, { force: true })
fs.renameSync(generated, installer)

console.log(`Firmando ${installerName}...`)
execFileSync("npx.cmd", ["tauri", "signer", "sign", installer], {
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
})

const signaturePath = `${installer}.sig`
if (!fs.existsSync(signaturePath)) {
  console.error(`No se genero la firma: ${signaturePath}`)
  process.exit(1)
}

const signature = fs.readFileSync(signaturePath, "utf8").trim()
const installerBuffer = fs.readFileSync(installer)
const sha512 = crypto.createHash("sha512").update(installerBuffer).digest("base64")
const fileSize = fs.statSync(installer).size

const update = {
  version,
  notes: `${BRAND} ${version}`,
  pub_date: releaseDate,
  platforms: {
    "windows-x86_64": {
      url: `${CDN}/${installerName}`,
      signature,
    },
  },
}

fs.writeFileSync(path.join(bundleDir, "update.json"), JSON.stringify(update, null, 2))
fs.writeFileSync(
  path.join(bundleDir, "latest.yml"),
  `version: ${version}\nfiles:\n  - url: ${installerName}\n    sha512: >-\n      ${sha512}\n    size: ${fileSize}\npath: ${installerName}\nsha512: >-\n  ${sha512}\nreleaseDate: '${releaseDate}'\n`,
)

console.log(`Release ${BRAND} ${version} listo en ${bundleDir}`)
