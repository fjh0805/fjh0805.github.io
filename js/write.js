import {
    assertOwner,
    buildPostDocument,
    clipboardImageFiles,
    extensionForImage,
    imagePath,
    imagesStillToUpload,
    parsePostDocument,
    parseTagInput,
    publishFingerprint,
    publishingConfigured,
    renderMarkdown,
    replaceDraftImages,
    safeCommitUrl,
    safeVerificationUri,
    slugify,
    splitPostPath,
    utf8ToBase64,
    writerGateMessage
} from "./write-core.js";

const SESSION_KEY = "jh-write-session";
const state = {
    config: null,
    configLoaded: false,
    unlocked: false,
    publishing: false,
    loginAttempt: 0,
    draftId: crypto.randomUUID(),
    existingPath: "",
    images: [],
    remoteUrls: {},
    lastFingerprint: ""
};

const statusNode = document.querySelector("#status");
const form = document.querySelector("#editor");
const publishButton = document.querySelector("#publish");

function setStatus(message) {
    statusNode.replaceChildren(document.createTextNode(message || ""));
}

function readSession() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
        if (!saved || typeof saved.session !== "string" || !saved.session) return null;
        return { session: saved.session, login: saved.login || "" };
    } catch {
        return null;
    }
}

function writeSession(session) {
    if (!session) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, JSON.stringify({ session: session.session, login: session.login || "" }));
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

function storedImages() {
    return state.images.map((image) => ({
        id: image.id,
        filename: image.filename,
        blob: image.blob,
        remotePath: image.remotePath || ""
    }));
}

async function saveDraft(options = {}) {
    if (!state.unlocked) return;
    if (state.publishing && !options.duringPublish) return;
    const db = await openDb();
    const record = {
        id: state.draftId,
        ...fields(),
        existingPath: state.existingPath,
        images: storedImages(),
        updatedAt: Date.now()
    };
    await new Promise((resolve, reject) => {
        const tx = db.transaction("drafts", "readwrite");
        tx.objectStore("drafts").put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    db.close();
    if (!options.quiet) setStatus("草稿留在这台设备上，没有上传。");
    await renderDrafts();
}

async function renderDrafts() {
    const list = document.querySelector("#draft-list");
    if (!state.unlocked) {
        list.replaceChildren();
        return [];
    }
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
    revokePreviews();
    state.draftId = draft.id;
    state.existingPath = draft.existingPath || "";
    state.images = (draft.images || []).map((image) => ({
        id: image.id,
        filename: image.filename,
        blob: image.blob,
        remotePath: image.remotePath || "",
        previewUrl: ""
    }));
    state.remoteUrls = {};
    state.lastFingerprint = "";
    fill(draft);
    renderImages();
    setStatus("已打开本机草稿。");
}

async function deleteDraft(id) {
    if (!state.unlocked) return;
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

function revokePreviews() {
    state.images.forEach((image) => {
        if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
    });
}

function resetEditor() {
    revokePreviews();
    state.draftId = crypto.randomUUID();
    state.existingPath = "";
    state.images = [];
    state.remoteUrls = {};
    state.lastFingerprint = "";
    fill({ date: new Date().toISOString().slice(0, 10) });
    renderImages();
    document.querySelector("#preview").hidden = true;
}

function imageSources() {
    const sources = { ...state.remoteUrls };
    state.images.forEach((image) => {
        if (!image.previewUrl && image.blob) image.previewUrl = URL.createObjectURL(image.blob);
        sources[image.id] = image.previewUrl;
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
        const thumb = document.createElement("img");
        thumb.alt = "";
        if (!image.previewUrl && image.blob) image.previewUrl = URL.createObjectURL(image.blob);
        thumb.src = image.previewUrl || "";
        const name = document.createElement("span");
        name.className = "image-name";
        name.textContent = image.remotePath ? `${image.filename} 已上传` : image.filename;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "移除";
        remove.addEventListener("click", () => {
            if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
            state.images = state.images.filter((item) => item.id !== image.id);
            renderImages();
            if (!document.querySelector("#preview").hidden) renderPreview();
        });
        item.append(thumb, name, remove);
        list.append(item);
    });
}

async function compressImage(file) {
    if (!file.type.startsWith("image/")) throw new Error("请选择图片");
    if (file.type === "image/gif" && file.size < 800000) return file;
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        throw new Error("这张图片没法处理，请换 JPG 或 PNG");
    }
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
    body.focus();
}

async function addImages(fileList) {
    if (!state.unlocked) return;
    let added = 0;
    for (const file of fileList) {
        const blob = await compressImage(file);
        const extension = extensionForImage(blob.type);
        if (!extension) throw new Error("这张图片没法处理，请换 JPG 或 PNG");
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
        state.images.push({ id, filename: `${id}.${extension}`, blob, remotePath: "", previewUrl: "" });
        insertAtCursor(`\n![图片](draft:${id})\n`);
        added += 1;
    }
    if (!added) return;
    renderImages();
    renderPreview();
    await saveDraft({ quiet: true });
    setStatus(added > 1 ? `已加上 ${added} 张图片，发布时才会上传。` : "已加上图片，发布时才会上传。");
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

async function proxy(path, payload) {
    const response = await fetch(`${state.config.oauthProxy.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {})
    });
    let data = {};
    try {
        data = await response.json();
    } catch {
        data = {};
    }
    return { ok: response.ok, status: response.status, data };
}

function failureMessage(data, fallback) {
    if (data?.error === "not_authorized" || data?.error === "forbidden") return "这个 GitHub 账号不能发布";
    if (data?.error === "unauthorized") return "登录已失效，请重新登录";
    if (data?.error === "proxy_not_configured") return "写作代理还没准备好。";
    if (data?.error === "conflict") return "文件刚被更新过，请再发布一次";
    return fallback;
}

async function verifyWriter(session) {
    if (!session?.session) throw new Error("需要 GitHub 登录。");
    const result = await proxy("/session/whoami", { session: session.session });
    if (!result.ok) throw new Error(failureMessage(result.data, "没有确认到发布权限"));
    assertOwner(result.data.login, state.config.owner);
    return { session: session.session, login: result.data.login };
}

async function putFile(session, path, contentBase64, message) {
    const result = await proxy("/repo/write", {
        session,
        path,
        message,
        content: contentBase64
    });
    if (!result.ok) throw new Error(failureMessage(result.data, "写入 GitHub 失败"));
    return result.data;
}

function referencedImageIds(body) {
    return [...String(body || "").matchAll(/\(draft:([A-Za-z0-9_-]+)\)/g)].map((match) => match[1]);
}

async function publish() {
    if (!publishingConfigured(state.config)) {
        setStatus("写作还没有启用。");
        return;
    }
    if (state.publishing) return;
    const currentSession = readSession();
    if (!currentSession) {
        showLoggedOut();
        return;
    }
    const current = fields();
    const fingerprint = publishFingerprint({ ...current, existingPath: state.existingPath });
    const referenced = referencedImageIds(current.body);
    const pending = imagesStillToUpload(state.images.filter((image) => referenced.includes(image.id)));
    if (state.lastFingerprint === fingerprint && pending.length === 0) {
        setStatus("这篇刚才已经发布。改过之后再发。");
        return;
    }
    state.publishing = true;
    publishButton.disabled = true;
    setStatus("正在发布。");
    try {
        const session = await verifyWriter(currentSession);
        writeSession(session);
        const slug = state.existingPath ? splitPostPath(state.existingPath)?.slug : slugify(current.slug);
        if (referenced.length && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || "")) {
            throw new Error("这篇文章的文件名不适合存放新图片，请新建一篇英文文件名的笔记");
        }
        for (const id of referenced) {
            if (!state.images.some((image) => image.id === id)) throw new Error("还有图片没有准备好");
        }
        const mapping = {};
        for (const image of state.images) {
            if (!referenced.includes(image.id)) continue;
            if (!image.remotePath) {
                const path = imagePath(slug, image.filename);
                await putFile(session.session, path, await blobToBase64(image.blob), `添加图片 ${path}`);
                image.remotePath = `/${path}`;
                await saveDraft({ quiet: true, duringPublish: true });
            }
            mapping[image.id] = image.remotePath;
        }
        const body = replaceDraftImages(current.body, mapping);
        const doc = buildPostDocument({
            ...current,
            body,
            author: "JH",
            existingPath: state.existingPath || undefined
        });
        const result = await putFile(
            session.session,
            doc.path,
            utf8ToBase64(doc.markdown),
            `${state.existingPath ? "更新" : "发布"}：${current.title.trim()}`.slice(0, 180)
        );
        document.querySelector("#post-body").value = body;
        state.existingPath = doc.path;
        state.images = [];
        state.lastFingerprint = publishFingerprint({ ...fields(), existingPath: state.existingPath });
        renderImages();
        updateSlugHint();
        await saveDraft({ quiet: true, duringPublish: true });
        setStatus("已提交。Pages 重新构建后才会出现在主页。");
        const commitUrl = safeCommitUrl(result.commitUrl);
        if (commitUrl) {
            const link = document.createElement("a");
            link.href = commitUrl;
            link.textContent = "查看这次提交";
            link.rel = "noopener noreferrer";
            link.target = "_blank";
            statusNode.append(" ");
            statusNode.append(link);
        }
    } catch (error) {
        const kept = state.images.some((image) => image.remotePath);
        const message = error.message || "发布失败";
        setStatus(kept ? `${message} 已经传上去的图片会保留，再点发布即可继续。` : message);
    } finally {
        state.publishing = false;
        publishButton.disabled = false;
    }
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

async function loadRemoteList() {
    const session = await verifyWriter(readSession());
    writeSession(session);
    const result = await proxy("/repo/list", { session: session.session });
    if (!result.ok) throw new Error(failureMessage(result.data, "没有读到文章列表"));
    const list = document.querySelector("#remote-list");
    list.replaceChildren();
    (result.data.files || []).forEach((item) => {
        const row = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = item.name;
        button.addEventListener("click", () => {
            openRemote(item.path).catch((error) => setStatus(error.message || "读取失败"));
        });
        row.append(button);
        list.append(row);
    });
    if (!list.childElementCount) setStatus("还没有已发布的文章。");
}

async function openRemote(path) {
    const session = await verifyWriter(readSession());
    const result = await proxy("/repo/read", { session: session.session, path });
    if (!result.ok) throw new Error(failureMessage(result.data, "没有读到这篇文章"));
    const parsed = parsePostDocument(result.data.content || "");
    const parts = splitPostPath(path);
    revokePreviews();
    state.draftId = crypto.randomUUID();
    state.existingPath = path;
    state.images = [];
    state.lastFingerprint = "";
    fill({ ...parsed, slug: parts?.slug || "" });
    renderImages();
    setStatus("已载入线上文章。发布时会覆盖原文件，网址不变。");
}

function lockStudio() {
    state.unlocked = false;
    state.loginAttempt += 1;
    const studio = document.querySelector("#studio");
    studio.hidden = true;
    document.querySelector("#remote-list").replaceChildren();
    document.querySelector("#draft-list").replaceChildren();
    const preview = document.querySelector("#preview");
    preview.hidden = true;
    preview.replaceChildren();
    revokePreviews();
    state.draftId = crypto.randomUUID();
    state.existingPath = "";
    state.images = [];
    state.remoteUrls = {};
    state.lastFingerprint = "";
    if (document.querySelector("#post-title")) fill({ date: new Date().toISOString().slice(0, 10) });
}

function showLoggedOut() {
    const configured = publishingConfigured(state.config);
    lockStudio();
    document.querySelector("#login").hidden = !configured;
    document.querySelector("#logout").hidden = true;
    document.querySelector("#device").hidden = true;
    document.querySelector("#who").textContent = writerGateMessage(state.config, state.configLoaded);
    setStatus("");
}

async function enterStudio(session) {
    state.unlocked = true;
    document.querySelector("#studio").hidden = false;
    document.querySelector("#login").hidden = true;
    document.querySelector("#logout").hidden = false;
    document.querySelector("#device").hidden = true;
    document.querySelector("#who").textContent = session.login ? `已登录 ${session.login}` : "已登录";
    setStatus("");
    const drafts = await renderDrafts();
    if (drafts[0]) loadDraft(drafts[0]);
    else resetEditor();
}

async function startLogin() {
    const attempt = ++state.loginAttempt;
    document.querySelector("#login").disabled = true;
    try {
        const started = await proxy("/login/device/code", {});
        if (attempt !== state.loginAttempt) return;
        if (!started.ok || !started.data.user_code || !started.data.device_code) {
            throw new Error(failureMessage(started.data, "无法开始 GitHub 登录"));
        }
        const device = document.querySelector("#device");
        device.hidden = false;
        document.querySelector("#user-code").textContent = started.data.user_code;
        document.querySelector("#verify-link").href = safeVerificationUri(started.data.verification_uri);
        setStatus("在 GitHub 页面输入验证码，然后回到这里。");
        let interval = Math.max(5, Number(started.data.interval) || 5) * 1000;
        const deadline = Date.now() + (Number(started.data.expires_in) || 900) * 1000;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, interval));
            if (attempt !== state.loginAttempt) return;
            const token = await proxy("/login/oauth/access_token", { device_code: started.data.device_code });
            if (attempt !== state.loginAttempt) return;
            if (token.data.session) {
                const session = await verifyWriter({ session: token.data.session, login: token.data.login || "" });
                writeSession(session);
                await enterStudio(session);
                setStatus("登录完成。发布凭证留在写作代理里，这个页面拿不到 GitHub 令牌。");
                return;
            }
            if (token.data.error === "authorization_pending") continue;
            if (token.data.error === "slow_down") {
                interval += 5000;
                continue;
            }
            throw new Error(failureMessage(token.data, "GitHub 没有完成授权"));
        }
        throw new Error("验证码过期了，请再试一次");
    } finally {
        document.querySelector("#login").disabled = false;
    }
}

let saveTimer = 0;
form.addEventListener("submit", (event) => event.preventDefault());
form.addEventListener("input", () => {
    updateSlugHint();
    if (!state.unlocked || state.publishing) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveDraft({ quiet: true }).catch((error) => setStatus(error.message || "草稿保存失败"));
    }, 600);
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
publishButton.addEventListener("click", () => {
    publish().catch((error) => setStatus(error.message || "发布失败"));
});
document.querySelector("#login").addEventListener("click", () => {
    startLogin().catch((error) => setStatus(error.message || "登录失败"));
});
document.querySelector("#logout").addEventListener("click", () => {
    writeSession(null);
    showLoggedOut();
    setStatus("已退出。这篇设备上的草稿还在，下次登录后才能再看到。");
});
document.querySelector("#copy-code").addEventListener("click", async () => {
    const code = document.querySelector("#user-code").textContent.trim();
    if (!code) return;
    try {
        await navigator.clipboard.writeText(code);
        setStatus("验证码已复制。");
    } catch {
        setStatus("请手动记下验证码。");
    }
});
document.querySelector("#image-input").addEventListener("change", (event) => {
    addImages(event.target.files).catch((error) => setStatus(error.message || "图片添加失败"));
    event.target.value = "";
});
document.querySelector("#post-body").addEventListener("paste", (event) => {
    if (!state.unlocked) return;
    const files = clipboardImageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    addImages(files).catch((error) => setStatus(error.message || "图片添加失败"));
});
document.querySelector("#load-remote").addEventListener("click", () => {
    loadRemoteList().catch((error) => setStatus(error.message || "读取失败"));
});

fill({ date: new Date().toISOString().slice(0, 10) });
fetch("/write/config.json", { cache: "no-store" })
    .then(async (response) => {
        const type = response.headers.get("content-type") || "";
        if (!response.ok || !type.includes("json")) throw new Error("config");
        return response.json();
    })
    .then(async (config) => {
        state.config = config;
        state.configLoaded = true;
        if (!publishingConfigured(config)) {
            showLoggedOut();
            return;
        }
        const existing = readSession();
        if (!existing) {
            showLoggedOut();
            return;
        }
        try {
            const session = await verifyWriter(existing);
            writeSession(session);
            await enterStudio(session);
        } catch {
            writeSession(null);
            showLoggedOut();
        }
    })
    .catch(() => {
        state.config = null;
        state.configLoaded = false;
        showLoggedOut();
    });
