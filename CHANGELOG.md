# 更新日志

## 0.1.0

首个公开版本，四件东西：

- **判据运行器**（`lib/runner.mjs`）：跑一个目录下的 `*.check.mjs`，输出通过 / 失败 / 无法判定三态与退出码（0 / 1 / 2）。双形态支持：有 `export default` 的走 import，独立脚本形态的丢子进程按退出码判定，避免一个判据 `process.exit` 顶掉整个总闸。
- **元判据**（`lib/discrimination.mjs`）：拿坏样本跑你的判据，**绿了说明这条判据测不出问题**。附两个真实踩过的坑（坏样本位置对不上、坏样本没照判据语义造）。
- **方法论文档**（`docs/`）：判据怎么选与怎么分档、坏样本怎么造、能力账本怎么记、行为层 / 技能 / 守卫插件 / 档位插件四层怎么分工。
- **行为层示例条文**（`examples/behavior-layer-sample.md`）：一份自写的行为约束条文，可整套改用，也可只抄几条。

自带两条示例判据（`checks/repo-no-absolute-path.check.mjs`、`checks/changelog-version-sync.check.mjs`）与它们的坏样本用例，跑 `node lib/runner.mjs --dir checks` 可看到判据总闸长什么样。
