# dsh-plugin-tetris

一个装在 DeepSeek Harness Web GUI 右下角的仿 Qoder **无计分俄罗斯方块**。平时只显示一个紫色小方块；点开后是一块贴合当前主题的紧凑棋盘，用键盘直接玩。

## 环境

- DeepSeek Harness `0.2.1-rc.2`（Web profile）实测通过。
- `dsh.hostMin`：`0.2.0-rc.1`。
- Node.js >= 22。

## 安装

在插件仓库目录执行：

```bash
dsh plugin --profile web add "$PWD"
```

然后在 DSH 的 **Plugins** 页面确认 `dsh-plugin-tetris` 及组件已启用。

> 安装或启用后，请重启一次 `dsh web`。Web 客户端 bundle 会在下次启动时进入 `__DSH_BOOT__` 清单；重启后右下角会出现方块入口。

也可以手动在 profile 的 `package.json` 里添加：

```json
{
  "dependencies": {
    "dsh-plugin-tetris": "link:/absolute/path/to/dsh-plugin-tetris"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-plugin-tetris"]
    }
  }
}
```

## 操作

| 操作 | 键盘 |
| --- | --- |
| 左 / 右移动 | `←` / `→` |
| 旋转 | `↑` |
| 软降 | `↓` |
| 暂停 / 继续 | `Space` |
| 收起 | `Esc` |
| 游戏结束后重开 | `R` 或 `Enter` |

打开后焦点在棋盘上，按键只在棋盘获得焦点时生效；焦点移出面板、切换窗口或切到后台会自动收起，聊天输入框保持可用。操作全部通过键盘完成。

## Qoder 参考

Qoder 的原始小游戏是一个横向的 **53 × 7** 条带，整体 `726 × 98`：

- 格子间距 `3px`，每个格子 `aspect-square`、`rounded-[2px]`。
- 空格使用 `bg-sage-bg`：浅色 `#f0f3f2`，深色 `#1c2e25`。
- 实块颜色统一加 `/80` 透明度。
- 视觉上只有一格一格的色块。

它的调色板是：蓝 `#3f8ef7`、黄 `#f2c647`、紫 `#605ce5`、青 `#55b5a6`、粉 `#da5597`、薰衣草 `#b49ef9`、橙 `#ea873f`；深色主题对应 `#4ba8ff`、`#fac414`、`#9b96ff`、`#4dd4c4`、`#f472b6`、`#c9b5ff`、`#fa8125`。

本插件沿用它的**视觉语言**（透明缝、小圆角、sage 空格、80% 调色板；按 150% 缩放后为 4px 缝、3px 圆角），并使用 10 × 20 竖向棋盘和 `←→ / ↑ / ↓ / Space / Esc` 操作。

参考安装包：<https://qoder-app.oss-cn-beijing.aliyuncs.com/qoder-app/releases/latest/Qoder-CN-linux-amd64.deb>

## 开发

源码即产物：

```text
src/index.js          Host 侧入口
src/client.js         Web 客户端：游戏引擎 + Qoder 式小块 Canvas 棋盘 + 键盘面板
cordis.patch.yml      DSH bundle patch，插入 dsh-plugin-tetris 宿主条目
test/tetris.test.mjs  引擎与插件契约测试
```

运行检查：

```bash
npm test
npm run check
```

`npm run check` 会先做语法检查，再跑 9 个测试，覆盖包清单、`shell.overlay` 注册、方块形状/旋转、碰撞、消行、7-bag、生命周期和重开。

客户端通过以下方式接入：

```js
ctx.slots.inject('shell.overlay', () => ctx.slots.register({
  name: 'shell.overlay',
  id: 'dsh-plugin-tetris',
}, TetrisDock))
```

启动方块和棋盘都挂在根级 overlay 层，固定定位在右下角。棋盘通过 Canvas 直接绘制独立小色块；面板底色使用 DSH 的主题背景。焦点离开后组件卸载，页面恢复成只有一个方块入口的状态。

## License

[MIT](LICENSE) © 2026 Six-Yao
