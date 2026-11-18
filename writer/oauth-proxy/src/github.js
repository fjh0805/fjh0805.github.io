import {
    applyLinksEdit,
    applyPostEdit,
    applyProfileEdit,
    LINKS_PATH,
    parseLinks,
    parseProfile,
    PROFILE_PATH
} from "../../../js/content-docs.js";
import { hasRepoWritePermission, isExistingPostPath, isNewPostPath, isPublishablePath } from "../../../js/write-policy.js";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export function githubHeaders(token) {
    return {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "jh-write",
        "x-github-api-version": API_VERSION
    };
}

function repositoryCoordinates(env) {
    const owner = env.GITHUB_OWNER || "fjh0805";
    const repo = env.GITHUB_REPO || "fjh0805.github.io";
    return {
        owner,
        repo,
        branch: env.GITHUB_BRANCH || "master",
        allowedLogin: String(env.ALLOWED_LOGIN || owner).toLowerCase()
    };
}

export function contentsUrl(owner, repo, path) {
    const encoded = path.split("/").map((part) => encodeURIComponent(part)).join("/");
    return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encoded}`;
}

export async function verifyPublisher(token, env, fetchImpl = fetch) {
    const { owner, repo, branch, allowedLogin } = repositoryCoordinates(env);
    const headers = githubHeaders(token);
    const userResponse = await fetchImpl(`${API}/user`, { headers });
    if (!userResponse.ok) return { ok: false, status: userResponse.status === 401 ? 401 : 403 };
    const user = await userResponse.json();
    if (String(user.login || "").toLowerCase() !== allowedLogin) return { ok: false, status: 403 };
    const repoResponse = await fetchImpl(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers });
    if (!repoResponse.ok) return { ok: false, status: repoResponse.status === 401 ? 401 : 403 };
    const repository = await repoResponse.json();
    if (!hasRepoWritePermission(repository)) return { ok: false, status: 403 };
    return { ok: true, login: user.login, headers, owner, repo, branch };
}

function decodeBase64(value) {
    const binary = atob(String(value || "").replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

function encodeBase64(text) {
    const bytes = new TextEncoder().encode(String(text ?? ""));
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
}

export function isManagedReadPath(path) {
    return path === PROFILE_PATH || path === LINKS_PATH || isExistingPostPath(path);
}

export function managedDocuments() {
    return [
        { id: "profile", path: PROFILE_PATH, title: "简介" },
        { id: "links", path: LINKS_PATH, title: "主页链接" }
    ];
}

export async function listPosts(auth, fetchImpl = fetch) {
    const response = await fetchImpl(`${contentsUrl(auth.owner, auth.repo, "_posts")}?ref=${encodeURIComponent(auth.branch)}`, {
        headers: auth.headers
    });
    if (response.status === 404) return { status: 200, body: { ok: true, files: [] } };
    if (!response.ok) return { status: 502, body: { error: "read_failed" } };
    const items = await response.json();
    if (!Array.isArray(items)) return { status: 502, body: { error: "read_failed" } };
    const files = items
        .filter((item) => item && item.type === "file" && isExistingPostPath(item.path))
        .map((item) => ({ name: item.name, path: item.path }));
    return { status: 200, body: { ok: true, files, documents: managedDocuments() } };
}

export async function readPost(auth, path, fetchImpl = fetch) {
    if (!isManagedReadPath(path)) return { status: 400, body: { error: "bad_path" } };
    const response = await fetchImpl(`${contentsUrl(auth.owner, auth.repo, path)}?ref=${encodeURIComponent(auth.branch)}`, {
        headers: auth.headers
    });
    if (!response.ok) return { status: response.status === 404 ? 404 : 502, body: { error: "read_failed" } };
    const data = await response.json();
    if (data.type && data.type !== "file") return { status: 409, body: { error: "not_a_file" } };
    const content = decodeBase64(data.content || "");
    if (content.length > 400000) return { status: 413, body: { error: "body_too_large" } };
    const body = { ok: true, path, sha: data.sha || "", content };
    if (path === PROFILE_PATH) {
        try {
            body.document = parseProfile(content);
        } catch {
            return { status: 422, body: { error: "bad_document" } };
        }
    }
    if (path === LINKS_PATH) body.links = parseLinks(content);
    return { status: 200, body };
}

export async function writeRepoFile(auth, { path, message, content, sha }, fetchImpl = fetch) {
    if (!isPublishablePath(path) || path === PROFILE_PATH || path === LINKS_PATH) {
        return { status: 400, body: { error: "bad_path" } };
    }
    if (isExistingPostPath(path) && !isNewPostPath(path)) return { status: 400, body: { error: "use_update" } };
    const commitMessage = String(message || "").trim();
    if (!commitMessage || commitMessage.length > 200) return { status: 400, body: { error: "bad_message" } };
    const encoded = String(content || "").replace(/\s/g, "");
    if (!encoded || encoded.length > 1800000 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) {
        return { status: 413, body: { error: "body_too_large" } };
    }
    const expectedSha = String(sha || "");
    if (expectedSha && !/^[a-f0-9]{40}$/.test(expectedSha)) return { status: 400, body: { error: "bad_sha" } };
    const url = contentsUrl(auth.owner, auth.repo, path);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const existing = await fetchImpl(`${url}?ref=${encodeURIComponent(auth.branch)}`, { headers: auth.headers });
        let currentSha = "";
        if (existing.status === 200) {
            const data = await existing.json();
            if (data.type && data.type !== "file") return { status: 409, body: { error: "not_a_file" } };
            if (isExistingPostPath(path)) return { status: 400, body: { error: "use_update" } };
            currentSha = data.sha || "";
            if (!expectedSha || expectedSha !== currentSha) return { status: 409, body: { error: "conflict" } };
        } else if (existing.status !== 404) {
            return { status: 502, body: { error: "read_failed" } };
        } else if (expectedSha) {
            return { status: 409, body: { error: "conflict" } };
        }
        const payload = { message: commitMessage, content: encoded, branch: auth.branch };
        if (currentSha) payload.sha = currentSha;
        const response = await fetchImpl(url, {
            method: "PUT",
            headers: { ...auth.headers, "content-type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (response.status === 409 && attempt === 0) continue;
        if (response.status === 401) return { status: 401, body: { error: "unauthorized" } };
        if (response.status === 403) return { status: 403, body: { error: "forbidden" } };
        if (response.status === 409) return { status: 409, body: { error: "conflict" } };
        if (!response.ok) return { status: 502, body: { error: "write_failed" } };
        const data = await response.json();
        return {
            status: 200,
            body: {
                ok: true,
                path,
                commitUrl: data.commit && typeof data.commit.html_url === "string" ? data.commit.html_url : ""
            }
        };
    }
    return { status: 502, body: { error: "write_failed" } };
}

function commitMessageFor(kind, input) {
    if (kind === "profile") return "更新简介";
    if (kind === "links") return "更新主页链接";
    const title = String(input.title || "").trim().replace(/\s+/g, " ");
    return `更新：${title}`.slice(0, 180);
}

export async function updateManaged(auth, input, fetchImpl = fetch) {
    const kind = input?.kind;
    const path = input?.path;
    const expectedSha = String(input?.sha || "");
    if (kind === "post" && !isExistingPostPath(path)) return { status: 400, body: { error: "bad_path" } };
    if (kind === "profile" && path !== PROFILE_PATH) return { status: 400, body: { error: "bad_path" } };
    if (kind === "links" && path !== LINKS_PATH) return { status: 400, body: { error: "bad_path" } };
    if (!["post", "profile", "links"].includes(kind)) return { status: 400, body: { error: "bad_path" } };
    if (expectedSha && !/^[a-f0-9]{40}$/.test(expectedSha)) return { status: 400, body: { error: "bad_sha" } };

    const url = contentsUrl(auth.owner, auth.repo, path);
    const existing = await fetchImpl(`${url}?ref=${encodeURIComponent(auth.branch)}`, { headers: auth.headers });
    let current = "";
    let currentSha = "";
    if (existing.status === 200) {
        const data = await existing.json();
        if (data.type && data.type !== "file") return { status: 409, body: { error: "not_a_file" } };
        currentSha = data.sha || "";
        if (!expectedSha || expectedSha !== currentSha) return { status: 409, body: { error: "conflict" } };
        current = decodeBase64(data.content || "");
    } else if (existing.status === 404 && kind === "links" && !expectedSha) {
        current = "";
    } else if (existing.status === 404) {
        return { status: 404, body: { error: "read_failed" } };
    } else {
        return { status: 502, body: { error: "read_failed" } };
    }

    let next = "";
    try {
        if (kind === "post") next = applyPostEdit(current, input);
        if (kind === "profile") next = applyProfileEdit(current, input.profile);
        if (kind === "links") next = applyLinksEdit(input.links);
    } catch {
        return { status: 400, body: { error: "bad_document" } };
    }
    const payload = {
        message: commitMessageFor(kind, input),
        content: encodeBase64(next),
        branch: auth.branch
    };
    if (currentSha) payload.sha = currentSha;
    const response = await fetchImpl(url, {
        method: "PUT",
        headers: { ...auth.headers, "content-type": "application/json" },
        body: JSON.stringify(payload)
    });
    if (response.status === 409) return { status: 409, body: { error: "conflict" } };
    if (response.status === 401) return { status: 401, body: { error: "unauthorized" } };
    if (response.status === 403) return { status: 403, body: { error: "forbidden" } };
    if (!response.ok) return { status: 502, body: { error: "write_failed" } };
    const data = await response.json();
    return {
        status: 200,
        body: {
            ok: true,
            path,
            sha: data.content && typeof data.content.sha === "string" ? data.content.sha : "",
            commitUrl: data.commit && typeof data.commit.html_url === "string" ? data.commit.html_url : ""
        }
    };
}
