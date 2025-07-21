# koishi-plugin-magnet-whatslinkinfo

<p align="center">
  <a href="https://www.npmjs.com/package/koishi-plugin-magnet-whatslinkinfo">
    <img src="https://img.shields.io/npm/v/koishi-plugin-magnet-whatslinkinfo.svg" alt="npm-version">
  </a>
  <a href="https://www.npmjs.com/package/koishi-plugin-magnet-whatslinkinfo">
    <img src="https://img.shields.io/npm/dm/koishi-plugin-magnet-whatslinkinfo.svg" alt="npm-downloads">
  </a>
  <a href="https://koishi.chat">
    <img src="https://img.shields.io/badge/koishi-%5E4.18.7-brightgreen.svg" alt="koishi-version">
  </a>
  <a href="https://github.com/WhiteBr1ck/koishi-plugin-magnet-whatslinkinfo/blob/main/LICENSE">
    <img src="https://img.shields.io/npm/l/koishi-plugin-magnet-whatslinkinfo.svg" alt="license">
  </a>
</p>

一个为 [Koishi](https://koishi.chat/) 设计的插件，它能自动识别聊天中的磁力链接，并调用 [whatslink.info](https://whatslink.info/) 提供的 API 来生成包含资源详情和截图的预览消息。

## ✨ 功能特性

- **自动识别**: 无需任何指令，在聊天中发送磁力链接即可自动触发。
- **信息丰富**: 显示资源的名称、总大小、文件数量和内容类型。
- **截图预览**: 可配置是否显示由 API 提供的资源截图。
- **智能发送**:
  - 在 QQ/OneBot 平台下，可配置使用**合并转发**的形式发送，避免长消息刷屏。
  - 自动引用原始消息进行回复，交互清晰。
  - 发送“解析中”的提示后**自动撤回**，保持聊天界面整洁。

## 💿 安装

在 Koishi 插件市场搜索 `magnet-whatslinkinfo` 并安装。

或通过命令行：

```bash
# 在你的 Koishi 项目根目录下执行
npm i koishi-plugin-magnet-whatslinkinfo
```

## 📖 使用方法

在任意聊天中发送包含磁力链接的消息即可。插件会自动处理并回复预览信息。

## ⚙️ 配置项

你可以在 Koishi 的插件配置页面找到本插件的设置项。

| 配置项         | 类型      | 默认值                               | 描述                                                                                               |
| -------------- | --------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `apiEndpoint`  | `string`  | `https://whatslink.info/api/v1/link` | `whatslink.info` 的 API 请求地址。通常无需修改。                                                   |
| `timeout`      | `number`  | `10000`                              | 请求 API 的超时时间（毫秒）。                                                                      |
| `useForward`   | `boolean` | `false`                              | 在 QQ/OneBot 平台使用合并转发的形式发送结果。                                                      |
| `showScreenshot` | `boolean` | `true`                               | 是否在结果中显示资源截图。                                                                         |
| `debugMode`    | `boolean` | `false`                              | 是否开启调试模式。                                                                                  |

## 📝 许可

[MIT License](https://github.com/WhiteBr1ck/koishi-plugin-magnet-whatslinkinfo/blob/main/LICENSE) © 2025 WhiteBr1ck
