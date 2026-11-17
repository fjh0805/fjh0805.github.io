# 写作页维护说明

这个文件在公开仓库里，给维护者看。它不是秘密存储。不要把 Client Secret、访问令牌、Client ID 或会话密钥写进来。

`/write/` 仍然是 GitHub Pages 上的公开地址。导航里不放入口、`noindex` 和 `robots.txt` 都不能把它变成私有页面。知道地址的人可以打开它。

未登录时页面只显示一句状态和一个登录按钮。编辑器、草稿标题、已发布文章列表和这份说明都不会出现。草稿存在这台浏览器的 IndexedDB 里。没有通过写作代理确认身份之前，页面不会打开这个数据库，也不会把旧草稿读进表单。

## 谁可以发布

只有 GitHub 账号 `fjh0805`，并且对 `fjh0805/fjh0805.github.io` 有 `push`、`maintain` 或 `admin` 权限，才能发布。这两件事都在写作代理里核对，每次读文章或写文件都会再核对一次。浏览器只保存代理发回的密封会话，看不到 GitHub 令牌，也不能直接拿令牌调用 GitHub API。

页面上的用户名判断挡不住伪造的接口响应。真正写入由代理转给 GitHub Contents API，仓库没有写权限时 GitHub 会拒绝。不要把仓库写权限授给别人。别人即使绕过这个页面，也只有在 GitHub 上有写权限时才能改仓库。

授权范围固定为 `public_repo`，由代理填上，页面不能改成更大的范围。不要启用会过期的用户令牌，刷新令牌需要 Client Secret，而这个代理故意不用 Client Secret。

## 配置

不要复用以前评论系统的 OAuth App。那个应用的 Client Secret 曾经出现在仓库历史里。新建一个只给写作用的应用。

1. 打开 https://github.com/settings/applications/new
   - Application name：`JH writing`
   - Homepage URL：`https://fjh0805.github.io`
   - Authorization callback URL：`https://fjh0805.github.io`
   - 勾选 Enable Device Flow
   - 不要把 Client Secret 交给任何人或写进仓库。设备码流程不使用它。
2. 部署 `writer/oauth-proxy`。普通变量已经写在 `wrangler.jsonc`。另外两个只放在 Worker 的 secret 里：
   - `CLIENT_ID`：新 OAuth App 的 Client ID
   - `SESSION_KEY`：32 字节随机数的 base64。用 `openssl rand -base64 32` 生成，通过 `wrangler secret put` 写入，不要写进文件。
3. 部署完成后，只把 Worker 的 `https://` 地址填进 `_config.yml` 的 `writer.oauth_proxy`。
4. 提交到 `master`，等 Pages 构建完成后，用 `fjh0805` 打开 `/write/`。

登录后默认按排版写 Markdown。标题、强调、列表和链接会直接显示成版式，图片显示在正文里。需要看原文时点「源码」。代码块、表格和 HTML 仍按原文保留，不会被换成另一种格式。图片先留在本机，发布时上传到 `img/posts/<英文文件名>/`，正文里的临时引用会换成站内路径。发布失败时，已经传上去的图片会记在草稿里，再点发布会从失败的地方继续。同一份没改过的内容不会重复提交。

退出只清掉这个标签页里的会话。GitHub 上的授权要在 GitHub → Settings → Applications 里撤销。发布后 Pages 还要重新构建。新建文章使用英文文件名；打开已有文章再发布会覆盖原文件，网址不变。
