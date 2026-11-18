import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker, { isOriginAllowed, parseAllowlist, resolveUpstream } from "../writer/oauth-proxy/src/index.js";

const DEVICE = "https://github.com/login/device/code";
const TOKEN = "https://github.com/login/oauth/access_token";
const USER = "https://api.github.com/user";
const REPO = "https://api.github.com/repos/fjh0805/fjh0805.github.io";

function sessionKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function proxyEnv(overrides = {}) {
    return {
        ALLOWED_ORIGINS: "https://fjh0805.github.io",
        CLIENT_ID: "Iv1.publicclient",
        SESSION_KEY: sessionKey(),
        GITHUB_OWNER: "fjh0805",
        GITHUB_REPO: "fjh0805.github.io",
        GITHUB_BRANCH: "master",
        ALLOWED_LOGIN: "fjh0805",
        ...overrides
    };
}

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" }
    });
}

function post(pathname, body, origin = "https://fjh0805.github.io") {
    return new Request(`https://proxy.example${pathname}`, {
        method: "POST",
        headers: {
            origin,
            accept: "application/json",
            "content-type": "application/json"
        },
        body: JSON.stringify(body ?? {})
    });
}

test("only the two device-flow paths are forwarded", () => {
    assert.equal(resolveUpstream("/login/device/code"), DEVICE);
    assert.equal(resolveUpstream("/login/oauth/access_token"), TOKEN);
    assert.equal(resolveUpstream("/repos/fjh0805/fjh0805.github.io/contents/_posts/a.md"), "");
});

test("allowlist is explicit", () => {
    const allow = parseAllowlist(" https://fjh0805.github.io, http://127.0.0.1:4000 ");
    assert.deepEqual(allow, ["https://fjh0805.github.io", "http://127.0.0.1:4000"]);
    assert.equal(isOriginAllowed("https://fjh0805.github.io", allow), true);
    assert.equal(isOriginAllowed("https://evil.example", allow), false);
    assert.equal(isOriginAllowed("", allow), false);
});

test("disallowed browser origin is not forwarded", async () => {
    let called = false;
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
        called = true;
        return jsonResponse({});
    };
    try {
        const response = await worker.fetch(post("/login/device/code", { client_secret: "nope" }, "https://evil.example"), proxyEnv());
        assert.equal(response.status, 403);
        assert.equal(called, false);
    } finally {
        globalThis.fetch = original;
    }
});

test("a plain text body still starts device flow without reading browser secrets", async () => {
    const original = globalThis.fetch;
    let forwarded = "";
    globalThis.fetch = async (url, init) => {
        assert.equal(String(url), DEVICE);
        forwarded = String(init.body);
        return jsonResponse({
            user_code: "ABCD-EFGH",
            device_code: "d".repeat(40),
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5
        });
    };
    try {
        const response = await worker.fetch(new Request("https://proxy.example/login/device/code", {
            method: "POST",
            headers: {
                origin: "https://fjh0805.github.io",
                "content-type": "text/plain;charset=UTF-8"
            },
            body: JSON.stringify({ client_secret: "must-not-forward", scope: "repo" })
        }), proxyEnv());
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("access-control-allow-origin"), "https://fjh0805.github.io");
        assert.equal(forwarded.includes("must-not-forward"), false);
        assert.match(forwarded, /scope=public_repo/);
        assert.equal((await response.json()).user_code, "ABCD-EFGH");
    } finally {
        globalThis.fetch = original;
    }
});

test("device flow ignores browser credentials and asks only for public_repo", async () => {
    const original = globalThis.fetch;
    let forwarded = "";
    globalThis.fetch = async (url, init) => {
        assert.equal(String(url), DEVICE);
        forwarded = String(init.body);
        return jsonResponse({
            user_code: "WDJB-MJHT",
            device_code: "a".repeat(40),
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5
        });
    };
    try {
        const response = await worker.fetch(post("/login/device/code", {
            client_id: "browser-supplied",
            client_secret: "must-not-forward",
            scope: "repo"
        }), proxyEnv());
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("access-control-allow-origin"), "https://fjh0805.github.io");
        assert.equal(forwarded.includes("must-not-forward"), false);
        assert.equal(forwarded.includes("browser-supplied"), false);
        assert.match(forwarded, /^client_id=Iv1\.publicclient&scope=public_repo$/);
        const body = await response.json();
        assert.equal(body.user_code, "WDJB-MJHT");
        assert.equal(body.client_secret, undefined);
    } finally {
        globalThis.fetch = original;
    }
});

test("a token for another account is dropped before it reaches the browser", async () => {
    const original = globalThis.fetch;
    const githubToken = "kept-away-from-the-browser";
    globalThis.fetch = async (url) => {
        if (String(url) === TOKEN) return jsonResponse({ access_token: githubToken, scope: "public_repo" });
        if (String(url) === USER) return jsonResponse({ login: "someone" });
        throw new Error(String(url));
    };
    try {
        const response = await worker.fetch(post("/login/oauth/access_token", { device_code: "a".repeat(40) }), proxyEnv());
        const text = await response.text();
        assert.equal(response.status, 403);
        assert.equal(text.includes(githubToken), false);
        assert.equal(text.includes("access_token"), false);
        assert.equal(JSON.parse(text).error, "not_authorized");
    } finally {
        globalThis.fetch = original;
    }
});

test("write permission without the owner login is still refused", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const href = String(url);
        if (href === TOKEN) return jsonResponse({ access_token: "collaborator-token" });
        if (href === USER) return jsonResponse({ login: "collaborator" });
        if (href === REPO) return jsonResponse({ permissions: { push: true, admin: true } });
        throw new Error(href);
    };
    try {
        const response = await worker.fetch(post("/login/oauth/access_token", { device_code: "b".repeat(40) }), proxyEnv());
        assert.equal(response.status, 403);
        assert.equal((await response.text()).includes("collaborator-token"), false);
    } finally {
        globalThis.fetch = original;
    }
});

test("the owner can publish only through checked repo paths", async () => {
    const original = globalThis.fetch;
    const githubToken = "owner-token-stays-on-worker";
    const puts = [];
    globalThis.fetch = async (url, init = {}) => {
        const href = String(url);
        if (href === TOKEN) return jsonResponse({ access_token: githubToken });
        if (href === USER) return jsonResponse({ login: "fjh0805" });
        if (href.startsWith(`${REPO}/contents/`)) {
            if (init.method === "PUT") {
                puts.push({ url: href, body: JSON.parse(init.body), authorization: init.headers.authorization });
                return jsonResponse({ commit: { html_url: "https://github.com/fjh0805/fjh0805.github.io/commit/abc" } });
            }
            return new Response("missing", { status: 404 });
        }
        if (href === REPO) return jsonResponse({ permissions: { push: true } });
        throw new Error(href);
    };
    try {
        const settings = proxyEnv();
        const login = await worker.fetch(post("/login/oauth/access_token", { device_code: "c".repeat(40) }), settings);
        const loginBody = await login.json();
        assert.equal(login.status, 200);
        assert.equal(loginBody.login, "fjh0805");
        assert.equal(typeof loginBody.session, "string");
        assert.equal(JSON.stringify(loginBody).includes(githubToken), false);
        assert.equal(loginBody.access_token, undefined);

        const who = await worker.fetch(post("/session/whoami", { session: loginBody.session }), settings);
        assert.equal((await who.json()).login, "fjh0805");

        const escaped = await worker.fetch(post("/repo/write", {
            session: loginBody.session,
            path: "_posts/../_config.yml",
            message: "不要写这个",
            content: "YQ=="
        }), settings);
        assert.equal(escaped.status, 400);
        assert.equal(puts.length, 0);

        const image = await worker.fetch(post("/repo/write", {
            session: loginBody.session,
            path: "img/posts/note/picture.jpg",
            message: "添加图片 img/posts/note/picture.jpg",
            content: "YQ=="
        }), settings);
        const written = await image.json();
        assert.equal(image.status, 200);
        assert.equal(written.commitUrl, "https://github.com/fjh0805/fjh0805.github.io/commit/abc");
        assert.equal(JSON.stringify(written).includes(githubToken), false);
        assert.equal(puts.length, 1);
        assert.equal(puts[0].url, `${REPO}/contents/img/posts/note/picture.jpg`);
        assert.equal(puts[0].body.branch, "master");
        assert.equal(puts[0].body.content, "YQ==");
        assert.equal(puts[0].authorization, `Bearer ${githubToken}`);

        const missing = await worker.fetch(post("/repo/read", {
            session: loginBody.session,
            path: "README.md"
        }), settings);
        assert.equal(missing.status, 400);
    } finally {
        globalThis.fetch = original;
    }
});

test("the owner login without repository write permission gets no session", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const href = String(url);
        if (href === TOKEN) return jsonResponse({ access_token: "owner-without-push" });
        if (href === USER) return jsonResponse({ login: "fjh0805" });
        if (href === REPO) return jsonResponse({ permissions: { pull: true, push: false } });
        throw new Error(href);
    };
    try {
        const response = await worker.fetch(post("/login/oauth/access_token", { device_code: "d".repeat(40) }), proxyEnv());
        const text = await response.text();
        assert.equal(response.status, 403);
        assert.equal(text.includes("owner-without-push"), false);
    } finally {
        globalThis.fetch = original;
    }
});

test("managed edits require the owner, a matching sha, and an allowed document", async () => {
    const original = globalThis.fetch;
    const githubToken = "owner-token-stays-on-worker";
    const profile = await readFile(new URL("../_data/profile.yml", import.meta.url), "utf8");
    const postMarkdown = await readFile(new URL("../_posts/2025-03-10-逃逸分析.md", import.meta.url), "utf8");
    const sha = "a".repeat(40);
    const puts = [];
    let loginName = "fjh0805";
    globalThis.fetch = async (url, init = {}) => {
        const href = String(url);
        if (href === TOKEN) return jsonResponse({ access_token: githubToken });
        if (href === USER) return jsonResponse({ login: loginName });
        if (href === REPO) return jsonResponse({ permissions: { push: true } });
        if (href.startsWith(`${REPO}/contents/`) && init.method === "PUT") {
            puts.push({ url: href, body: JSON.parse(init.body) });
            return jsonResponse({
                content: { sha: "b".repeat(40) },
                commit: { html_url: "https://github.com/fjh0805/fjh0805.github.io/commit/def" }
            });
        }
        if (href.startsWith(`${REPO}/contents/_data/profile.yml`)) {
            return jsonResponse({ type: "file", sha, content: Buffer.from(profile).toString("base64") });
        }
        if (href.startsWith(`${REPO}/contents/_posts/`)) {
            return jsonResponse({ type: "file", sha, content: Buffer.from(postMarkdown).toString("base64") });
        }
        if (href.startsWith(`${REPO}/contents/`)) return new Response("missing", { status: 404 });
        throw new Error(href);
    };
    try {
        const settings = proxyEnv();
        const anonymous = await worker.fetch(post("/repo/update", {
            kind: "profile",
            path: "_data/profile.yml",
            sha,
            profile: { name: "nope" }
        }), settings);
        assert.equal(anonymous.status, 401);
        assert.equal(puts.length, 0);

        const login = await worker.fetch(post("/login/oauth/access_token", { device_code: "e".repeat(40) }), settings);
        const session = (await login.json()).session;
        loginName = "someone";
        const stranger = await worker.fetch(post("/repo/read", { session, path: "_data/profile.yml" }), settings);
        assert.equal(stranger.status, 403);
        assert.equal(puts.length, 0);
        loginName = "fjh0805";

        const escaped = await worker.fetch(post("/repo/update", {
            session,
            kind: "profile",
            path: "_data/../_config.yml",
            sha,
            profile: { name: "JH" }
        }), settings);
        assert.equal(escaped.status, 400);

        const rawConfig = await worker.fetch(post("/repo/write", {
            session,
            path: "_config.yml",
            message: "不要改配置",
            content: Buffer.from("writer: {}\n").toString("base64")
        }), settings);
        assert.equal(rawConfig.status, 400);

        const rawPost = await worker.fetch(post("/repo/write", {
            session,
            path: "_posts/2025-03-10-逃逸分析.md",
            message: "不要整文件覆盖",
            content: Buffer.from("---\ntitle: x\n---\n\n正文\n").toString("base64")
        }), settings);
        assert.equal(rawPost.status, 400);
        assert.equal((await rawPost.json()).error, "use_update");

        const conflict = await worker.fetch(post("/repo/update", {
            session,
            kind: "post",
            path: "_posts/2025-03-10-逃逸分析.md",
            sha: "c".repeat(40),
            title: "新标题",
            date: "2025-03-10",
            tags: ["Golang"],
            body: "新正文"
        }), settings);
        assert.equal(conflict.status, 409);
        assert.equal(puts.length, 0);

        const saved = await worker.fetch(post("/repo/update", {
            session,
            kind: "post",
            path: "_posts/2025-03-10-逃逸分析.md",
            sha,
            title: "新标题",
            subtitle: "仍然保留未知字段",
            date: "2025-03-10",
            tags: ["Golang"],
            body: "新正文\n\n```go\nfunc main() {}\n```"
        }), settings);
        assert.equal(saved.status, 200);
        assert.equal(puts.length, 1);
        assert.equal(puts[0].body.sha, sha);
        assert.equal(puts[0].body.branch, "master");
        const written = Buffer.from(puts[0].body.content, "base64").toString("utf8");
        assert.match(written, /header-img: img\/post-bg-o\.jpg/);
        assert.match(written, /catalog: true/);
        assert.match(written, /title: "新标题"/);
        assert.match(written, /func main/);
        assert.equal(JSON.stringify(puts[0]).includes(githubToken), false);

        const badLink = await worker.fetch(post("/repo/update", {
            session,
            kind: "links",
            path: "_data/links.yml",
            links: [{ title: "坏", href: "javascript:alert(1)" }]
        }), settings);
        assert.equal(badLink.status, 400);
        assert.equal(puts.length, 1);
    } finally {
        globalThis.fetch = original;
    }
});

test("a portrait upload must be a new bitmap and cannot replace the current photo", async () => {
    const original = globalThis.fetch;
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
    const svg = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
    const puts = [];
    globalThis.fetch = async (url, init = {}) => {
        const href = String(url);
        if (href === TOKEN) return jsonResponse({ access_token: "owner-token-stays-on-worker" });
        if (href === USER) return jsonResponse({ login: "fjh0805" });
        if (href === REPO) return jsonResponse({ permissions: { push: true } });
        if (href.includes("/contents/img/portrait/alreadythere.png") && init.method !== "PUT") {
            return jsonResponse({ type: "file", sha: "a".repeat(40), content: "YQ==" });
        }
        if (href.startsWith(`${REPO}/contents/`) && init.method === "PUT") {
            puts.push(href);
            return jsonResponse({ commit: { html_url: "https://github.com/fjh0805/fjh0805.github.io/commit/abc" } });
        }
        if (href.startsWith(`${REPO}/contents/`)) return new Response("missing", { status: 404 });
        throw new Error(href);
    };
    try {
        const settings = proxyEnv();
        const denied = await worker.fetch(post("/repo/write", {
            path: "img/portrait/abc123def456.png",
            message: "更换个人照片",
            content: Buffer.from(png).toString("base64")
        }), settings);
        assert.equal(denied.status, 401);
        assert.equal(puts.length, 0);
        const login = await worker.fetch(post("/login/oauth/access_token", { device_code: "f".repeat(40) }), settings);
        const session = (await login.json()).session;
        const escaped = await worker.fetch(post("/repo/write", {
            session,
            path: "img/my-photo.jpg",
            message: "不要覆盖原图",
            content: Buffer.from(png).toString("base64")
        }), settings);
        assert.equal(escaped.status, 400);
        const traversal = await worker.fetch(post("/repo/write", {
            session,
            path: "img/portrait/../../my-photo.jpg",
            message: "不要穿越",
            content: Buffer.from(png).toString("base64")
        }), settings);
        assert.equal(traversal.status, 400);
        const fake = await worker.fetch(post("/repo/write", {
            session,
            path: "img/portrait/abc123def456.png",
            message: "更换个人照片",
            content: Buffer.from(svg).toString("base64")
        }), settings);
        assert.equal(fake.status, 400);
        assert.equal((await fake.json()).error, "bad_image");
        const created = await worker.fetch(post("/repo/write", {
            session,
            path: "img/portrait/abc123def456.png",
            message: "更换个人照片",
            content: Buffer.from(png).toString("base64")
        }), settings);
        assert.equal(created.status, 200);
        assert.equal(puts.length, 1);
        const overwrite = await worker.fetch(post("/repo/write", {
            session,
            path: "img/portrait/alreadythere.png",
            message: "不要覆盖",
            content: Buffer.from(png).toString("base64")
        }), settings);
        assert.equal(overwrite.status, 409);
        assert.equal(puts.length, 1);
    } finally {
        globalThis.fetch = original;
    }
});

test("an unconfigured proxy does not call GitHub", async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => {
        called = true;
        return jsonResponse({});
    };
    try {
        const response = await worker.fetch(post("/login/device/code", {}), proxyEnv({ CLIENT_ID: "" }));
        assert.equal(response.status, 503);
        assert.equal(called, false);
    } finally {
        globalThis.fetch = original;
    }
});

test("health and unknown routes stay small", async () => {
    const health = await worker.fetch(new Request("https://proxy.example/health"), {});
    assert.equal(health.status, 200);
    const missing = await worker.fetch(new Request("https://proxy.example/anything", { method: "POST" }), proxyEnv());
    assert.equal(missing.status, 404);
});
