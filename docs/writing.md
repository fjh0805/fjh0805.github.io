# 手机写作

公开网站仍然是 Jekyll 静态站。手机上的写作页可以写 Markdown、插入图片、把草稿留在本机，并下载 `.md`。这些不需要新服务。

真正发布到主页，是登录 GitHub 后，由浏览器调用 GitHub Contents API，把文件提交到 `master`。GitHub Pages 再按原来的方式构建。静态页面不能安全地保存写仓库的密钥，所以这里不把令牌放进仓库或前端包。

## 需要你自己完成的配置

1. 在 GitHub → Settings → Developer settings → OAuth Apps 新建 OAuth App。
   - Homepage URL：`https://fjh0805.github.io`
   - Authorization callback URL：`https://fjh0805.github.io`（设备码流程不会用到回调）
   - 勾选 Enable Device Flow
   - 只复制 Client ID。不要把 Client Secret 提交到仓库。
2. 部署 `writer/oauth-proxy` 到你自己的 Cloudflare Workers 账号：

   ```bash
   cd writer/oauth-proxy
   npx wrangler deploy
   ```

   Worker 只把下面两个地址转发给 GitHub，并补上浏览器需要的 CORS 头：

   - `POST /login/device/code`
   - `POST /login/oauth/access_token`

   它不保存令牌，也没有 Client Secret。`wrangler.jsonc` 里的 `ALLOWED_ORIGINS` 需要包含 `https://fjh0805.github.io`。
3. 把下面两项写进 `_config.yml` 后提交到 `master`，等 Pages 构建完成：

   ```yaml
   writer:
     client_id: "你的 OAuth App Client ID"
     oauth_proxy: "https://你的worker地址"
   ```

4. 手机打开 `https://fjh0805.github.io/write/`，用 GitHub 登录，在 `https://github.com/login/device` 输入验证码。只有账号 `fjh0805` 能发布。

授权范围是 `repo`，因为 GitHub 创建或更新文件的接口要求这个 scope。令牌只留在当前浏览器标签页。可以在 GitHub → Settings → Applications 里撤销。

发布成功后，Pages 还要重新构建，主页不会立刻变化。这个流程在 OAuth App 和 Worker 配好之前不能端到端验证，页面也不会假装已经能发布。

已有文章如果从写作页打开再发布，会覆盖原来的文件，网址不变。新建文章使用英文文件名，避免再生成难维护的地址。
