import assert from "node:assert/strict";
import test from "node:test";
import worker, { isOriginAllowed, parseAllowlist, resolveUpstream } from "../writer/oauth-proxy/src/index.js";

test("only the two device-flow paths are forwarded", () => {
    assert.equal(resolveUpstream("/login/device/code"), "https://github.com/login/device/code");
    assert.equal(resolveUpstream("/login/oauth/access_token"), "https://github.com/login/oauth/access_token");
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
        return new Response("no");
    };
    try {
        const response = await worker.fetch(new Request("https://proxy.example/login/device/code", {
            method: "POST",
            headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
            body: "client_id=abc"
        }), { ALLOWED_ORIGINS: "https://fjh0805.github.io" });
        assert.equal(response.status, 403);
        assert.equal(called, false);
    } finally {
        globalThis.fetch = original;
    }
});

test("allowed device request is forwarded without logging the body", async () => {
    const original = globalThis.fetch;
    let forwarded = null;
    globalThis.fetch = async (url, init) => {
        forwarded = { url, body: new TextDecoder().decode(init.body) };
        return new Response(JSON.stringify({ user_code: "ABCD-1234" }), {
            status: 200,
            headers: { "content-type": "application/json" }
        });
    };
    try {
        const response = await worker.fetch(new Request("https://proxy.example/login/device/code", {
            method: "POST",
            headers: {
                origin: "https://fjh0805.github.io",
                accept: "application/json",
                "content-type": "application/x-www-form-urlencoded"
            },
            body: "client_id=public&scope=repo"
        }), { ALLOWED_ORIGINS: "https://fjh0805.github.io" });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("access-control-allow-origin"), "https://fjh0805.github.io");
        assert.equal(forwarded.url, "https://github.com/login/device/code");
        assert.equal(forwarded.body, "client_id=public&scope=repo");
        assert.equal(await response.json().then((data) => data.user_code), "ABCD-1234");
    } finally {
        globalThis.fetch = original;
    }
});

test("health and unknown routes stay small", async () => {
    const health = await worker.fetch(new Request("https://proxy.example/health"), {});
    assert.equal(health.status, 200);
    const missing = await worker.fetch(new Request("https://proxy.example/anything", { method: "POST" }), {
        ALLOWED_ORIGINS: "https://fjh0805.github.io"
    });
    assert.equal(missing.status, 404);
});
