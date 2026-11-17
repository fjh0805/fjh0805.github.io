import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { safeImageSrc } from "../writer/editor/images.js";

const sample = `# 标题

今天 **加粗**，还有 [站内](/about/)。

- 一项

![图片](draft:abc123)

\`\`\`go
func main() {
    println("中文")
}
\`\`\`

<table><tr><td>原样保留</td></tr></table>

| 列 | 值 |
| --- | --- |
| 甲 | 乙 |
`;

test("image urls used in the editor stay on safe schemes", () => {
    const lookup = (id) => (id === "abc123" ? "blob:local/abc" : "");
    assert.equal(safeImageSrc("draft:abc123", lookup), "blob:local/abc");
    assert.equal(safeImageSrc("draft:missing", lookup), "");
    assert.equal(safeImageSrc("/img/posts/note/a.jpg", lookup), "/img/posts/note/a.jpg");
    assert.equal(safeImageSrc("https://example.com/a.png", lookup), "https://example.com/a.png");
    assert.equal(safeImageSrc("javascript:alert(1)", lookup), "");
    assert.equal(safeImageSrc("data:text/html,hi", lookup), "");
    assert.equal(safeImageSrc("/../_config.yml", lookup), "");
    assert.equal(safeImageSrc("draft:abc123", () => "javascript:alert(1)"), "");
});

test("live markdown keeps code, chinese, and image syntax while rendering the picture", async () => {
    const window = new Window({ url: "https://fjh0805.github.io/write/" });
    for (const key of Object.getOwnPropertyNames(window)) {
        if (!/^[A-Z]/.test(key) || key in globalThis) continue;
        try {
            globalThis[key] = window[key];
        } catch {
            /* some host constructors are read-only */
        }
    }
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.getComputedStyle = window.getComputedStyle.bind(window);
    globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 16);
    const { createWriterEditor } = await import("../writer/editor/live.js");
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createWriterEditor(host, {
        value: sample,
        resolveImage: (id) => (id === "abc123" ? "blob:local/abc" : "")
    });
    assert.equal(editor.getMarkdown(), sample);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(editor.dom().textContent.includes("draft:abc123"), false);
    const image = editor.dom().querySelector(".live-image");
    assert.equal(image?.getAttribute("src"), "blob:local/abc");
    assert.equal(image?.getAttribute("alt"), "图片");
    assert.match(editor.getMarkdown(), /func main\(\)/);
    assert.match(editor.getMarkdown(), /原样保留/);
    assert.match(editor.getMarkdown(), /\| 甲 \| 乙 \|/);
    editor.setSourceMode(true);
    assert.equal(editor.getMarkdown(), sample);
    assert.match(editor.dom().textContent, /draft:abc123/);
    editor.setSourceMode(false);
    assert.equal(editor.getMarkdown(), sample);
    assert.equal(editor.dom().querySelector(".live-image")?.getAttribute("src"), "blob:local/abc");
    editor.insert("你好");
    assert.match(editor.getMarkdown(), /你好/);
    editor.destroy();
    await window.happyDOM.abort();
});
