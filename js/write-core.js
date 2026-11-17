import {
    assertOwner,
    clipboardImageFiles,
    extensionForImage,
    hasRepoWritePermission,
    imagesStillToUpload,
    isExistingPostPath,
    isPublishablePath,
    publishFingerprint,
    safeCommitUrl,
    safeVerificationUri
} from "./write-policy.js";

export {
    assertOwner,
    clipboardImageFiles,
    extensionForImage,
    hasRepoWritePermission,
    imagesStillToUpload,
    isExistingPostPath,
    isPublishablePath,
    publishFingerprint,
    safeCommitUrl,
    safeVerificationUri
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

export function slugify(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
        .replace(/-+$/g, "");
}

export function defaultPostSlug(title, seed) {
    const fromTitle = slugify(title);
    if (fromTitle) return fromTitle;
    const clean = String(seed ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4);
    return `note-${clean || "draft"}`;
}

export function parseTagInput(value) {
    return String(value ?? "")
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8);
}

export function yamlQuote(value) {
    return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function postPath(date, slug) {
    if (!DATE.test(date)) throw new Error("日期需要是 YYYY-MM-DD");
    if (!SLUG.test(slug) || slug.length > 60) throw new Error("新文章的文件名只允许小写英文、数字和连字符");
    return `_posts/${date}-${slug}.md`;
}

export function imagePath(slug, filename) {
    if (!SLUG.test(slug)) throw new Error("请先填写英文文件名，再添加图片");
    const safe = String(filename ?? "")
        .toLowerCase()
        .replace(/\.[^.]+$/, (ext) => ext)
        .replace(/[^a-z0-9.]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/\.(jpeg)$/g, ".jpg");
    const normalized = safe.replace(/\.jpeg$/, ".jpg");
    if (!/^[a-z0-9][a-z0-9.-]*\.(png|jpe?g|gif|webp)$/.test(normalized) || normalized.includes("..")) {
        throw new Error("图片文件名不合法");
    }
    return `img/posts/${slug}/${normalized}`;
}

export function splitPostPath(path) {
    const matched = String(path ?? "").match(/^_posts\/(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
    if (!matched || path.includes("..")) return null;
    return { date: matched[1], slug: matched[2] };
}

function unquote(value) {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return value;
}

export function parsePostDocument(markdown) {
    const text = String(markdown ?? "").replace(/\r\n/g, "\n");
    const empty = { title: "", subtitle: "", date: "", author: "", tags: [], body: text.trim() };
    if (!text.startsWith("---\n")) return empty;
    const end = text.indexOf("\n---\n", 4);
    if (end < 0) return empty;
    const frontMatter = text.slice(4, end);
    const body = text.slice(end + 5).replace(/^\n/, "");
    const tags = [];
    let title = "";
    let subtitle = "";
    let date = "";
    let author = "";
    let mode = "";
    for (const line of frontMatter.split("\n")) {
        if (/^\s+-\s+/.test(line) && mode === "tags") {
            tags.push(unquote(line.replace(/^\s+-\s+/, "").trim()));
            continue;
        }
        const matched = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (!matched) continue;
        mode = matched[1];
        const value = unquote(matched[2].trim());
        if (matched[1] === "title") title = value;
        if (matched[1] === "subtitle") subtitle = value;
        if (matched[1] === "date") date = value.slice(0, 10);
        if (matched[1] === "author") author = value;
        if (matched[1] === "tags" && value) tags.push(value);
    }
    return { title, subtitle, date, author, tags, body };
}

export function replaceDraftImages(body, images) {
    return String(body ?? "").replace(/\(draft:([A-Za-z0-9_-]+)\)/g, (all, id) => {
        const path = images[id];
        if (!path || !String(path).startsWith("/img/posts/")) throw new Error("还有图片没有准备好");
        return `(${path})`;
    });
}

export function buildPostDocument(input) {
    const title = String(input.title ?? "").trim();
    if (!title) throw new Error("请填写标题");
    const body = String(input.body ?? "").replace(/\r\n/g, "\n").trim();
    if (!body) throw new Error("请填写正文");
    if (body.includes("draft:")) throw new Error("还有图片没有上传");
    const date = String(input.date ?? "").slice(0, 10);
    const path = input.existingPath ? input.existingPath : postPath(date, slugify(input.slug));
    if (!isPublishablePath(path) || !isExistingPostPath(path)) throw new Error("文章路径不合法");
    const tags = (input.tags || []).map((tag) => String(tag).trim()).filter(Boolean);
    const lines = ["---", "layout: post", `title: ${yamlQuote(title)}`];
    const subtitle = String(input.subtitle ?? "").trim();
    if (subtitle) lines.push(`subtitle: ${yamlQuote(subtitle)}`);
    lines.push(`date: ${date}`, `author: ${yamlQuote(input.author || "JH")}`, "catalog: true");
    if (tags.length) {
        lines.push("tags:");
        tags.forEach((tag) => lines.push(`  - ${yamlQuote(tag)}`));
    }
    lines.push("---", "", body, "");
    return { path, markdown: lines.join("\n") };
}

export function buildContentsRequest({ message, contentBase64, sha, branch }) {
    if (!message || !contentBase64) throw new Error("提交内容不完整");
    const body = { message, content: contentBase64, branch };
    if (sha) body.sha = sha;
    return body;
}

export function writerGateMessage(config, loaded) {
    if (!loaded) return "写作配置没有加载。";
    if (!publishingConfigured(config)) return "写作还没有启用。";
    return "需要 GitHub 登录。";
}

export function publishingConfigured(config) {
    if (!config?.owner || !config.repo || !config.branch) return false;
    try {
        const proxy = new URL(config.oauthProxy);
        return proxy.protocol === "https:";
    } catch {
        return false;
    }
}

export function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(String(text ?? ""));
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
}

export function base64ToUtf8(value) {
    const binary = atob(String(value ?? "").replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

export function renderMarkdown(source, imageUrls = {}) {
    const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
    let html = "";
    let index = 0;
    const paragraph = [];

    const flush = () => {
        if (!paragraph.length) return;
        html += `<p>${inline(paragraph.join(" "))}</p>`;
        paragraph.length = 0;
    };

    while (index < lines.length) {
        const line = lines[index];
        if (line.startsWith("```")) {
            flush();
            const buffer = [];
            index += 1;
            while (index < lines.length && !lines[index].startsWith("```")) {
                buffer.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) index += 1;
            html += `<pre><code>${escapeHtml(buffer.join("\n"))}</code></pre>`;
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flush();
            html += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
            index += 1;
            continue;
        }
        if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
            flush();
            const ordered = /^\s*\d+\./.test(line);
            const tag = ordered ? "ol" : "ul";
            html += `<${tag}>`;
            while (index < lines.length && /^\s*(?:[-*+]|\d+\.)\s+/.test(lines[index])) {
                html += `<li>${inline(lines[index].replace(/^\s*(?:[-*+]|\d+\.)\s+/, ""))}</li>`;
                index += 1;
            }
            html += `</${tag}>`;
            continue;
        }
        if (/^>\s?/.test(line)) {
            flush();
            const buffer = [];
            while (index < lines.length && /^>\s?/.test(lines[index])) {
                buffer.push(lines[index].replace(/^>\s?/, ""));
                index += 1;
            }
            html += `<blockquote><p>${inline(buffer.join(" "))}</p></blockquote>`;
            continue;
        }
        if (line.trim() === "") {
            flush();
            index += 1;
            continue;
        }
        paragraph.push(line.trim());
        index += 1;
    }
    flush();
    return html;

    function inline(raw) {
        const pattern = /(!?\[[^\]]*\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)/g;
        let result = "";
        let last = 0;
        for (const match of raw.matchAll(pattern)) {
            result += escapeHtml(raw.slice(last, match.index));
            const token = match[0];
            if (token.startsWith("![")) {
                const parts = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
                const alt = parts[1];
                let url = parts[2];
                if (url.startsWith("draft:")) url = imageUrls[url.slice(6)] || "";
                if (/^(?:https?:|blob:|data:image\/|\/)/.test(url)) {
                    result += `<img alt="${escapeHtml(alt)}" src="${escapeHtml(url)}">`;
                }
            } else if (token.startsWith("[")) {
                const parts = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
                const label = escapeHtml(parts[1]);
                const url = parts[2];
                if (/^(?:https?:|mailto:|\/)/.test(url)) {
                    const external = url.startsWith("http");
                    result += `<a href="${escapeHtml(url)}"${external ? ' rel="noopener noreferrer" target="_blank"' : ""}>${label}</a>`;
                } else {
                    result += label;
                }
            } else if (token.startsWith("`")) {
                result += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
            } else {
                result += `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
            }
            last = match.index + token.length;
        }
        result += escapeHtml(raw.slice(last));
        return result;
    }
}
