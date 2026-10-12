#!/usr/bin/env node
/**
 * 判据运行器（criteria runner）
 *
 * 用法：
 *   node lib/runner.mjs                    # 跑 ./checks 下全部判据
 *   node lib/runner.mjs --dir <另一目录>    # 跑指定目录
 *   node lib/runner.mjs --filter tier      # 只跑文件名含 tier 的
 *   node lib/runner.mjs --json out.json    # 额外把结果写成 JSON
 *
 * 约定：目录下每个 *.check.mjs 导出
 *   name           短名（显示用）
 *   why            为什么这条判据重要（可选，会显示在输出里）
 *   kind           'hard' | 'weak'（判据强度分档，默认 hard）
 *   default export async (ctx) => boolean | { pass: boolean, detail?: string }
 *                  ctx = { checksDir, repoRoot }
 *
 * 双形态支持：
 *   历史上有些判据是**独立脚本**形态（顶层就 process.exit）。对这类文件绝不能 import——
 *   import 会执行其顶层代码，它一 exit 就把整个总闸顶掉（一个判据让后面几十项一项没跑，
 *   退出码还是 0，看起来"全绿"）。所以：源码里有 `export default` 的走 import 快路径；
 *   没有的丢进子进程跑，按退出码判定（0=通过，1=失败，2=无法判定——不计失败，单独显示）。
 *
 * 退出码：0 = 全部通过（含无法判定）；1 = 有失败项；2 = 一个判据都没找到。
 *
 * 注意：一条判据要先跑一次证明它会失败（见 lib/discrimination.mjs），否则只是"命令没报错"。
 */
import { readdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}

/** 判定一条 check 文件是"默认导出"型还是"独立脚本"型。 */
export const hasDefaultExport = (src) => /^\s*export\s+default\b/m.test(src)

/** 临时把环境变量并进 process.env（import 形态的判据从 process.env 读样本口子）。 */
async function withEnv(env, fn) {
  const saved = new Map()
  for (const [k, v] of Object.entries(env ?? {})) {
    saved.set(k, process.env[k])
    process.env[k] = String(v)
  }
  try {
    return await fn()
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

/**
 * 跑一个目录下的判据。
 * @param {{dir?: string, filter?: string|null, quiet?: boolean, env?: Record<string,string>, repoRoot?: string|null}} options
 * @returns {Promise<{rows: Array<{file:string,name:string,kind:string,pass:boolean,inconclusive:boolean,ms:number,detail:string,why:string}>, failed:number, skipped:number, summary:string}>}
 */
export async function runDir({ dir, filter = null, quiet = false, env = {}, repoRoot = null } = {}) {
  const target = path.resolve(dir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'checks'))
  const root = repoRoot ? path.resolve(repoRoot) : path.resolve(target, '..')
  let files
  try {
    files = (await readdir(target)).filter((f) => f.endsWith('.check.mjs')).sort()
  } catch (e) {
    throw new Error(`判据目录不可读：${target}（${e?.message ?? e}）`)
  }
  if (filter) files = files.filter((f) => f.includes(filter))
  if (!files.length) throw new Error(`没有找到任何判据脚本：${target}/*.check.mjs`)

  const rows = []
  let failed = 0
  for (const f of files) {
    const full = path.join(target, f)
    const t0 = Date.now()
    let pass = false
    let detail = ''
    let inconclusive = false
    let name = f.replace(/\.check\.mjs$/, '')
    let kind = 'hard'
    let why = ''

    const src = readFileSync(full, 'utf8')
    if (hasDefaultExport(src)) {
      const mod = await import(pathToFileURL(full).href)
      name = mod.name ?? name
      kind = mod.kind ?? 'hard'
      why = mod.why ?? ''
      try {
        const r = await withEnv(env, () => mod.default({ checksDir: target, repoRoot: root }))
        if (typeof r === 'boolean') pass = r
        else {
          pass = !!r?.pass
          detail = r?.detail ?? ''
        }
      } catch (e) {
        pass = false
        detail = `EXCEPTION: ${e?.message ?? String(e)}`
      }
    } else {
      const r = spawnSync(process.execPath, [full], { encoding: 'utf8', timeout: 240000, env: { ...process.env, ...env } })
      const tail = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')
      if (r.error) {
        pass = false
        detail = `SPAWN ERROR: ${r.error.message}`
      } else if (r.status === 2) {
        inconclusive = true
        detail = `INCONCLUSIVE: ${tail.slice(0, 220)}`
      } else {
        pass = r.status === 0
        detail = pass ? '' : tail.slice(0, 220) || `exit ${r.status}`
      }
    }

    const ms = Date.now() - t0
    if (!pass && !inconclusive) failed++
    rows.push({ file: f, name, kind, pass, inconclusive, ms, detail, why })
  }

  const skipped = rows.filter((r) => r.inconclusive).length
  const summary = `${rows.length - failed - skipped} 通过 / ${failed} 失败 / ${skipped} 无法判定 → 退出码 ${failed ? 1 : 0}`
  if (!quiet) print(rows, summary, target, root)
  return { rows, failed, skipped, summary }
}

function print(rows, summary, target, root) {
  const widest = Math.max(...rows.map((r) => [...r.name].length), 6)
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].length))
  console.log(`\n判据总闸 —— ${rows.length} 项（${target}）\n`)
  for (const r of rows) {
    const tag = r.inconclusive ? 'SKIP' : r.pass ? 'PASS' : 'FAIL'
    console.log(`  ${pad(tag, 4)}  ${pad(r.name, widest)}  ${pad(r.kind, 4)}  ${pad(r.ms + 'ms', 8)}  ${r.detail}`)
  }
  console.log(`\n${summary}\n`)
}

// 作为 CLI 直接跑时（被 import 时不执行）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = opt('--dir', null)
  const filter = opt('--filter', null)
  const jsonOut = opt('--json', null)
  try {
    const { rows, failed, skipped, summary } = await runDir({ dir, filter })
    if (jsonOut) await writeFile(jsonOut, JSON.stringify({ dir, summary, failed, skipped, rows }, null, 2), 'utf8')
    process.exit(failed ? 1 : 0)
  } catch (e) {
    console.error(String(e?.message ?? e))
    process.exit(2)
  }
}
