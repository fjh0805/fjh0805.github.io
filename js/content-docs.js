export const PROFILE_PATH = "_data/profile.yml";
export const LINKS_PATH = "_data/links.yml";

const TEXT = {
    name: 40,
    school: 80,
    quote: 120,
    lead: 500,
    paragraph: 500,
    motto: 200,
    linkTitle: 40,
    stackLabel: 40,
    stackValue: 80,
    title: 120,
    subtitle: 160,
    tag: 40
};

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

export function oneLine(value, max) {
    const text = String(value ?? "").trim();
    if (/[\u0000\r\n]/.test(text) || text.length > max) fail("bad_text");
    return text;
}

function quote(value) {
    return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquote(value) {
    const trimmed = String(value ?? "").trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return trimmed;
}

export function safePublicUrl(value) {
    let url;
    try {
        url = new URL(String(value ?? "").trim());
    } catch {
        return "";
    }
    if (url.username || url.password || url.hash) return "";
    if (url.protocol === "mailto:") {
        const email = url.pathname;
        if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) return "";
        return `mailto:${email}`;
    }
    if (url.protocol !== "https:") return "";
    if (!/^[a-z0-9.-]+$/i.test(url.hostname) || url.hostname === "localhost" || url.hostname.endsWith(".local")) return "";
    return url.toString();
}

export function safeGithubUrl(value) {
    const url = safePublicUrl(value);
    if (!url) return "";
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return "";
    }
    if (parsed.hostname !== "github.com" || parsed.search) return "";
    if (!/^\/[A-Za-z0-9-]+\/?$/.test(parsed.pathname)) return "";
    return `https://github.com${parsed.pathname.replace(/\/$/, "")}`;
}

function emailAddress(value) {
    const text = oneLine(value, 80);
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(text)) fail("bad_email");
    return text;
}

function listOf(value, maxItems, maxLength) {
    if (!Array.isArray(value)) fail("bad_text");
    if (value.length > maxItems) fail("bad_text");
    return value.map((item) => oneLine(item, maxLength)).filter(Boolean);
}

function linksOf(value) {
    if (!Array.isArray(value) || value.length > 8) fail("bad_link");
    return value.map((item) => {
        const title = oneLine(item?.title, TEXT.linkTitle);
        const href = safePublicUrl(item?.href);
        if (!title || !href) fail("bad_link");
        return { title, href };
    });
}

function stackOf(value) {
    if (!Array.isArray(value) || value.length > 8) fail("bad_text");
    return value.map((item) => {
        const label = oneLine(item?.label, TEXT.stackLabel);
        const text = oneLine(item?.value, TEXT.stackValue);
        if (!label || !text) fail("bad_text");
        return { label, value: text };
    });
}

function localeOf(input) {
    return {
        lead: oneLine(input?.lead, TEXT.lead),
        paragraphs: listOf(input?.paragraphs, 6, TEXT.paragraph),
        quote: oneLine(input?.quote, TEXT.motto),
        motto: oneLine(input?.motto, TEXT.motto),
        links: linksOf(input?.links || []),
        stack: stackOf(input?.stack || [])
    };
}

export function normalizeProfilePatch(patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) fail("bad_document");
    const next = {
        name: oneLine(patch.name, TEXT.name),
        school: oneLine(patch.school, TEXT.school),
        quote: oneLine(patch.quote, TEXT.quote),
        email: emailAddress(patch.email),
        github: safeGithubUrl(patch.github),
        zh: localeOf(patch.zh),
        en: localeOf(patch.en)
    };
    if (!next.name || !next.github) fail("bad_document");
    return next;
}

function splitTopLevel(text) {
    const blocks = [];
    let current = null;
    for (const line of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
        if (/^[A-Za-z0-9_-]+\s*:/.test(line)) {
            if (current) blocks.push(current);
            current = { key: line.slice(0, line.indexOf(":")).trim(), lines: [line] };
        } else if (current) {
            current.lines.push(line);
        }
    }
    if (current) blocks.push(current);
    return blocks;
}

function localeLines(name, locale) {
    const lines = [`${name}:`, `  lead: ${quote(locale.lead)}`, "  paragraphs:"];
    locale.paragraphs.forEach((paragraph) => lines.push(`    - ${quote(paragraph)}`));
    lines.push(`  quote: ${quote(locale.quote)}`, `  motto: ${quote(locale.motto)}`, "  links:");
    locale.links.forEach((link) => lines.push(`    - { title: ${quote(link.title)}, href: ${quote(link.href)} }`));
    lines.push("  stack:");
    locale.stack.forEach((item) => lines.push(`    - { label: ${quote(item.label)}, value: ${quote(item.value)} }`));
    return lines;
}

export function applyProfileEdit(original, patch) {
    const next = normalizeProfilePatch(patch);
    const rendered = {
        name: [`name: ${quote(next.name)}`],
        school: [`school: ${quote(next.school)}`],
        quote: [`quote: ${quote(next.quote)}`],
        email: [`email: ${quote(next.email)}`],
        github: [`github: ${quote(next.github)}`],
        zh: localeLines("zh", next.zh),
        en: localeLines("en", next.en)
    };
    const seen = new Set();
    const lines = [];
    splitTopLevel(original).forEach((block) => {
        if (rendered[block.key]) {
            lines.push(...rendered[block.key]);
            seen.add(block.key);
        } else {
            lines.push(...block.lines);
        }
    });
    Object.keys(rendered).forEach((key) => {
        if (!seen.has(key)) lines.push(...rendered[key]);
    });
    return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function parseFlowItem(text) {
    const inner = String(text ?? "").trim().replace(/^\{/, "").replace(/\}$/, "").trim();
    const parts = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < inner.length; index += 1) {
        const char = inner[index];
        if (char === '"' && inner[index - 1] !== "\\") quoted = !quoted;
        if (char === "," && !quoted) {
            parts.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    if (current.trim()) parts.push(current);
    const map = {};
    parts.forEach((part) => {
        const split = part.indexOf(":");
        if (split < 0) return;
        map[part.slice(0, split).trim()] = unquote(part.slice(split + 1));
    });
    return map;
}

function emptyLocale() {
    return { lead: "", paragraphs: [], quote: "", motto: "", links: [], stack: [] };
}

function parseLocale(lines) {
    const result = emptyLocale();
    let mode = "";
    lines.forEach((line) => {
        const item = line.match(/^\s+-\s+(.*)$/);
        if (item && (mode === "paragraphs" || mode === "links" || mode === "stack")) {
            if (mode === "paragraphs") result.paragraphs.push(unquote(item[1]));
            else {
                const flow = parseFlowItem(item[1]);
                if (mode === "links" && flow.title && flow.href) result.links.push({ title: flow.title, href: flow.href });
                if (mode === "stack" && flow.label && flow.value) result.stack.push({ label: flow.label, value: flow.value });
            }
            return;
        }
        const key = line.match(/^\s{2}([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (!key) return;
        mode = key[1];
        if (mode === "lead" || mode === "quote" || mode === "motto") result[mode] = unquote(key[2]);
    });
    return result;
}

export function parseProfile(text) {
    const document = { name: "", school: "", quote: "", email: "", github: "", zh: emptyLocale(), en: emptyLocale() };
    splitTopLevel(text).forEach((block) => {
        if (["name", "school", "quote", "email", "github"].includes(block.key)) {
            document[block.key] = unquote(block.lines[0].slice(block.lines[0].indexOf(":") + 1));
        }
        if (block.key === "zh" || block.key === "en") document[block.key] = parseLocale(block.lines.slice(1));
    });
    return document;
}

export function normalizeLinks(value) {
    const links = linksOf(value);
    if (!links.length) fail("bad_link");
    return links;
}

export function applyLinksEdit(value) {
    return `${normalizeLinks(value).map((link) => `- { title: ${quote(link.title)}, href: ${quote(link.href)} }`).join("\n")}\n`;
}

export function parseLinks(text) {
    const links = [];
    String(text ?? "").split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const flow = parseFlowItem(trimmed.replace(/^-+\s*/, ""));
        if (flow.title && flow.href) links.push({ title: flow.title, href: flow.href });
    });
    return links;
}

export function applyPostEdit(markdown, fields) {
    const text = String(markdown ?? "").replace(/\r\n/g, "\n");
    if (!text.startsWith("---\n")) fail("bad_document");
    const end = text.indexOf("\n---\n", 4);
    if (end < 0) fail("bad_document");
    const title = oneLine(fields?.title, TEXT.title);
    const subtitle = oneLine(fields?.subtitle, TEXT.subtitle);
    const date = String(fields?.date ?? "");
    const body = String(fields?.body ?? "").replace(/\r\n/g, "\n");
    if (!title) fail("bad_document");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail("bad_date");
    if (!body.trim() || body.length > 200000 || /[\u0000]/.test(body) || body.includes("draft:")) fail("bad_body");
    const tags = listOf(fields?.tags || [], 8, TEXT.tag);
    const kept = [];
    let skippingTags = false;
    text.slice(4, end).split("\n").forEach((line) => {
        if (skippingTags) {
            if (/^\s+-\s+/.test(line)) return;
            skippingTags = false;
        }
        const key = line.match(/^([A-Za-z0-9_-]+)\s*:/);
        if (key && ["title", "subtitle", "date", "tags"].includes(key[1])) {
            if (key[1] === "tags") skippingTags = true;
            return;
        }
        kept.push(line);
    });
    while (kept.length && kept[kept.length - 1] === "") kept.pop();
    kept.push(`title: ${quote(title)}`);
    if (subtitle) kept.push(`subtitle: ${quote(subtitle)}`);
    kept.push(`date: ${date}`);
    if (tags.length) {
        kept.push("tags:");
        tags.forEach((tag) => kept.push(`  - ${quote(tag)}`));
    }
    return `---\n${kept.join("\n")}\n---\n\n${body.trim()}\n`;
}
