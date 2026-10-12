# dsh-agent-discipline

把「判据先行、坏样本先证明会失败、返工记账」这套工程纪律，做成可以跑的东西。

它不是一个运行时插件（不接管任何通道、不改你的配置），是一套工具包：一个判据运行器、一个元判据、四份方法论文档、一份自写的行为层示例条文。可以整套用，也可以只抄走其中一件。

## 为什么会有它

和 agent 一起干活，最大的浪费不是"它做错了"，而是"它说做完了，而没人验证过"。

于是有了判据：把「完成」从一句话变成一个命令加一个期望信号（退出码、字段、行数、差异）。

但判据本身也会骗人。我们踩过两次，两条判据都是绿的、又都没测对东西：

- 一条把异常名当判定依据（`error.name === 'AbortError'`），而运行时会包装异常，名字根本对不上——它永远走另一条分支，测的是空气。
- 一条要求了机制上做不到的事（要求某个运行中的进程把它内存里的状态表写回磁盘），于是它永远红；被人为放宽之后，又永远绿。

从那以后多了一条铁律：**每条判据都要先用坏样本证明它会红**。这就是 `lib/discrimination.mjs` 的全部内容。

## 四件东西

| 件 | 文件 | 干什么 |
|---|---|---|
| 判据运行器 | `lib/runner.mjs` | 跑一个目录下的 `*.check.mjs`，给通过 / 失败 / 无法判定与退出码 |
| 元判据 | `lib/discrimination.mjs` | 拿坏样本跑你的判据；**没报红的判据说明它测不出问题** |
| 方法论文档 | `docs/` | 判据怎么选、坏样本怎么造、账本怎么记、四层怎么分工 |
| 行为层示例条文 | `examples/behavior-layer-sample.md` | 一份可直接改成自己版本的行为约束条文示例 |

## 快速开始

```bash
npm i -D dsh-agent-discipline
node lib/runner.mjs --dir checks
```

输出形如：

```
判据总闸 —— 2 项

  PASS  changelog-version-sync  hard  2ms   版本 0.1.0 与 CHANGELOG 首条一致（共 1 条）
  PASS  repo-no-absolute-path   hard  4ms   扫了 lib/checks/docs/examples 与三个根文件，0 处

2 通过 / 0 失败 / 0 无法判定 → 退出码 0
```

写第一条判据，放 `checks/<名字>.check.mjs`：

```js
export const name = 'my-first-check'
export const kind = 'hard'        // hard 挡门 / weak 只提示
export const why = '这一条挡什么'   // 会显示在输出里，写给半年后的自己
export default async ({ repoRoot }) => {
  const ok = true                 // ← 换成真的去检查某个可观察事实
  return { pass: ok, detail: ok ? '一句话说明查了什么' : '差在哪' }
}
```

然后证明它会失败，这一步不能省：

```js
// checks/discrimination.check.mjs
import { runCases, report } from '../lib/discrimination.mjs'

const cases = [
  {
    name: 'my-first-check',
    why: '把被检查的东西改坏之后，这条判据必须报红',
    make: (dir) => ({ env: { MY_TARGET: join(dir, 'broken') } }),  // 造坏样本
  },
]

const res = await runCases(cases, { checksDir: 'checks' })
process.exit(report(res) ? 0 : 1)
```

判据要求被测代码支持指向别处的样本（环境变量或命令行参数）。没有这个口子的判据没法自证——
要么先给它开个口子，要么承认它没被验证过。

## 三条铁律

1. **判据先行**：动手前先把「什么算做完」写成一个能跑的命令加一个期望信号。给不出判据就先补，别开工。
2. **坏样本先证**：新判据先跑一次，看它对着坏样本报红。一次就通过的判据没有区分度。
3. **返工记账**：返工了就把原因记一行（实现错 / 判据错 / 环境问题）。样本攒够才看得出模式，否则一次通过率只是感觉。

## 目录

```
lib/runner.mjs                       判据运行器（双形态支持、--dir/--filter/--json）
lib/discrimination.mjs               元判据（坏样本必须报红）
checks/repo-no-absolute-path.check.mjs   示例判据：仓里不能有本机绝对路径
checks/changelog-version-sync.check.mjs  示例判据：版本号与 CHANGELOG 自洽
docs/01-criteria.md                  判据怎么选，hard/weak 怎么分
docs/02-discrimination.md            坏样本怎么造（含两个真实踩过的坑）
docs/03-ledger.md                    能力账本口径与字段
docs/04-four-layers.md               行为层 / 技能 / 守卫插件 / 档位插件四层分工
examples/behavior-layer-sample.md    自写行为层示例条文
```

## 边界

- 它只管**机器判得了**的东西：配置、通道、文件、账本、接口、产物形状。输出质量本身没有判据——写得好不好、分析得准不准，还得人看。这是框架的真实边界，不是漏做。
- 它不接管运行时、不改配置、不联网；判据是普通 Node 脚本，你写什么它就跑什么。
- 与 [dsh-behavior-guard](https://github.com/StarflowDream/dsh-behavior-guard) 的分工：那个是"把行为条文注入进会话的插件"，本仓是"验证自己有没有做到"的判据与方法论。两者独立，可以只用其一。

## License

MIT
