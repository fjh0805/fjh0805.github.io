import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("current config no longer publishes a gitalk secret", async () => {
    const files = ["_config.yml", "_includes/comments.html", "about.html", "_layouts/post.html"];
    for (const file of files) {
        const text = await readFile(path.join(root, file), "utf8");
        assert.equal(/clientSecret|client_secret|gitalk/i.test(text), false, file);
    }
});

test("giscus uses the repository ids and a stable pathname", async () => {
    const config = await readFile(path.join(root, "_config.yml"), "utf8");
    const include = await readFile(path.join(root, "_includes/comments.html"), "utf8");
    assert.match(config, /repo_id:\s*R_kgDON9qC1w/);
    assert.match(config, /category_id:\s*DIC_kwDON9qC184CnNW7/);
    assert.match(config, /category:\s*Announcements/);
    assert.match(include, /data-mapping="pathname"/);
    assert.match(include, /data-strict="1"/);
    assert.match(include, /data-lang="zh-CN"/);
    assert.match(include, /评论还没接上/);
});
