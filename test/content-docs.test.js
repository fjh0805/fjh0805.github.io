import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
    applyLinksEdit,
    applyPostEdit,
    applyProfileEdit,
    parseLinks,
    parseProfile,
    safePublicUrl
} from "../js/content-docs.js";

const root = path.resolve(import.meta.dirname, "..");

test("profile edits keep the portrait and unknown fields", async () => {
    const original = await readFile(path.join(root, "_data/profile.yml"), "utf8");
    const parsed = parseProfile(original);
    assert.match(parsed.zh.lead, /深圳大学/);
    assert.equal(parsed.zh.paragraphs.length, 2);
    assert.equal(parsed.en.links[3].title, "Shenzhen University");
    const next = applyProfileEdit(`${original}custom_note: "keep me"\n`, {
        ...parsed,
        name: 'JH" writer: evil',
        portrait: "/img/other.jpg",
        zh: { ...parsed.zh, lead: parsed.zh.lead }
    });
    assert.match(next, /^portrait: \/img\/my-photo\.jpg$/m);
    assert.match(next, /^portrait_width: 2166$/m);
    assert.match(next, /^portrait_alt: JH 的照片$/m);
    assert.match(next, /^custom_note: "keep me"$/m);
    assert.match(next, /^name: "JH\\" writer: evil"$/m);
    assert.doesNotMatch(next, /^writer:/m);
    assert.equal(parseProfile(next).zh.lead, parsed.zh.lead);
    assert.equal(parseProfile(next).en.stack[0].value, "Golang, Java, Python");
    assert.throws(() => applyProfileEdit(original, { ...parsed, name: "JH\nwriter: evil" }));
    assert.throws(() => applyProfileEdit(original, { ...parsed, github: "javascript:alert(1)" }));
    const replaced = applyProfileEdit(original, {
        ...parsed,
        portrait: { path: "/img/portrait/abc123def456.png", width: 1200, height: 1600 }
    });
    assert.match(replaced, /^portrait: "\/img\/portrait\/abc123def456.png"$/m);
    assert.match(replaced, /^portrait_width: 1200$/m);
    assert.match(replaced, /^portrait_height: 1600$/m);
    assert.match(replaced, /^portrait_alt: JH 的照片$/m);
    assert.doesNotMatch(replaced, /my-photo\.jpg/);
    assert.throws(() => applyProfileEdit(original, {
        ...parsed,
        portrait: { path: "/img/my-photo.jpg", width: 100, height: 100 }
    }));
    assert.throws(() => applyProfileEdit(original, {
        ...parsed,
        portrait: { path: "/img/portrait/../../my-photo.jpg", width: 100, height: 100 }
    }));
});

test("homepage links reject unsafe urls", async () => {
    const original = await readFile(path.join(root, "_data/links.yml"), "utf8");
    const links = parseLinks(original);
    assert.equal(links[0].href, "https://github.com/fjh0805");
    assert.equal(links.length, 5);
    const next = applyLinksEdit(links);
    assert.equal(parseLinks(next)[2].title, "LeetCode");
    assert.throws(() => applyLinksEdit([{ title: "坏", href: "javascript:alert(1)" }]));
    assert.throws(() => applyLinksEdit([{ title: "坏", href: "http://example.com" }]));
    assert.equal(safePublicUrl("mailto:fujiahao0805@gmail.com"), "mailto:fujiahao0805@gmail.com");
    assert.equal(safePublicUrl("https://user:pass@github.com/fjh0805"), "");
});

test("an old post keeps unknown front matter and its body code", async () => {
    const original = await readFile(path.join(root, "_posts/2025-03-10-逃逸分析.md"), "utf8");
    const next = applyPostEdit(original, {
        title: "深入理解Golang逃逸分析",
        subtitle: "从题目想到的",
        date: "2025-03-10",
        tags: ["Golang", "逃逸分析"],
        body: "新的开头\n\n```go\nfunc main() {}\n```\n"
    });
    assert.match(next, /header-img: img\/post-bg-o\.jpg/);
    assert.match(next, /catalog: true/);
    assert.match(next, /layout:\s+post/);
    assert.match(next, /author:\s+JH/);
    assert.match(next, /title: "深入理解Golang逃逸分析"/);
    assert.match(next, /```go\nfunc main\(\) \{\}\n```/);
    assert.doesNotMatch(next, /问题的起源/);
    assert.throws(() => applyPostEdit(original, {
        title: "标题\nbad: yes",
        date: "2025-03-10",
        tags: [],
        body: "正文"
    }));
});
