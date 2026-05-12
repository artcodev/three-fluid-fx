import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const forwardedArgs = process.argv.slice(2)

function run(script, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    child.on('error', rejectRun)
    child.on('exit', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${script} exited with code ${code}`))
    })
  })
}

await run('scripts/record-demo.mjs', forwardedArgs)
await run('scripts/stitch-demo.mjs', forwardedArgs)
