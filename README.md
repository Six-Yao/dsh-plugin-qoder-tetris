# dsh-plugin-tetris

一个装在 DeepSeek Harness Web GUI 右下角的**无计分俄罗斯方块**。平时只显示一个紫色的简单方块；点一下打开透明棋盘，用键盘直接玩。不打断会话，不占用输入框。

![右下角的方块入口](docs/launch-1440x900.png)

![打开后的透明棋盘](docs/game-1440x900.png)

## 特性

- 10 × 20 标准棋盘，7 种方块、7-bag 随机。
- 无分数、无等级、无连击，只有最基础的堆叠和消行。
- 透明背景：没有面板底色、圆角、阴影、渐变、标题文字或角标。
- 方块是纯色色块，没有描边、倒角或立体光影。
- 没有游戏内按钮；操作提示固定在棋盘下方。
- 打开后键盘接管移动、旋转、软降、硬降和暂停；`Esc` 收起。
- 面板失去焦点、窗口失焦或标签页隐藏时自动收缩回方块。
- 响应式：窄屏自动收窄，棋盘高度受视口高度限制。
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

> 安装或启用后，请重启一次 `dsh web`。Web 客户端 bundle 会在下次启动时进入 `__DSH_BOOT__` 清单；仅刷新页面不足以注册新的客户端插件。重启后右下角会出现方块入口。

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
| 顺时针旋转 | `↑` 或 `X` |
| 逆时针旋转 | `Z` |
| 软降 | `↓` |
| 直接落下 | `Space` |
| 暂停 / 继续 | `P` |
| 收起 | `Esc` |
| 游戏结束后重开 | `R` 或 `Enter` |

打开后焦点在棋盘上，按键只在棋盘获得焦点时生效；焦点移出面板、切换窗口或切到后台会自动收起，不会劫持聊天输入框。没有屏幕按钮，也不需要鼠标操作。

## 响应式实测

在真实 DSH Web 页面中用 Chromium 测得（DPR = 1，单位 px）：

| 视口 | 启动方块（可见 / 点击区） | 面板（宽 × 高） | 棋盘（宽 × 高） | 面板完全在视口内 |
| --- | --- | --- | --- | --- |
| 1440 × 900 | 16 × 16 / 32 × 32 | 300 × 559 | 252 × 504 | 是 |
| 1280 × 720 | 16 × 16 / 32 × 32 | 300 × 458.2 | 201.6 × 403.2 | 是 |
| 1024 × 768 | 16 × 16 / 32 × 32 | 300 × 485.1 | 215 × 430.1 | 是 |
| 390 × 844 | 16 × 16 / 32 × 32 | 300 × 475.6 | 219.4 × 438.9 | 是 |

桌面端右边距和底边距为 16px，移动端媒体查询下降为 12px。面板宽度受 `min(300px, calc(100vw - 24px))` 限制；棋盘高 `min(56dvh, 560px)`，窄屏为 `min(52dvh, 540px)`，宽高比固定为 1:2。启动方块本身只有 16 × 16，外层 32 × 32 是点击区域。

其他截图：

- [暂停状态](docs/paused-1440x900.png)
- [手机尺寸 390 × 844](docs/game-390x844.png)

## 开发

仓库没有构建步骤，源码即产物：

```text
src/index.js          Host 侧占位插件（bundle 需要在 profile 中有一个宿主条目）
src/client.js         Web 客户端：游戏引擎 + 透明 Canvas 棋盘 + 键盘面板
cordis.patch.yml      DSH bundle patch，插入 dsh-plugin-tetris 宿主条目
test/tetris.test.mjs  引擎与插件契约测试
docs/                 实机截图
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

启动方块和棋盘都挂在根级 overlay 层，固定定位在右下角。棋盘通过 Canvas 直接绘制网格和纯色块，容器保持透明；焦点离开后组件卸载，页面恢复成只有一个方块入口的状态。

## License

[MIT](LICENSE) © 2026 Liao Yuqiang
