var GITALK_GUARD_MS = 12000;

export function gitalkRetryHref(href) {
    var url = new URL(href, "https://fjh0805.github.io");
    url.searchParams.delete("code");
    return url.pathname + url.search + url.hash;
}

export function gitalkGuardDecision(state, elapsed, limit) {
    if (!state.loading) return "";
    if (state.errorText) return "error";
    if (elapsed >= limit) return "timeout";
    return "";
}

export function gitalkGuardMessage(reason) {
    if (reason === "script") {
        return "评论组件没有加载完成。可以重试；如果仍停在这里，多半是评论脚本被网络拦住了。";
    }
    return "评论停在「加载中」。从 GitHub 回到页面后，Gitalk 1.8.0 会向默认公共代理换取登录状态。这个请求没有超时，失败时也不会关掉加载动画。重试会去掉地址里的 code，回到未登录的评论页。要真正登录并初始化评论，需要在 _config.yml 的 gitalk.proxy 填入你自己的 HTTPS 代理，不要把密钥写进网页。";
}

function mountGitalkGuard(root, options) {
    if (!root || root.dataset.guardReady === "1") return;
    root.dataset.guardReady = "1";
    var limit = options && options.limitMs || GITALK_GUARD_MS;
    var started = Date.now();
    var shown = false;

    function state() {
        var error = root.querySelector(".gt-error");
        return {
            loading: Boolean(root.querySelector(".gt-initing")),
            ready: Boolean(root.querySelector(".gt-container")),
            errorText: error ? error.textContent.trim() : ""
        };
    }

    function show(reason) {
        if (shown) return;
        shown = true;
        root.dataset.stuck = reason;
        var note = document.createElement("div");
        note.className = "gitalk-guard";
        note.setAttribute("role", "alert");
        var text = document.createElement("p");
        text.textContent = gitalkGuardMessage(reason);
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = "重试";
        button.addEventListener("click", function () {
            window.location.assign(gitalkRetryHref(window.location.href));
        });
        note.append(text, button);
        root.insertAdjacentElement("afterend", note);
    }

    function tick() {
        var current = state();
        var decision = gitalkGuardDecision(current, Date.now() - started, limit);
        if (!decision && !current.ready && Date.now() - started >= limit) decision = "script";
        if (decision) show(decision);
    }

    var observer = new MutationObserver(tick);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    window.setTimeout(function () {
        tick();
        if (shown) observer.disconnect();
    }, limit);
    tick();
}

if (typeof document !== "undefined") {
    var gitalkRoot = document.querySelector("#gitalk-container");
    if (gitalkRoot) {
        mountGitalkGuard(gitalkRoot, {
            limitMs: window.__GITALK_GUARD_MS || GITALK_GUARD_MS
        });
    }
}
