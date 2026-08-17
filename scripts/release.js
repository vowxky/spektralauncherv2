import fs from "fs"
import path from "path"
import crypto from "crypto"
import { execFileSync } from "child_process"
import "dotenv/config"

const BRAND = "Spektra"
const SLUG = "spektra"
const CDN = "https://cdn.stackedhost.crysistudio.xyz/spektra/release/latest"
const bundleDir = path.resolve("target/release/bundle/nsis")
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
