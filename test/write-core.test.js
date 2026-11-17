import assert from "node:assert/strict";
import test from "node:test";
import {
    assertOwner,
    hasRepoWritePermission,
    base64ToUtf8,
    buildContentsRequest,
    buildPostDocument,
    escapeHtml,
    imagePath,
    isPublishablePath,
    parsePostDocument,
    parseTagInput,
    postPath,
    clipboardImageFiles,
    extensionForImage,
    imagesStillToUpload,
    publishFingerprint,
    publishingConfigured,
    safeCommitUrl,
    safeVerificationUri,
    writerGateMessage,
    renderMarkdown,
    replaceDraftImages,
    slugify,
    utf8ToBase64
} from "../js/write-core.js";

test("slug and post path stay inside _posts", () => {
    assert.equal(slugify("Escape Analysis!"), "escape-analysis");
    assert.equal(slugify("逃逸分析"), "");
    assert.equal(postPath("2026-11-16", "escape-analysis"), "_posts/2026-11-16-escape-analysis.md");
    assert.throws(() => postPath("2026/11/16", "ok"));
    assert.throws(() => postPath("2026-11-16", "../secret"));
});

test("image paths cannot leave the post folder", () => {
    assert.equal(imagePath("escape-analysis", "Photo 1.PNG"), "img/posts/escape-analysis/photo-1.png");
    assert.equal(isPublishablePath("img/posts/escape-analysis/photo-1.png"), true);
    assert.equal(isPublishablePath("img/posts/escape-analysis/../../_config.yml"), false);
    assert.equal(isPublishablePath("_posts/2025-03-10-逃逸分析.md"), true);
    assert.equal(isPublishablePath("_posts/../_config.yml"), false);
});

test("front matter round trip keeps the body and quotes", () => {
    const doc = buildPostDocument({
        title: '日志 "优化"',
        subtitle: "讨论",
        date: "2026-11-16",
        slug: "log-note",
        author: "JH",
        tags: parseTagInput("分布式，日志"),
        body: "第一段\n\n第二段"
    });
    const parsed = parsePostDocument(doc.markdown);
    assert.equal(parsed.title, '日志 "优化"');
    assert.equal(parsed.subtitle, "讨论");
    assert.deepEqual(parsed.tags, ["分布式", "日志"]);
    assert.equal(parsed.body, "第一段\n\n第二段\n");
    assert.equal(doc.path, "_posts/2026-11-16-log-note.md");
});

test("existing chinese filenames can be overwritten but not escaped", () => {
    const doc = buildPostDocument({
        title: "深入理解Golang逃逸分析",
        date: "2025-03-10",
        author: "JH",
        tags: ["Golang"],
        body: "正文",
        existingPath: "_posts/2025-03-10-逃逸分析.md"
    });
    assert.equal(doc.path, "_posts/2025-03-10-逃逸分析.md");
    assert.throws(() => buildPostDocument({
        title: "坏路径",
        date: "2025-03-10",
        body: "正文",
        existingPath: "_posts/../../README.md"
    }));
});

test("draft images must be replaced with site paths", () => {
    assert.equal(
        replaceDraftImages("看 ![图](draft:abc123)", { abc123: "/img/posts/note/a.jpg" }),
        "看 ![图](/img/posts/note/a.jpg)"
    );
    assert.throws(() => replaceDraftImages("![图](draft:abc123)", {}));
    assert.throws(() => buildPostDocument({
        title: "有图",
        date: "2026-11-16",
        slug: "with-image",
        body: "![图](draft:abc123)"
    }));
});

test("publish config and owner check reject anonymous writes", () => {
    assert.equal(publishingConfigured({
        owner: "fjh0805",
        repo: "fjh0805.github.io",
        branch: "master",
        oauthProxy: ""
    }), false);
    assert.equal(publishingConfigured({
        owner: "fjh0805",
        repo: "fjh0805.github.io",
        branch: "master",
        oauthProxy: "https://oauth.example.workers.dev"
    }), true);
    assert.equal(publishingConfigured({
        owner: "fjh0805",
        repo: "fjh0805.github.io",
        branch: "master",
        oauthProxy: "http://oauth.example.workers.dev"
    }), false);
    assert.throws(() => assertOwner("someone", "fjh0805"));
    assert.throws(() => assertOwner("", "fjh0805"));
    assert.doesNotThrow(() => assertOwner("FJH0805", "fjh0805"));
});

test("an empty writer config is not the same as a missing config file", () => {
    const empty = { owner: "fjh0805", repo: "fjh0805.github.io", branch: "master", oauthProxy: "" };
    assert.equal(writerGateMessage(empty, true), "写作还没有启用。");
    assert.equal(writerGateMessage(null, false), "写作配置没有加载。");
    assert.equal(publishingConfigured(empty), false);
});

test("image paste, upload resume, and duplicate publish are explicit", () => {
    const png = { type: "image/png" };
    const text = { type: "text/plain" };
    assert.equal(clipboardImageFiles(null).length, 0);
    assert.equal(clipboardImageFiles({ files: [text, png] }).length, 1);
    assert.equal(clipboardImageFiles({
        files: [],
        items: [{ kind: "file", getAsFile: () => png }]
    })[0], png);
    assert.equal(extensionForImage("image/jpeg"), "jpg");
    assert.equal(extensionForImage("image/heic"), "");
    const images = [{ id: "a", remotePath: "" }, { id: "b", remotePath: "/img/posts/note/b.jpg" }];
    assert.deepEqual(imagesStillToUpload(images).map((image) => image.id), ["a"]);
    const first = publishFingerprint({ title: "笔记", body: "![图](draft:a)", existingPath: "" });
    const same = publishFingerprint({ title: "笔记", body: "![图](draft:a)", existingPath: "" });
    const edited = publishFingerprint({ title: "笔记", body: "改过", existingPath: "" });
    assert.equal(first, same);
    assert.notEqual(first, edited);
    assert.equal(safeVerificationUri("https://evil.example/login/device"), "https://github.com/login/device");
    assert.equal(safeVerificationUri("https://github.com/login/device"), "https://github.com/login/device");
    assert.equal(safeCommitUrl("https://github.com/fjh0805/fjh0805.github.io/commit/abc"), "https://github.com/fjh0805/fjh0805.github.io/commit/abc");
    assert.equal(safeCommitUrl("https://example.com/commit/abc"), "");
});

test("repo write access comes from GitHub permissions, not a typed name", () => {
    assert.equal(hasRepoWritePermission({ permissions: { push: true, pull: true } }), true);
    assert.equal(hasRepoWritePermission({ permissions: { admin: true } }), true);
    assert.equal(hasRepoWritePermission({ permissions: { pull: true } }), false);
    assert.equal(hasRepoWritePermission({ full_name: "fjh0805/fjh0805.github.io" }), false);
    assert.equal(hasRepoWritePermission(null), false);
});

test("contents request carries the branch and optional sha", () => {
    assert.deepEqual(buildContentsRequest({
        message: "发布：标题",
        contentBase64: "YQ==",
        sha: "abc",
        branch: "master"
    }), {
        message: "发布：标题",
        content: "YQ==",
        branch: "master",
        sha: "abc"
    });
});

test("markdown preview escapes html and keeps safe links", () => {
    const html = renderMarkdown("你好 <script>alert(1)</script>\n\n[站内](/about/) [坏](javascript:alert(1))\n\n`code`");
    assert.equal(html.includes("<script>"), false);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /href="\/about\/"/);
    assert.equal(html.includes("javascript:"), false);
    assert.match(html, /<code>code<\/code>/);
});

test("utf-8 base64 round trip", () => {
    assert.equal(base64ToUtf8(utf8ToBase64("中文\n笔记")), "中文\n笔记");
});

test("escape helper is stable", () => {
    assert.equal(escapeHtml(`<>"'&`), "&lt;&gt;&quot;&#39;&amp;");
});
