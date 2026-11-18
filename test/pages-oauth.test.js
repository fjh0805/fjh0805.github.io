import assert from "node:assert/strict";
import test from "node:test";
import pagesWorker, { pagesHandles, withPagesDefaults } from "../writer/oauth-proxy/pages/entry.js";

test("pages defaults stay on this site and do not invent a session key", () => {
    const env = withPagesDefaults({ SESSION_KEY: "from-deploy" });
    assert.equal(env.ALLOWED_ORIGINS, "https://fjh0805.github.io");
    assert.equal(env.GITHUB_OWNER, "fjh0805");
    assert.equal(env.GITHUB_REPO, "fjh0805.github.io");
    assert.equal(env.GITHUB_BRANCH, "master");
    assert.equal(env.ALLOWED_LOGIN, "fjh0805");
    assert.equal(env.CLIENT_ID, "Ov23liCuomd3yYskOX3l");
    assert.equal(env.SESSION_KEY, "from-deploy");
    const overridden = withPagesDefaults({ ALLOWED_ORIGINS: "https://fjh0805.github.io", CLIENT_ID: "from-env" });
    assert.equal(overridden.CLIENT_ID, "from-env");
});

test("pages serves api routes itself and other paths through assets", async () => {
    assert.equal(pagesHandles(new Request("https://pages.example/health")), true);
    assert.equal(pagesHandles(new Request("https://pages.example/login/device/code", { method: "POST" })), true);
    assert.equal(pagesHandles(new Request("https://pages.example/")), false);

    let assetsCalled = false;
    const assets = {
        async fetch() {
            assetsCalled = true;
            return new Response("asset", { status: 200 });
        }
    };
    const page = await pagesWorker.fetch(new Request("https://pages.example/"), { ASSETS: assets });
    assert.equal(page.status, 200);
    assert.equal(await page.text(), "asset");
    assert.equal(assetsCalled, true);

    const original = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("health must not call upstream");
    };
    try {
        const health = await pagesWorker.fetch(new Request("https://pages.example/health"), { ASSETS: assets });
        assert.equal(health.status, 200);
        assert.equal((await health.json()).ok, true);
    } finally {
        globalThis.fetch = original;
    }
});

test("pages login still rejects a foreign origin", async () => {
    let called = false;
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
        called = true;
        return new Response("no");
    };
    try {
        const response = await pagesWorker.fetch(new Request("https://pages.example/login/device/code", {
            method: "POST",
            headers: { origin: "https://evil.example", "content-type": "text/plain;charset=UTF-8" },
            body: "{}"
        }), { SESSION_KEY: "c2Vzc2lvbi1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=" });
        assert.equal(response.status, 403);
        assert.equal(called, false);
        assert.equal(response.headers.get("access-control-allow-origin"), null);
    } finally {
        globalThis.fetch = original;
    }
});
