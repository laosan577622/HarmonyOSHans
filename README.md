# HarmonyOSHans

HarmonyOS Sans SC 的 WOFF2 字体切片，可部署到 CDN，为网页提供按字符加载的中文字体。

字体包含 300、400、500、700 四个字重，每个字重分为 96 个切片。每个切片均配置 `unicode-range` 与 `font-display: swap`。

`loader.js` 会先扫描页面真正使用的字体和字重，只加载对应的 `common-300.css`、`common-400.css`、`common-500.css` 或 `common-700.css`。之后页面动态插入文本、切换 class 或调整内联字重时，会实时补载新出现的必要字重，不会预先加载全部四个字重。

长页面可设置 `data-scan="viewport"`：首次只加载首屏可见文字所需字重，滚动到下方内容时通过 `IntersectionObserver` 自动补载相应字重。

## jsDelivr 使用

### 懒加载与动态内容自动加载

推荐通过 `loader.js` 接入。它会等待页面完成首屏加载，再在浏览器空闲时加载字体 CSS；初次加载后会扫描当前文本，并监听后续动态插入或修改的文本，自动请求缺失的字体切片。

```html
<script
  defer
  src="https://cdn.jsdelivr.net/gh/laosan577622/HarmonyOSHans@v1.2.0/loader.js"
></script>

<style>
  body {
    font-family: "HarmonyOSHans-Regular", "PingFang SC", sans-serif;
  }
</style>
```

加载器默认配置：

- 字体 CSS：根据页面实际字重自动选择同目录下的 `common-<字重>.css`
- 字体名称：`HarmonyOSHans-Regular`
- 字重：300、400、500、700
- 监听范围：`body`
- 加载时机：`window.load` 后的浏览器空闲阶段

可通过 `data-*` 属性覆盖：

```html
<script
  defer
  src="https://cdn.jsdelivr.net/gh/laosan577622/HarmonyOSHans@v1.2.0/loader.js"
  data-root="#app"
  data-scan="viewport"
  data-weights="400,500,700"
  data-idle-timeout="800"
></script>
```

如需手动控制加载时机：

```html
<script
  defer
  data-auto="false"
  src="https://cdn.jsdelivr.net/gh/laosan577622/HarmonyOSHans@v1.2.0/loader.js"
></script>
<script>
  window.addEventListener("DOMContentLoaded", function () {
    window.HarmonyOSHans.load();
  });
</script>
```

动态内容通常会被 `MutationObserver` 自动识别；在批量更新结束后，也可以主动扫描指定节点：

```js
window.HarmonyOSHans.scan(document.querySelector("#article"));
```

### 仅使用原生字符分片加载

如果无需延迟加载 CSS 和动态内容预加载，可直接引入：

```html
<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/gh/laosan577622/HarmonyOSHans@v1.2.0/common.css"
>
```

浏览器仍会根据 `unicode-range` 只下载页面实际字符命中的 WOFF2 分片。

## 自行部署

将 `common.css`、`common-300.css`、`common-400.css`、`common-500.css`、`common-700.css`、`loader.js` 和 `font/` 保持当前相对目录结构部署到同一目录。加载器会根据自身脚本地址自动解析按字重拆分的 CSS，字体 CSS 再通过相对路径读取 `font/` 中的切片。

修改 `common.css` 后可运行 `node scripts/split-css.mjs` 重新生成四个字重入口。

## 开源许可

本项目沿用原仓库的 MIT License，并保留原作者版权与提交历史。
