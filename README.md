# dsh-plugin-tetris

一个装在 DeepSeek Harness Web GUI 右下角的**无计分俄罗斯方块**。点一下“俄罗斯方块 / START GAME”，在聊天界面旁边直接开玩；不打断会话，不占用输入框。

![右下角启动按钮](docs/launch-1440x900.png)

![打开后的游戏面板](docs/game-1440x900.png)

## 特性

- 10 × 20 标准棋盘，7 种方块、7-bag 随机、落点投影。
- 无分数、无等级、无连击，只有最基础的消行和堆叠。
- 键盘和屏幕按钮都能操作；`Esc` 关闭，`P` 暂停。
- 失焦或切到后台自动暂停，不会在聊天时误操作。
- 响应式：桌面右下角浮层，窄屏自动收窄并限制高度。
- 纯客户端 React 插件，无额外运行时依赖，不需要构建步骤。

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

> 安装或启用后，请重启一次 `dsh web`。Web 客户端 bundle 会在下次启动时进入 `__DSH_BOOT__` 清单；仅刷新页面不足以注册新的客户端插件。重启后右下角会出现启动按钮。

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

| 操作 | 键盘 | 屏幕按钮 |
| --- | --- | --- |
| 左 / 右移动 | `←` / `→` | `←` / `→` |
| 顺时针旋转 | `↑` 或 `X` | `↻` |
| 逆时针旋转 | `Z` | — |
| 软降 | `↓` | `↓` |
| 直接落下 | `Space` | `⇣` |
| 暂停 / 继续 | `P` | 标题栏暂停键 |
| 关闭 | `Esc` | 标题栏关闭键 |
| 游戏结束后重开 | `R` 或 `Enter` | “再来一局” |

按键只在游戏面板获得焦点时生效；点到面板外会暂停，不会劫持聊天输入。

## 响应式实测

在真实 DSH Web 页面中用 Chromium 测得（DPR = 1，单位 px）：

| 视口 | 启动按钮（宽 × 高） | 面板（宽 × 高） | 棋盘（宽 × 高） | 面板完全在视口内 |
| --- | --- | --- | --- | --- |
| 1440 × 900 | 130.0 × 48 | 332 × 602.3 | 234 × 468 | 是 |
| 1280 × 720 | 130.0 × 48 | 332 × 508.7 | 187.2 × 374.4 | 是 |
| 1024 × 768 | 130.0 × 48 | 332 × 533.7 | 199.7 × 399.4 | 是 |
| 390 × 844 | 127.0 × 44 | 332 × 573.2 | 219.4 × 438.9 | 是 |

桌面端右边距和底边距为 20px；移动端媒体查询下降为 12px。面板宽度受 `min(332px, calc(100vw - 24px))` 限制，高度受 `calc(100dvh - 40px)` 限制，棋盘随可用高度缩放。

其他截图：

- [暂停状态](docs/paused-1440x900.png)
- [手机尺寸 390 × 844](docs/game-390x844.png)

## 开发

仓库没有构建步骤，源码即产物：

```text
src/index.js        Host 侧占位插件（bundle 需要在 profile 中有一个宿主条目）
src/client.js       Web 客户端：游戏引擎 + React 面板 + 样式
cordis.patch.yml    DSH bundle patch，插入 dsh-plugin-tetris 宿主条目
test/tetris.test.mjs 引擎与插件契约测试
docs/               实机截图
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

面板和启动按钮都挂在根级 overlay 层，固定定位在右下角，层级高于聊天内容但不改变 DSH 自身布局。

## License

[MIT](LICENSE) © 2026 Liao Yuqiang
