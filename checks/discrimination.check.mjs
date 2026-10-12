#!/usr/bin/env node
/**
 * 元判据入口：本仓两条示例判据的坏样本用例。
 *
 * 跑法：node checks/discrimination.check.mjs
 * 期望：每条用例都报红（红 = 判据测得出问题）。任何一条"没报红"都说明该判据无效。
 *
 * 它自己也是一条 *.check.mjs，所以会被 runner 一起跑；退出码 0 = 全部用例如期报红。
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runCases, report } from '../lib/discrimination.mjs'

export const name = 'discrimination'
export const kind = 'hard'
export const why = '元判据：拿坏样本证明每条判据会红；没报红的判据只是"没报错"，不是"测对了"'

const cases = [
  {
    name: 'repo-no-absolute-path',
    why: '坏样本仓里塞了一行本机绝对路径，必须报红',
    make: async (dir) => {
      const fake = join(dir, 'fake-repo')
      await mkdir(join(fake, 'lib'), { recursive: true })
      // 坏样本本身要写成"像真的"：路径出现在看起来正常的赋值语句里。
      // 注意不能带 [allow-abs-path] 标记——那正是判据的合法豁免通道，带了就等于样本不坏。
      await writeFile(join(fake, 'lib', 'sample.js'), "export const dataDir = 'C:\\\\Users\\\\someone\\\\data'\n", 'utf8')
      await writeFile(join(fake, 'package.json'), JSON.stringify({ name: 'fake', version: '1.0.0' }), 'utf8')
      return { repoRoot: fake }
    },
  },
  {
    name: 'changelog-version-sync',
    why: '坏样本仓里 CHANGELOG 首条版本与 package.json 对不上，必须报红',
    make: async (dir) => {
      const fake = join(dir, 'fake-repo')
      await mkdir(fake, { recursive: true })
      await writeFile(join(fake, 'package.json'), JSON.stringify({ name: 'fake', version: '1.1.0' }), 'utf8')
      await writeFile(join(fake, 'CHANGELOG.md'), '# 更新日志\n\n## 0.9.0\n\n上一次的改动说明文本在这里，够长了。\n', 'utf8')
      return { repoRoot: fake }
    },
  },
]

const res = await runCases(cases, { checksDir: join(import.meta.dirname) })
process.exit(report(res, '元判据') ? 0 : 1)
