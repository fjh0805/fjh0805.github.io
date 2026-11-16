# 写作页维护说明

这个文件在公开仓库里，给维护者看。它不是秘密存储。不要把 Client Secret、访问令牌或密码写进来。

`/write/` 仍然是 GitHub Pages 上的公开地址。导航里不放入口、`noindex` 和 `robots.txt` 都不能把它变成私有页面。知道地址的人可以打开它。

未登录时页面只显示一句状态和一个登录按钮。编辑器、草稿标题、已发布文章列表和这份配置说明都不会出现。草稿存在这台浏览器的 IndexedDB 里；未通过 GitHub 权限检查之前，页面不会打开这个数据库，也不会把旧草稿读进表单。

登录后，页面用令牌请求 `GET /repos/{owner}/{repo}`。只有响应里的 `permissions.push`、`maintain` 或 `admin` 为真，才显示编辑器。用户名写在前端并不能授权。真正写入仍由 GitHub Contents API 决定，没有仓库写权限的令牌会被拒绝。令牌只留在当前标签页。

## 配置

1. 在 GitHub → Settings → Developer settings → OAuth Apps 新建 OAuth App。
   - Homepage URL：`https://fjh0805.github.io`
   - Authorization callback URL：`https://fjh0805.github.io`
   - 勾选 Enable Device Flow
   - 只把 Client ID 写进 `_config.yml`。不要提交 Client Secret。
2. 部署 `writer/oauth-proxy`。它只转发 GitHub 的两个设备码地址并补上 CORS 头，自己不保存密钥。`ALLOWED_ORIGINS` 包含 `https://fjh0805.github.io`。
3. 在 `_config.yml` 填入：

   ```yaml
   writer:
     client_id: "OAuth App 的 Client ID"
     oauth_proxy: "https://你的worker地址"
   ```

4. 提交到 `master`，等 Pages 构建完成后打开 `/write/`，用有仓库写权限的 GitHub 账号登录。

授权范围是 `repo`，因为创建或更新文件的接口要求它。可以在 GitHub → Settings → Applications 里撤销。发布后 Pages 还要重新构建。新建文章使用英文文件名；打开已有文章再发布会覆盖原文件，网址不变。
