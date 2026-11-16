import {
    assertOwner,
    base64ToUtf8,
    buildContentsRequest,
    buildPostDocument,
    imagePath,
    isPublishablePath,
    parsePostDocument,
    parseTagInput,
    publishingConfigured,
    renderMarkdown,
    replaceDraftImages,
    slugify,
    splitPostPath,
    utf8ToBase64
} from "./write-core.js";

const SESSION_KEY = "jh-write-session";
const state = {
    config: null,
    draftId: crypto.randomUUID(),
    existingPath: "",
    images: [],
    remoteUrls: {}
};

const statusNode = document.querySelector("#status");
const form = document.querySelector("#editor");

function setStatus(message) {
    statusNode.textContent = message;
}

function readSession() {
    try {
        return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch {
        return null;
    }
}

function writeSession(session) {
    if (!session) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function fields() {
    return {
        title: document.querySelector("#post-title").value,
        subtitle: document.querySelector("#post-subtitle").value,
        date: document.querySelector("#post-date").value,
        tags: parseTagInput(document.querySelector("#post-tags").value),
        slug: document.querySelector("#post-slug").value,
        body: document.querySelector("#post-body").value
    };
}

function fill(data) {
    document.querySelector("#post-title").value = data.title || "";
    document.querySelector("#post-subtitle").value = data.subtitle || "";
    document.querySelector("#post-date").value = (data.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    document.querySelector("#post-tags").value = (data.tags || []).join(", ");
    document.querySelector("#post-slug").value = data.slug || "";
    document.querySelector("#post-body").value = data.body || "";
    updateSlugHint();
}

function updateSlugHint() {
    const hint = document.querySelector("#slug-preview");
    const date = document.querySelector("#post-date").value;
    if (state.existingPath) {
        hint.textContent = `将覆盖 ${state.existingPath}`;
        return;
    }
    const slug = slugify(document.querySelector("#post-slug").value);
    hint.textContent = slug && date ? `新文件 _posts/${date}-${slug}.md` : "新建文章需要一个英文文件名，例如 escape-analysis";
}

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("jh-notes", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "id" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveDraft() {
    const db = await openDb();
    const record = {
        id: state.draftId,
        ...fields(),
        existingPath: state.existingPath,
        images: state.images,
        updatedAt: Date.now()
    };
    await new Promise((resolve, reject) => {
        const tx = db.transaction("drafts", "readwrite");
        tx.objectStore("drafts").put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    db.close();
    setStatus("草稿留在这台设备上，没有上传。");
    await renderDrafts();
}

async function renderDrafts() {
    const list = document.querySelector("#draft-list");
    const db = await openDb();
    const drafts = await new Promise((resolve, reject) => {
        const request = db.transaction("drafts").objectStore("drafts").getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
    db.close();
    list.replaceChildren();
    drafts.sort((a, b) => b.updatedAt - a.updatedAt);
    drafts.forEach((draft) => {
        const item = document.createElement("li");
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = draft.title || "未命名草稿";
        open.addEventListener("click", () => loadDraft(draft));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "删除";
        remove.addEventListener("click", () => deleteDraft(draft.id));
        item.append(open, remove);
        list.append(item);
    });
    return drafts;
}

function loadDraft(draft) {
    state.draftId = draft.id;
    state.existingPath = draft.existingPath || "";
    state.images = draft.images || [];
    state.remoteUrls = {};
    fill(draft);
    renderImages();
    setStatus("已打开本机草稿。");
}

async function deleteDraft(id) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction("drafts", "readwrite");
        tx.objectStore("drafts").delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    db.close();
    if (id === state.draftId) resetEditor();
    await renderDrafts();
}

function resetEditor() {
    state.draftId = crypto.randomUUID();
    state.existingPath = "";
    state.images = [];
    state.remoteUrls = {};
    fill({ date: new Date().toISOString().slice(0, 10) });
    renderImages();
}

function imageSources() {
    const sources = { ...state.remoteUrls };
    state.images.forEach((image) => {
        sources[image.id] = URL.createObjectURL(image.blob);
    });
    return sources;
}

function renderPreview() {
    const preview = document.querySelector("#preview");
    preview.innerHTML = renderMarkdown(fields().body, imageSources());
    preview.hidden = false;
}

function renderImages() {
    const list = document.querySelector("#image-list");
    list.replaceChildren();
    state.images.forEach((image) => {
        const item = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = image.filename;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "移除";
        remove.addEventListener("click", () => {
            state.images = state.images.filter((item) => item.id !== image.id);
            renderImages();
        });
        item.append(name, remove);
        list.append(item);
    });
}

async function compressImage(file) {
    if (!file.type.startsWith("image/")) throw new Error("请选择图片");
    if (file.size < 800000 && file.type === "image/gif") return file;
    const bitmap = await createImageBitmap(file);
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
    bitmap.close();
    if (!blob) throw new Error("图片处理失败");
    return blob;
}

function insertAtCursor(text) {
    const body = document.querySelector("#post-body");
    const start = body.selectionStart ?? body.value.length;
    body.setRangeText(text, start, body.selectionEnd ?? start, "end");
}

async function addImages(fileList) {
    for (const file of fileList) {
        const blob = await compressImage(file);
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
        const filename = `${id}.jpg`;
        state.images.push({ id, filename, blob });
        insertAtCursor(`\n![图片](draft:${id})\n`);
    }
    renderImages();
    await saveDraft();
}

function downloadMarkdown() {
    const current = fields();
    const body = current.body.replace(/\(draft:[^)]+\)/g, "(图片待发布)");
    const doc = buildPostDocument({
        ...current,
        body,
        author: "JH",
        existingPath: state.existingPath || undefined,
        slug: current.slug || "draft"
    });
    const file = new Blob([doc.markdown], { type: "text/markdown;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = doc.path.split("/").pop();
    link.click();
    URL.revokeObjectURL(link.href);
}

function githubHeaders(token) {
    return {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10"
    };
}

function contentsUrl(path) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `https://api.github.com/repos/${encodeURIComponent(state.config.owner)}/${encodeURIComponent(state.config.repo)}/contents/${encoded}`;
}

async function putFile(token, path, contentBase64, message) {
    if (!isPublishablePath(path)) throw new Error("路径不合法");
    const headers = githubHeaders(token);
    const url = `${contentsUrl(path)}?ref=${encodeURIComponent(state.config.branch)}`;
    const existing = await fetch(url, { headers });
    let sha = "";
    if (existing.status === 200) {
        const data = await existing.json();
        if (data.type && data.type !== "file") throw new Error("目标路径不是文件");
        sha = data.sha;
    } else if (existing.status !== 404) {
        throw new Error("读取仓库文件失败");
    }
    const response = await fetch(contentsUrl(path), {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(buildContentsRequest({
            message,
            contentBase64,
            sha,
            branch: state.config.branch
        }))
    });
    if (response.status === 409) throw new Error("文件刚被更新过，请再发布一次");
    if (response.status === 401) throw new Error("登录已失效，请重新登录");
    if (!response.ok) throw new Error("写入 GitHub 失败");
    return response.json();
}

async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
}

async function publish() {
    if (!publishingConfigured(state.config)) {
        setStatus("发布还需要一次性配置。草稿可以继续留在手机上，或先下载 Markdown。");
        document.querySelector("#setup").open = true;
        return;
    }
    const session = readSession();
    if (!session?.token) {
        setStatus("请先用 GitHub 登录。");
        return;
    }
    assertOwner(session.login, state.config.owner);
    const current = fields();
    const slug = state.existingPath ? splitPostPath(state.existingPath)?.slug : slugify(current.slug);
    if (state.images.length && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || "")) {
        throw new Error("这篇文章的文件名不适合存放新图片，请新建一篇英文文件名的笔记");
    }
    const mapping = {};
    for (const image of state.images) {
        const path = imagePath(slug, image.filename);
        await putFile(session.token, path, await blobToBase64(image.blob), `添加图片 ${path}`);
        mapping[image.id] = `/${path}`;
    }
    const body = replaceDraftImages(current.body, mapping);
    const doc = buildPostDocument({
        ...current,
        body,
        author: "JH",
        existingPath: state.existingPath || undefined
    });
    const result = await putFile(session.token, doc.path, utf8ToBase64(doc.markdown), `${state.existingPath ? "更新" : "发布"}：${current.title.trim()}`);
    state.images = [];
    renderImages();
    const commitUrl = result.commit?.html_url;
    setStatus(commitUrl ? "已提交。Pages 重新构建后才会出现在主页。" : "已提交。Pages 重新构建后才会出现在主页。");
    if (commitUrl) {
        const link = document.createElement("a");
        link.href = commitUrl;
        link.textContent = "查看这次提交";
        link.rel = "noopener noreferrer";
        link.target = "_blank";
        statusNode.append(" ");
        statusNode.append(link);
    }
}

async function loadRemoteList() {
    const session = readSession();
    if (!session?.token) {
        setStatus("读取已发布文章需要先登录。");
        return;
    }
    const response = await fetch(`${contentsUrl("_posts")}?ref=${encodeURIComponent(state.config.branch)}`, {
        headers: githubHeaders(session.token)
    });
    if (!response.ok) throw new Error("没有读到文章列表");
    const items = await response.json();
    const list = document.querySelector("#remote-list");
    list.replaceChildren();
    items.filter((item) => item.type === "file" && item.name.endsWith(".md")).forEach((item) => {
        const row = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = item.name;
        button.addEventListener("click", () => openRemote(item.path));
        row.append(button);
        list.append(row);
    });
}

async function openRemote(path) {
    if (!path.startsWith("_posts/") || path.includes("..")) throw new Error("路径不合法");
    const session = readSession();
    const response = await fetch(`${contentsUrl(path)}?ref=${encodeURIComponent(state.config.branch)}`, {
        headers: githubHeaders(session.token)
    });
    if (!response.ok) throw new Error("没有读到这篇文章");
    const data = await response.json();
    const parsed = parsePostDocument(base64ToUtf8(data.content));
    const parts = splitPostPath(path);
    state.draftId = crypto.randomUUID();
    state.existingPath = path;
    state.images = [];
    fill({ ...parsed, slug: parts?.slug || "" });
    renderImages();
    setStatus("已载入线上文章。发布时会覆盖原文件，网址不变。");
}

function renderAuth() {
    const session = readSession();
    const login = document.querySelector("#login");
    const logout = document.querySelector("#logout");
    const code = document.querySelector("#device");
    const who = document.querySelector("#who");
    const configured = publishingConfigured(state.config);
    document.querySelector("#publish").disabled = !configured;
    login.hidden = !configured || Boolean(session);
    logout.hidden = !session;
    code.hidden = true;
    who.textContent = session ? `已登录 ${session.login}` : (configured ? "尚未登录" : "发布尚未配置，草稿和下载可以先用");
}

async function startLogin() {
    const proxy = state.config.oauthProxy.replace(/\/$/, "");
    const response = await fetch(`${proxy}/login/device/code`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: state.config.clientId, scope: "repo" })
    });
    const data = await response.json();
    if (!response.ok || !data.user_code) throw new Error("无法开始 GitHub 登录");
    const device = document.querySelector("#device");
    device.hidden = false;
    document.querySelector("#user-code").textContent = data.user_code;
    const link = document.querySelector("#verify-link");
    link.href = data.verification_uri || "https://github.com/login/device";
    setStatus("在 GitHub 页面输入验证码，然后回到这里。");
    const interval = Math.max(5, Number(data.interval) || 5) * 1000;
    const deadline = Date.now() + (Number(data.expires_in) || 900) * 1000;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        const tokenResponse = await fetch(`${proxy}/login/oauth/access_token`, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: state.config.clientId,
                device_code: data.device_code,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code"
            })
        });
        const token = await tokenResponse.json();
        if (token.access_token) {
            const userResponse = await fetch("https://api.github.com/user", { headers: githubHeaders(token.access_token) });
            if (!userResponse.ok) throw new Error("没有读到 GitHub 账号");
            const user = await userResponse.json();
            assertOwner(user.login, state.config.owner);
            writeSession({ token: token.access_token, login: user.login });
            renderAuth();
            setStatus("登录完成。令牌只留在这个标签页。");
            return;
        }
        if (token.error === "authorization_pending") continue;
        if (token.error === "slow_down") {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            continue;
        }
        throw new Error("GitHub 没有完成授权");
    }
    throw new Error("验证码过期了，请再试一次");
}

let saveTimer = 0;
form.addEventListener("input", () => {
    updateSlugHint();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveDraft().catch((error) => setStatus(error.message || "草稿保存失败"));
    }, 500);
});

document.querySelector("#new-draft").addEventListener("click", () => {
    resetEditor();
    setStatus("开始一篇新草稿。");
});
document.querySelector("#preview-toggle").addEventListener("click", renderPreview);
document.querySelector("#download").addEventListener("click", () => {
    try {
        downloadMarkdown();
    } catch (error) {
        setStatus(error.message);
    }
});
document.querySelector("#publish").addEventListener("click", () => {
    publish().catch((error) => setStatus(error.message || "发布失败"));
});
document.querySelector("#login").addEventListener("click", () => {
    startLogin().catch((error) => setStatus(error.message || "登录失败"));
});
document.querySelector("#logout").addEventListener("click", () => {
    writeSession(null);
    renderAuth();
    setStatus("已退出。");
});
document.querySelector("#image-input").addEventListener("change", (event) => {
    addImages(event.target.files).catch((error) => setStatus(error.message || "图片添加失败"));
    event.target.value = "";
});
document.querySelector("#load-remote").addEventListener("click", () => {
    loadRemoteList().catch((error) => setStatus(error.message || "读取失败"));
});

fill({ date: new Date().toISOString().slice(0, 10) });
fetch(new URL("../write/config.json", import.meta.url))
    .then((response) => response.json())
    .then((config) => {
        state.config = config;
        const setup = document.querySelector("#setup");
        setup.open = !publishingConfigured(config);
        renderAuth();
    })
    .catch(() => setStatus("没有读到写作配置。"));

renderDrafts()
    .then((drafts) => {
        if (drafts[0]) loadDraft(drafts[0]);
    })
    .catch(() => setStatus("这台浏览器没有打开本地草稿存储。"));
