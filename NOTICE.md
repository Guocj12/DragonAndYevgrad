# NOTICE / 第三方声明

本仓库自有的游戏代码（`src/`、`web/js/`、`web/css/`、`server.mjs`、`sim/`、`test/`、`docs/`）
以 MIT 许可证发布，见 [LICENSE](./LICENSE)。

## 未随仓库分发的内容

- `ref/AD/`：**反物质维度（Antimatter Dimensions）** 的完整源码，仅作为界面/科技树的参考实现
  在本地保留。它属于第三方项目，本仓库不包含、不分发这部分源码。
  需要复现时自行获取：`git clone https://github.com/IvarK/AntimatterDimensionsSourceCode ref/AD`
- `node_modules/`：依赖目录，由 `npm install` 复原。
- `tmp_*.mjs`、`test/screens/`、`*.log`：本地调试脚本、截图与运行日志。

## 前端「壳」的出处

`web/shell/` 下的样式表、字体、图标与图片（`stylesheets/styles.css`、`stylesheets/old-ui.css`、
`stylesheets/theme-*.css`、`images/` 等）沿用自反物质维度项目，用于复用其
`o-primary-btn` / `o-tab-btn` 视觉与网格布局；`web/shell/vue.min.js`、`web/shell/vis-network.min.*`
为其上游发行文件。相关许可如下。

### Antimatter Dimensions

```
MIT License

Copyright (c) 2017 IvarK

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Vue 2 / vis-network / vis-data / vis-util / keycharm / uuid

均为 MIT 许可，版权归各自作者所有；发行文件位于 `web/shell/vue.min.js`、
`web/shell/vis-network.min.js`、`web/shell/vis-network.min.css`，包信息见 `package.json`。

### 字体与图标

`web/shell/stylesheets/` 下的 `Barrio-Regular.ttf`、`BlobEmoji-Bold.ttf`、`MonospaceTypewriter*.ttf`、
`Runescape.ttf`、`fa-solid-900.ttf`（Font Awesome Free，SIL OFL 1.1 / CC BY 4.0 / MIT）等，
版权归各自字体与图标作者所有，随上游项目一同分发。
