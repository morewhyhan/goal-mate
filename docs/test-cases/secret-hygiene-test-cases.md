# Secret Hygiene Test Cases

## 1. 目的

验证仓库中没有提交真实 API Key、Bot Token、Bearer Token 形状的密钥。

这个检查不读取本地 `.env`，不访问网络，不验证密钥是否有效，只做仓库静态扫描。

## 2. 自动化入口

```bash
pnpm verify:secrets
```

## 3. 检查项

| ID | 检查 | 期望 |
| --- | --- | --- |
| SECRET-SCAN-MODEL | 模型 API Key | 仓库文本中不存在 `sk-` 开头的长 token |
| SECRET-SCAN-BOT | Bot Token | 仓库文本中不存在 `数字:长 token` 形状的 bot token |
| SECRET-SCAN-BEARER | Bearer Token | 仓库文本中不存在长 `Bearer` token |
| SECRET-ENV-EXAMPLE | env 样例 | `.env.example` 使用 `replace_with_*` 占位符，不使用 token-shaped placeholder |

## 4. 不覆盖

- 不扫描本地未提交 `.env`。
- 不验证服务器 `.env`。
- 不判断密钥是否真实可用。
- 不代替 Settings / export 的 API Key 脱敏测试。
