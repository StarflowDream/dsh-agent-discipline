/**
 * 示例判据 1：仓库里不能出现本机绝对路径。
 *
 * 为什么值得单独有一条判据：这类东西本地跑永远是对的，只有到了别人机器上才炸，
 * 而那时候你已经不在场了。人工 review 会漏（它们在设置默认值、注释、测试数据里
 * 看起来很自然），所以交给机器每条提交都看一眼。
 */
export const name = 'repo-no-absolute-path'
export const kind = 'hard'
export const why = '仓里出现 C:\\Users\\<name>、/home/<name> 这类本机路径，别人装了就坏'

const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.tgz', '.woff', '.woff2'])
const SCAN_DIRS = ['lib', 'checks', 'docs', 'examples']
const OWN = ['repo-no-absolute-path'] // 本文件自己会提到这些模式，跳过

export default async ({ repoRoot }) => {
  const { readdir, readFile, stat } = await import('node:fs/promises')
  const path = await import('node:path')
  const hits = []

  async function walk(dir, rel = '') {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        await walk(full, relPath)
        continue
      }
      if (SKIP_EXT.has(path.extname(e.name).toLowerCase())) continue
      const text = await readFile(full, 'utf8').catch(() => '')
      if (!text) continue
      text.split(/\r?\n/).forEach((line, i) => {
        // 找 C:\、C:/、/Users/<x>、/home/<x> 形态；文档里作为"反例"提到的行允许带 [allow-abs-path]
        if (line.includes('[allow-abs-path]')) return
        const m = line.match(/[A-Za-z]:[\\/]{1,2}(?:Users|Documents|Program|Windows)\b|\/(?:Users|home)\/[A-Za-z0-9._-]+\//)
        if (m) hits.push(`${relPath}:${i + 1}  ${m[0]}`)
      })
    }
  }

  for (const d of SCAN_DIRS) {
    const full = path.join(repoRoot, d)
    try {
      const s = await stat(full)
      if (s.isDirectory()) await walk(full, d)
    } catch {
      /* 目录不存在就跳过 */
    }
  }

  // 顺带看根目录的 JSON/MD（package.json、README 也算公开面）
  for (const f of ['package.json', 'README.md', 'CHANGELOG.md']) {
    const text = await readFile(path.join(repoRoot, f), 'utf8').catch(() => '')
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      if (line.includes('[allow-abs-path]')) continue
      const m = line.match(/[A-Za-z]:[\\/]{1,2}(?:Users|Documents|Program|Windows)\b|\/(?:Users|home)\/[A-Za-z0-9._-]+\//)
      if (m) hits.push(`${f}:${i + 1}  ${m[0]}`)
    }
  }

  const self = hits.filter((h) => !OWN.some((o) => h.includes(o)))
  return {
    pass: self.length === 0,
    detail: self.length ? `${self.length} 处本机绝对路径：${self.slice(0, 5).join(' ; ')}` : `扫了 ${SCAN_DIRS.join('/')} 与三个根文件，0 处`,
  }
}
