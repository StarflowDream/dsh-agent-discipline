/**
 * 示例判据 2：CHANGELOG 与 package.json 的版本必须自洽。
 *
 * 这类判据的价值不在"发现了什么 bug"，而在于它把一条口头规矩变成了每次提交都要过的门：
 * 发版的人改了 version 却忘了写 CHANGELOG（或者反过来），是最高频、最没技术含量、
 * 又最容易被 review 放过的一类不一致。
 */
export const name = 'changelog-version-sync'
export const kind = 'hard'
export const why = 'package.json 的 version 与 CHANGELOG 最新条目对不上时别人会拿到说不清的版本'

export default async ({ repoRoot }) => {
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+/.test(String(pkg.version))) {
    return { pass: false, detail: `package.json 的 version 不是 semver：${pkg.version}` }
  }
  const text = await readFile(path.join(repoRoot, 'CHANGELOG.md'), 'utf8').catch(() => '')
  if (!text) return { pass: false, detail: 'CHANGELOG.md 不存在或为空' }

  const headings = [...text.matchAll(/^##\s+(?:\[?v?)(\d+\.\d+\.\d+)/gm)].map((m) => m[1])
  if (!headings.length) return { pass: false, detail: 'CHANGELOG.md 里没有任何 "## <版本>" 标题' }
  if (headings[0] !== pkg.version) {
    return { pass: false, detail: `CHANGELOG 最新版本 ${headings[0]}，package.json 是 ${pkg.version}` }
  }
  if (new Set(headings).size !== headings.length) {
    return { pass: false, detail: `CHANGELOG 里有重复版本号：${headings.join(', ')}` }
  }
  // 顺手挡一下"复制的空条目"：最新版本标题下面得有正文
  // 注意：从 '##' 位置开始切，split 的第一段会是空串，要取第一个非空段
  const firstBody = text.slice(text.indexOf('##')).split(/^##\s/m).filter((s) => s.trim())[0] ?? ''
  if (firstBody.replace(/^##.*$/m, '').trim().length < 20) {
    return { pass: false, detail: `CHANGELOG 的 ${pkg.version} 条目没有正文` }
  }
  return { pass: true, detail: `版本 ${pkg.version} 与 CHANGELOG 首条一致（共 ${headings.length} 条）` }
}
