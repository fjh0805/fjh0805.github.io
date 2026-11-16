import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const scanned = ["js", "css", "writer", "docs", "test", "_data", "_includes", "_layouts"];
const files = ["write.html", "index.html", "about.html", "sw.js", "package.json"];

async function walk(directory, found = []) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full, found);
        else if (/\.(js|css|html|md|json|yml|jsonc)$/.test(entry.name)) found.push(full);
    }
    return found;
}

test("public writer files do not embed publish credentials", async () => {
    const paths = [...files.map((file) => path.join(root, file))];
    for (const directory of scanned) paths.push(...await walk(path.join(root, directory)));
    const pattern = /ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]+|clientSecret\s*[:=]\s*["'][^"']+["']/;
    for (const file of paths) {
        const text = await readFile(file, "utf8");
        assert.equal(pattern.test(text), false, file);
    }
});

test("writer config ships without a client id or proxy", async () => {
    const config = await readFile(path.join(root, "_config.yml"), "utf8");
    assert.match(config, /client_id:\s*""/);
    assert.match(config, /oauth_proxy:\s*""/);
});
