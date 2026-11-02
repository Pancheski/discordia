import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const outDir = path.join(rootDir, 'dist-electron')
const releaseDir = path.join(rootDir, 'release')

fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(releaseDir, { recursive: true })

execSync('npx tsc -p tsconfig.electron.json', { cwd: rootDir, stdio: 'inherit' })

for (const name of ['main', 'preload']) {
  const jsPath = path.join(outDir, `${name}.js`)
  const cjsPath = path.join(outDir, `${name}.cjs`)
  if (fs.existsSync(jsPath)) {
    fs.renameSync(jsPath, cjsPath)
    console.log(`[build-electron] Gerado: dist-electron/${name}.cjs`)
  }
}
