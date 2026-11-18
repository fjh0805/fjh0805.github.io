# 写作页维护说明

这个文件在公开仓库里，给维护者看。它不是秘密存储。不要把 Client Secret、访问令牌、Client ID 或会话密钥写进来。

`/write/` 仍然是 GitHub Pages 上的公开地址。主导航里有「写作」，桌面和手机菜单都能点到。`noindex` 和 `robots.txt` 不能把这个地址变成私有页面。未登录的人也能打开它，但发布仍要通过 GitHub 写权限。

登录之后可以改三类内容：已有文章、`_data/profile.yml` 里的简介（首页和关于页共用），以及 `_data/links.yml` 里的主页链接。文章页、首页和关于页上的「修改」只在这台浏览器已经有密封会话时出现。会话不是发布凭证。代理每次读取和保存都会再核对 GitHub 账号是 `fjh0805`，并且对这个仓库有写权限。

文章保存走 `/repo/update`。代理按打开时拿到的 Git SHA 写回，SHA 对不上就拒绝，不会拿最新版本覆盖。原文 front matter 里没有在编辑器里出现的字段会原样留下，文件路径不变。简介和链接只接受规定字段，由代理重新生成 YAML；照片、导航、`_config.yml` 和 OAuth 设置不能从页面改。没有删除文章的操作。保存前页面会给出预览，要点保存才会写入。

这些接口在写作代理里。当前线上的 Pages 代理还没有 `/repo/update` 时，页面不能完成保存。部署新的 `_worker.js` 时保留原来的 `SESSION_KEY` 和 `CLIENT_ID`。

未登录时页面只显示一句状态和一个登录按钮。编辑器、草稿标题、已发布文章列表和这份说明都不会出现。草稿存在这台浏览器的 IndexedDB 里。没有通过写作代理确认身份之前，页面不会打开这个数据库，也不会把旧草稿读进表单。

## 谁可以发布

只有 GitHub 账号 `fjh0805`，并且对 `fjh0805/fjh0805.github.io` 有 `push`、`maintain` 或 `admin` 权限，才能发布。这两件事都在写作代理里核对，每次读文章或写文件都会再核对一次。浏览器只保存代理发回的密封会话，看不到 GitHub 令牌，也不能直接拿令牌调用 GitHub API。

页面上的用户名判断挡不住伪造的接口响应。真正写入由代理转给 GitHub Contents API，仓库没有写权限时 GitHub 会拒绝。不要把仓库写权限授给别人。别人即使绕过这个页面，也只有在 GitHub 上有写权限时才能改仓库。

浏览器只用 `text/plain` 把请求发给代理，避免 `application/json` 触发的预检把连不上的情况显示成没有状态码的 `Failed to fetch`。来源仍必须是 `https://fjh0805.github.io`。授权范围固定为 `public_repo`，由代理填上，页面不能改成更大的范围。代理不申请 `offline_access`。OAuth App 的 Device Flow 默认只返回长期访问令牌，响应里没有 `expires_in` 和 `refresh_token`。如果在 OAuth App 里打开了过期用户令牌，访问令牌会在 8 小时后失效，并附带刷新令牌。这个代理只密封访问令牌，不保存、不刷新那个刷新令牌，也不因此引入 Client Secret。令牌过期后 GitHub 返回 401，写作会要求重新登录。

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
3. 写作代理地址是 `https://jh-write-oauth.pages.dev`，已经写在 `_config.yml` 的 `writer.oauth_proxy`。原来的 Worker `https://jh-write-oauth.fujiahao0791.workers.dev` 留着，不在这里切换。不要把 Client ID、Client Secret 或会话密钥写进这个文件。
4. 提交到 `master`，等 Pages 构建完成后，用 `fjh0805` 打开 `/write/`。

登录后默认按排版写 Markdown。标题、强调、列表和链接会直接显示成版式，图片显示在正文里。需要看原文时点「源码」。代码块、表格和 HTML 仍按原文保留，不会被换成另一种格式。图片先留在本机，发布时上传到 `img/posts/<英文文件名>/`，正文里的临时引用会换成站内路径。发布失败时，已经传上去的图片会记在草稿里，再点发布会从失败的地方继续。同一份没改过的内容不会重复提交。

退出只清掉这个标签页里的会话。GitHub 上的授权要在 GitHub → Settings → Applications 里撤销。发布后 Pages 还要重新构建。新建文章使用英文文件名；打开已有文章再发布会覆盖原文件，网址不变。
