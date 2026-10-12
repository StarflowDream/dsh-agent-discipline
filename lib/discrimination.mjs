#!/usr/bin/env node
/**
 * 元判据：每条判据都要先证明它会失败。
 *
 * 没做过"坏样本必须报红"的判据，绿只说明「命令没报错」，不说明「它测对了东西」。
 * 这是最贵的一课：两条自我感觉良好的判据可以同时是绿的、又同时什么都没测——
 * 一条把异常名当判定依据（异常被运行时包装过，名字根本对不上），
 * 一条要求了机制上做不到的事（于是永远红、或者被绕过成永远绿）。
 *
 * 用法：
 *   import { runCases } from './discrimination.mjs'
 *   const { ok, bad, results } = await runCases([
 *     {
 *       name: 'my-check',                  // 判据文件名（不含 .check.mjs），用作 --filter
 *       why: '配置里删掉必填项后必须报红',
 *       make: (dir) => ({ env: { MY_CONF: path.join(dir, 'bad.json') } }),   // 造坏样本
 *     },
 *     {
 *       name: 'other-check',
 *       why: '内部逻辑被清空后必须报红',
 *       direct: true,                       // 该判据只能直接跑
 *       make: (dir) => ({ args: ['--conf', path.join(dir, 'bad.json')] }),
 *     },
 *   ], { runner: runDir, checksDir: 'checks' })
 *
 * 判定：坏样本下判据必须**非零退出**（或 runner 报 failed > 0）。绿了就说明这条判据
 * 测不出问题——要么判定条件写得太松，要么它根本没在看坏样本指向的那个东西。
 *
 * 两个易踩的坑（都真实踩过）：
 *   1. 坏样本文件名/位置必须与被测代码真正读取的位置一致。凭空建一个没人 import 的文件，
 *      判据照绿——它根本没读到你的样本。
 *   2. 坏样本要照判据语义造，不要照"看起来坏"造。把配置清空有时等于恢复默认值，
 *      在判据眼里是正常状态；要造的是它明确断言不该出现的那个值。
 */
import { mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

/**
 * @typedef {object} Case
 * @property {string} name           判据名（= 文件名去掉 .check.mjs）
 * @property {string} [why]          坏样本坏在哪，一句话
 * @property {(dir:string)=>{env?:Record<string,string>,args?:string[],filter?:string,direct?:boolean}} make
 * @property {boolean} [direct]      只能直接跑（不用 --filter 走 runner）
 * @property {string} [filter]       自定义 filter（默认用 name）
 */

/**
 * 跑一组"坏样本必须报红"的用例。
 * @param {Case[]} cases
 * @param {{checksDir?:string, workDir?:string, runner?:Function, only?:string}} [options]
 */
export async function runCases(cases, options = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const checksDir = path.resolve(options.checksDir ?? path.join(here, '..', 'checks'))
  const workDir = path.resolve(options.workDir ?? path.join(here, '..', '.discrimination'))
  const only = options.only ?? null
  const runDir = options.runner ?? (await import(pathToFileURL(path.join(here, 'runner.mjs')).href)).runDir

  const results = []
  await mkdir(workDir, { recursive: true })

  for (const c of cases) {
    if (only && !c.name.includes(only)) continue
    const dir = path.join(workDir, c.name)
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })

    let seam
    try {
      seam = (await c.make(dir)) ?? {}
    } catch (e) {
      results.push({ name: c.name, status: 'ERR', detail: `造样本失败：${e?.message ?? e}`, why: c.why ?? '' })
      continue
    }

    let wentRed = false
    let detail = ''
    try {
      if (c.direct || seam.direct) {
        const r = spawnSync(process.execPath, [path.join(checksDir, c.name + '.check.mjs'), ...(seam.args ?? [])], {
          env: { ...process.env, ...(seam.env ?? {}) },
          encoding: 'utf8',
          timeout: 240000,
          cwd: path.resolve(checksDir, '..'),
        })
        wentRed = r.status !== 0
        detail = ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? ''
      } else {
        const res = await runDir({
          dir: checksDir,
          filter: seam.filter ?? c.name,
          quiet: true,
          env: seam.env ?? {},
          repoRoot: seam.repoRoot ?? null,
        })
        // runner 会把样本 env 与 repoRoot 传下去；坏样本下判据只要红（失败或无法判定）就算有效
        wentRed = res.failed > 0 || res.skipped > 0
        detail = res.rows.map((r) => r.detail).filter(Boolean).join(' | ').slice(0, 160)
      }
    } catch (e) {
      wentRed = true
      detail = `runner 异常（也算红）：${e?.message ?? e}`
    }
    results.push({ name: c.name, status: wentRed ? 'red' : 'GREEN', detail, why: c.why ?? '' })
  }

  const bad = results.filter((r) => r.status !== 'red').length
  return { ok: bad === 0, bad, results }
}

/** 把结果打成表；调用方决定要不要 process.exit。 */
export function report({ results, bad }, label = '元判据') {
  for (const r of results) {
    const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - [...String(s)].length))
    if (r.status === 'red') console.log(`  ok    ${pad(r.name, 26)} 坏样本如期报红  ${r.detail}`)
    else console.log(`  FAIL  ${pad(r.name, 26)} ${r.status === 'GREEN' ? '坏样本没报红（这条判据测不出问题）' : '造不出样本'}  ${r.detail}`)
  }
  console.log(`\n${label}：${results.length - bad}/${results.length} 条判据证明了自己会失败\n`)
  return bad === 0
}
