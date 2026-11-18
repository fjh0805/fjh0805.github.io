import {
    assertOwner,
    buildPostDocument,
    defaultPostSlug,
    extensionForImage,
    imageMagicMatches,
    imagePath,
    isPortraitPath,
    imagesStillToUpload,
    parsePostDocument,
    parseTagInput,
    publishFingerprint,
    publishingConfigured,
    replaceDraftImages,
    safeCommitUrl,
    GITHUB_DEVICE_URL,
    openVerificationTab,
    safeVerificationUri,
    slugify,
    splitPostPath,
    utf8ToBase64,
    writerGateMessage,
    isExistingPostPath
} from "./write-core.js";
import { LINKS_PATH, normalizeLinks, normalizeProfilePatch, PROFILE_PATH } from "./content-docs.js";
import { createWriterEditor } from "./write-editor.js";

const SESSION_KEY = "jh-write-session";
const state = {
    config: null,
    configLoaded: false,
    unlocked: false,
    publishing: false,
    sourceMode: false,
    slugEdited: false,
    loginAttempt: 0,
    draftId: crypto.randomUUID(),
    existingPath: "",
    baseSha: "",
    profileSha: "",
    linksSha: "",
    editorMode: "post",
    authWindow: null,
    pendingPortrait: null,
    savedPortrait: "",
    images: [],
    remoteUrls: {},
    lastFingerprint: ""
};

const statusNode = document.querySelector("#status");
const form = document.querySelector("#editor");
const publishButton = document.querySelector("#publish");
let bodyEditor = null;

function bodyText() {
    return bodyEditor ? bodyEditor.getMarkdown() : (document.querySelector("#post-body")?.value || "");
}

function setBodyText(value) {
    const text = String(value ?? "");
    const area = document.querySelector("#post-body");
    if (area) area.value = text;
    bodyEditor?.setMarkdown(text);
}

const saveNode = document.querySelector("#save-state");

function setStatus(message) {
    statusNode.replaceChildren();
    if (!message) {
        statusNode.hidden = true;
        return;
    }
    statusNode.hidden = false;
    statusNode.append(document.createTextNode(message));
}

function setSave(message) {
    if (saveNode) saveNode.textContent = message || "";
}

function dockStatus(writing) {
    const slot = document.querySelector(writing ? "#status-dock" : "#status-slot");
    if (slot && statusNode.parentElement !== slot) slot.append(statusNode);
}

function setWriting(on) {
    document.querySelector(".write-page").classList.toggle("is-writing", on);
    dockStatus(on);
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
        body: bodyText()
    };
}

function fill(data) {
    document.querySelector("#post-title").value = data.title || "";
    document.querySelector("#post-subtitle").value = data.subtitle || "";
    document.querySelector("#post-date").value = (data.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    document.querySelector("#post-tags").value = (data.tags || []).join(", ");
    document.querySelector("#post-slug").value = data.slug || "";
    setBodyText(data.body || "");
    ensureSlug();
}

function ensureSlug(force = false) {
    const input = document.querySelector("#post-slug");
    if (!state.existingPath) {
        const current = slugify(input.value);
        if (force || !current) {
            input.value = state.slugEdited && current
                ? current
                : defaultPostSlug(document.querySelector("#post-title").value, state.draftId);
        }
    }
    updateSlugHint();
}

function updateSlugHint() {
    const hint = document.querySelector("#slug-preview");
    const summary = document.querySelector("#settings-summary");
    const date = document.querySelector("#post-date").value;
    const tags = parseTagInput(document.querySelector("#post-tags").value);
    if (summary) summary.textContent = [date, tags.join("、")].filter(Boolean).join(" · ");
    const slugInput = document.querySelector("#post-slug");
    if (slugInput) slugInput.readOnly = Boolean(state.existingPath);
    if (publishButton && !state.publishing) publishButton.textContent = state.existingPath ? "保存" : "发布";
    if (state.existingPath) {
        hint.textContent = "保存后仍用原来的文件和网址。先看正文里的排版，再点保存。";
        return;
    }
    const slug = slugify(document.querySelector("#post-slug").value);
    hint.textContent = slug && date ? `保存为 _posts/${date}-${slug}.md` : "";
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
    if (!options.quiet) setSave("已保存在这台设备");
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
    state.baseSha = "";
    showPanel("post");
    state.images = (draft.images || []).map((image) => ({
        id: image.id,
        filename: image.filename,
        blob: image.blob,
        remotePath: image.remotePath || "",
        previewUrl: ""
    }));
    state.remoteUrls = {};
    state.lastFingerprint = "";
    state.slugEdited = Boolean(draft.slug);
    fill(draft);
    renderImages();
    setSourceMode(false);
    setSave("已打开草稿");
    setStatus("");
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
    state.baseSha = "";
    state.images = [];
    state.remoteUrls = {};
    state.lastFingerprint = "";
    state.slugEdited = false;
    showPanel("post");
    fill({ date: new Date().toISOString().slice(0, 10) });
    renderImages();
    setSourceMode(false);
    document.querySelector("#post-title").focus();
}

function setSourceMode(on) {
    state.sourceMode = Boolean(on);
    bodyEditor?.setSourceMode(state.sourceMode);
    const button = document.querySelector("#preview-toggle");
    if (!button) return;
    button.textContent = state.sourceMode ? "排版" : "源码";
    button.setAttribute("aria-pressed", state.sourceMode ? "true" : "false");
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
        name.textContent = image.filename;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "移除图片");
        remove.addEventListener("click", () => {
            if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
            state.images = state.images.filter((item) => item.id !== image.id);
            setBodyText(bodyText().replace(new RegExp(`!\\[[^\\]]*\\]\\(draft:${image.id}\\)\\n?`), ""));
            renderImages();
        });
        item.append(thumb, name, remove);
        list.append(item);
    });
    bodyEditor?.refreshImages();
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
    if (bodyEditor) {
        bodyEditor.insert(text);
        return;
    }
    const body = document.querySelector("#post-body");
    const start = body.selectionStart ?? body.value.length;
    body.setRangeText(text, start, body.selectionEnd ?? start, "end");
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
    await saveDraft({ quiet: true });
    setSave(added > 1 ? `已插入 ${added} 张图片` : "已插入图片");
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
    const url = `${state.config.oauthProxy.replace(/\/$/, "")}${path}`;
    let response;
    try {
        // This content type is CORS-safelisted, so the browser sends one POST.
        // A JSON content type forces a preflight; if that OPTIONS never completes,
        // the browser only reports a fetch failure and hides the status.
        response = await fetch(url, {
            method: "POST",
            mode: "cors",
            credentials: "omit",
            cache: "no-store",
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            body: JSON.stringify(payload ?? {})
        });
    } catch (error) {
        const detail = error && error.message ? error.message : "网络错误";
        throw new Error(`浏览器没有连上写作代理。${detail}`);
    }
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
    if (data?.error === "conflict") return "内容刚被改过，请重新打开后再保存";
    if (data?.error === "use_update") return "已有文章要在这里保存";
    if (data?.error === "bad_document" || data?.error === "bad_link" || data?.error === "bad_text") return "有些内容还不能保存";
    if (data?.error === "bad_image" || data?.error === "bad_portrait") return "这张照片不能用";
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
    ensureSlug(true);
    const current = fields();
    const fingerprint = publishFingerprint({ ...current, existingPath: state.existingPath });
    const referenced = referencedImageIds(current.body);
    const pending = imagesStillToUpload(state.images.filter((image) => referenced.includes(image.id)));
    if (state.lastFingerprint === fingerprint && pending.length === 0) {
        setStatus("这篇刚才已经发布。");
        return;
    }
    state.publishing = true;
    publishButton.disabled = true;
    publishButton.textContent = "发布中";
    setStatus("正在发布");
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
        const queue = state.images.filter((image) => referenced.includes(image.id));
        let uploaded = 0;
        const pendingCount = queue.filter((image) => !image.remotePath).length;
        for (const image of queue) {
            if (!image.remotePath) {
                uploaded += 1;
                setStatus(pendingCount > 1 ? `正在上传图片 ${uploaded}/${pendingCount}` : "正在上传图片");
                const path = imagePath(slug, image.filename);
                await putFile(session.session, path, await blobToBase64(image.blob), `添加图片 ${path}`);
                image.remotePath = `/${path}`;
                await saveDraft({ quiet: true, duringPublish: true });
            }
            mapping[image.id] = image.remotePath;
        }
        setStatus(state.existingPath ? "正在保存" : "正在发布");
        const updating = Boolean(state.existingPath);
        const body = replaceDraftImages(current.body, mapping);
        let result;
        if (state.existingPath) {
            if (!state.baseSha) throw new Error("请从文章列表重新打开后再保存");
            result = await proxy("/repo/update", {
                session: session.session,
                kind: "post",
                path: state.existingPath,
                sha: state.baseSha,
                title: current.title,
                subtitle: current.subtitle,
                date: current.date,
                tags: current.tags,
                body
            });
            if (!result.ok) throw new Error(failureMessage(result.data, "文章没有保存"));
            result = result.data;
            state.baseSha = result.sha || "";
        } else {
            const doc = buildPostDocument({
                ...current,
                body,
                author: "JH"
            });
            result = await putFile(
                session.session,
                doc.path,
                utf8ToBase64(doc.markdown),
                `发布：${current.title.trim()}`.slice(0, 180)
            );
            state.existingPath = doc.path;
        }
        setBodyText(body);
        state.images = [];
        state.lastFingerprint = publishFingerprint({ ...fields(), existingPath: state.existingPath });
        renderImages();
        updateSlugHint();
        await saveDraft({ quiet: true, duringPublish: true });
        setStatus(updating ? "已保存。页面更新还要等一会儿。" : "已发布。主页更新还要等一会儿。");
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
        setStatus(kept ? `${message} 再点发布会继续。` : message);
    } finally {
        state.publishing = false;
        publishButton.disabled = false;
        publishButton.textContent = "发布";
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
    const fillList = (node) => {
        node.replaceChildren();
        (result.data.files || []).forEach((item) => {
            const row = document.createElement("li");
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = item.name.replace(/\.md$/, "");
            button.addEventListener("click", () => {
                openRemote(item.path).catch((error) => setStatus(error.message || "读取失败"));
            });
            row.append(button);
            node.append(row);
        });
    };
    fillList(list);
    fillList(document.querySelector("#post-shelf"));
    if (!list.childElementCount) setStatus("还没有已发布的文章。");
}

async function openRemote(path) {
    const session = await verifyWriter(readSession());
    const result = await proxy("/repo/read", { session: session.session, path });
    if (!result.ok) throw new Error(failureMessage(result.data, "没有读到这篇文章"));
    if (!result.data.sha) throw new Error("写作代理还没更新，暂时不能保存修改");
    const parsed = parsePostDocument(result.data.content || "");
    const parts = splitPostPath(path);
    revokePreviews();
    state.draftId = crypto.randomUUID();
    state.existingPath = path;
    state.baseSha = result.data.sha;
    state.images = [];
    state.lastFingerprint = "";
    state.slugEdited = true;
    showPanel("post");
    fill({ ...parsed, slug: parts?.slug || "" });
    renderImages();
    setSourceMode(false);
    setStatus("已打开这篇文章。看完排版后再保存。");
}

function closeWindow(target) {
    if (!target) return;
    try {
        target.close();
    } catch {
        /* the tab is already gone */
    }
    if (state.authWindow === target) state.authWindow = null;
}

function replaceAuthWindow(next) {
    const previous = state.authWindow;
    state.authWindow = next || null;
    if (previous && previous !== next) closeWindow(previous);
}

function clearDevicePrompt() {
    const code = document.querySelector("#user-code");
    if (code) code.textContent = "";
    const link = document.querySelector("#verify-link");
    if (link) link.href = GITHUB_DEVICE_URL;
    const device = document.querySelector("#device");
    if (device) device.hidden = true;
}

function lockStudio() {
    closeWindow(state.authWindow);
    clearDevicePrompt();
    state.unlocked = false;
    state.loginAttempt += 1;
    state.slugEdited = false;
    setWriting(false);
    setSourceMode(false);
    setSave("");
    const studio = document.querySelector("#studio");
    studio.hidden = true;
    document.querySelector("#remote-list").replaceChildren();
    document.querySelector("#post-shelf").replaceChildren();
    document.querySelector("#draft-list").replaceChildren();
    revokePreviews();
    state.draftId = crypto.randomUUID();
    state.existingPath = "";
    state.baseSha = "";
    state.profileSha = "";
    state.linksSha = "";
    showPanel("post");
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

function readRequest() {
    const params = new URLSearchParams(window.location.search);
    const edit = params.get("edit");
    const post = params.get("post") || "";
    if (edit === "profile" || edit === "links") return { edit };
    if (isExistingPostPath(post)) return { post };
    return {};
}

function showPanel(mode) {
    state.editorMode = mode;
    document.querySelector("#editor").hidden = mode !== "post";
    document.querySelector(".composer").hidden = mode !== "post";
    document.querySelector("#profile-panel").hidden = mode !== "profile";
    document.querySelector("#links-panel").hidden = mode !== "links";
}

function pairLines(items, left, right) {
    return (items || []).map((item) => `${item[left] || ""} | ${item[right] || ""}`).join("\n");
}

function parsePairLines(text, left, right) {
    return String(text || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
        const split = line.indexOf("|");
        if (split < 0) return { [left]: line, [right]: "" };
        return { [left]: line.slice(0, split).trim(), [right]: line.slice(split + 1).trim() };
    });
}

function localeFrom(prefix) {
    return {
        lead: document.querySelector(`#profile-${prefix}-lead`).value,
        paragraphs: document.querySelector(`#profile-${prefix}-paragraphs`).value.split("\n").map((line) => line.trim()).filter(Boolean),
        quote: document.querySelector(`#profile-${prefix}-quote`).value,
        motto: document.querySelector(`#profile-${prefix}-motto`).value,
        links: parsePairLines(document.querySelector(`#profile-${prefix}-links`).value, "title", "href"),
        stack: parsePairLines(document.querySelector(`#profile-${prefix}-stack`).value, "label", "value")
    };
}

function fillLocale(prefix, locale) {
    document.querySelector(`#profile-${prefix}-lead`).value = locale?.lead || "";
    document.querySelector(`#profile-${prefix}-paragraphs`).value = (locale?.paragraphs || []).join("\n");
    document.querySelector(`#profile-${prefix}-quote`).value = locale?.quote || "";
    document.querySelector(`#profile-${prefix}-motto`).value = locale?.motto || "";
    document.querySelector(`#profile-${prefix}-links`).value = pairLines(locale?.links, "title", "href");
    document.querySelector(`#profile-${prefix}-stack`).value = pairLines(locale?.stack, "label", "value");
}

function profileFromForm() {
    return normalizeProfilePatch({
        name: document.querySelector("#profile-name").value,
        school: document.querySelector("#profile-school").value,
        quote: document.querySelector("#profile-quote").value,
        email: document.querySelector("#profile-email").value,
        github: document.querySelector("#profile-github").value,
        zh: localeFrom("zh"),
        en: localeFrom("en")
    });
}

function renderProfilePreview() {
    const node = document.querySelector("#profile-preview");
    let profile;
    try {
        profile = profileFromForm();
    } catch {
        node.textContent = "还有字段需要改成合法的文字或链接。";
        return null;
    }
    node.replaceChildren();
    const heading = document.createElement("p");
    heading.textContent = `${profile.name} · ${profile.quote}`;
    const lead = document.createElement("p");
    lead.textContent = profile.zh.lead;
    node.append(heading, lead);
    profile.zh.paragraphs.forEach((paragraph) => {
        const line = document.createElement("p");
        line.textContent = paragraph;
        node.append(line);
    });
    return profile;
}

function linksFromForm() {
    return normalizeLinks(parsePairLines(document.querySelector("#home-links").value, "title", "href"));
}

function renderLinksPreview() {
    const node = document.querySelector("#links-preview");
    let links;
    try {
        links = linksFromForm();
    } catch {
        node.textContent = "每行需要一个标题，以及 https 或邮箱地址。";
        return null;
    }
    const list = document.createElement("ul");
    links.forEach((link) => {
        const item = document.createElement("li");
        item.textContent = `${link.title} · ${link.href}`;
        list.append(item);
    });
    node.replaceChildren(list);
    return links;
}

function displayPortrait(path) {
    return typeof path === "string" && /^\/img\/[A-Za-z0-9./_-]+\.(png|jpe?g|gif|webp)$/.test(path) && !path.includes("..")
        ? path
        : "";
}

function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
}

function clearPendingPortrait() {
    if (state.pendingPortrait?.previewUrl) URL.revokeObjectURL(state.pendingPortrait.previewUrl);
    state.pendingPortrait = null;
}

async function stagePortrait(file) {
    if (!file || file.size > 8 * 1024 * 1024) throw new Error("照片太大");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = extensionForImage(file.type);
    if (!ext || !imageMagicMatches(bytes, ext)) throw new Error("请换 JPG、PNG、GIF 或 WebP");
    const previewUrl = URL.createObjectURL(new Blob([bytes], { type: file.type }));
    const size = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("这张照片打不开"));
        image.src = previewUrl;
    });
    if (size.width < 32 || size.height < 32 || size.width > 12000 || size.height > 12000) {
        URL.revokeObjectURL(previewUrl);
        throw new Error("照片尺寸不合适");
    }
    clearPendingPortrait();
    state.pendingPortrait = { bytes, ext, previewUrl, width: size.width, height: size.height };
    const preview = document.querySelector("#portrait-preview");
    preview.src = previewUrl;
    preview.width = size.width;
    preview.height = size.height;
    setStatus("这是本地预览。保存简介后才会上传，原来的照片文件还在。");
}

async function openProfile() {
    const session = await verifyWriter(readSession());
    const result = await proxy("/repo/read", { session: session.session, path: PROFILE_PATH });
    if (!result.ok || !result.data.document || !result.data.sha) {
        throw new Error(failureMessage(result.data, "没有读到简介"));
    }
    const profile = result.data.document;
    document.querySelector("#profile-name").value = profile.name || "";
    document.querySelector("#profile-school").value = profile.school || "";
    document.querySelector("#profile-quote").value = profile.quote || "";
    document.querySelector("#profile-email").value = profile.email || "";
    document.querySelector("#profile-github").value = profile.github || "";
    fillLocale("zh", profile.zh);
    fillLocale("en", profile.en);
    clearPendingPortrait();
    const current = displayPortrait(profile.portrait?.path);
    state.savedPortrait = current;
    const preview = document.querySelector("#portrait-preview");
    preview.src = current;
    if (profile.portrait?.alt) preview.alt = profile.portrait.alt;
    if (profile.portrait?.width) preview.width = profile.portrait.width;
    if (profile.portrait?.height) preview.height = profile.portrait.height;
    state.profileSha = result.data.sha;
    showPanel("profile");
    renderProfilePreview();
    setStatus("先看预览，再保存简介。");
}

async function openLinks() {
    const session = await verifyWriter(readSession());
    const result = await proxy("/repo/read", { session: session.session, path: LINKS_PATH });
    if (!result.ok || !result.data.sha) throw new Error(failureMessage(result.data, "没有读到主页链接"));
    document.querySelector("#home-links").value = pairLines(result.data.links, "title", "href");
    state.linksSha = result.data.sha;
    showPanel("links");
    renderLinksPreview();
    setStatus("先看预览，再保存链接。");
}

async function saveProfile() {
    const profile = renderProfilePreview();
    if (!profile) return;
    if (!state.profileSha) throw new Error("请重新打开简介再保存");
    const button = document.querySelector("#save-profile");
    button.disabled = true;
    try {
        const session = await verifyWriter(readSession());
        let uploaded = "";
        if (state.pendingPortrait) {
            const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
            const repoPath = `img/portrait/${id}.${state.pendingPortrait.ext}`;
            if (!isPortraitPath(repoPath)) throw new Error("照片路径不合法");
            setStatus("正在上传照片");
            try {
                await putFile(session.session, repoPath, bytesToBase64(state.pendingPortrait.bytes), "更换个人照片");
            } catch (error) {
                throw new Error(`${error.message || "照片没有上传"} 原来的照片还在。`);
            }
            uploaded = `/${repoPath}`;
            profile.portrait = {
                path: uploaded,
                width: state.pendingPortrait.width,
                height: state.pendingPortrait.height
            };
        }
        setStatus("正在保存简介");
        const result = await proxy("/repo/update", {
            session: session.session,
            kind: "profile",
            path: PROFILE_PATH,
            sha: state.profileSha,
            profile
        });
        if (!result.ok) {
            const message = failureMessage(result.data, "简介没有保存");
            throw new Error(uploaded ? `${message} 新照片没有用上，原来的照片还在。` : message);
        }
        state.profileSha = result.data.sha || "";
        if (uploaded) state.savedPortrait = uploaded;
        clearPendingPortrait();
        setStatus("简介已保存。页面更新还要等一会儿。");
    } finally {
        button.disabled = false;
    }
}

async function saveLinks() {
    const links = renderLinksPreview();
    if (!links) return;
    if (!state.linksSha) throw new Error("请重新打开链接再保存");
    const button = document.querySelector("#save-links");
    button.disabled = true;
    try {
        const session = await verifyWriter(readSession());
        const result = await proxy("/repo/update", {
            session: session.session,
            kind: "links",
            path: LINKS_PATH,
            sha: state.linksSha,
            links
        });
        if (!result.ok) throw new Error(failureMessage(result.data, "链接没有保存"));
        state.linksSha = result.data.sha || "";
        setStatus("链接已保存。页面更新还要等一会儿。");
    } finally {
        button.disabled = false;
    }
}

async function enterStudio(session) {
    state.unlocked = true;
    document.querySelector("#studio").hidden = false;
    document.querySelector("#login").hidden = true;
    document.querySelector("#logout").hidden = false;
    document.querySelector("#device").hidden = true;
    document.querySelector("#who").textContent = session.login || "";
    setWriting(true);
    showPanel("post");
    setStatus("");
    const drafts = await renderDrafts();
    const request = readRequest();
    try {
        await loadRemoteList();
    } catch (error) {
        setStatus(error.message || "没有读到文章列表");
    }
    if (request.edit === "profile") {
        await openProfile();
        return;
    }
    if (request.edit === "links") {
        await openLinks();
        return;
    }
    if (request.post) {
        await openRemote(request.post);
        return;
    }
    if (drafts[0]) loadDraft(drafts[0]);
    else resetEditor();
}

async function startLogin(tab) {
    const attempt = ++state.loginAttempt;
    const owned = tab && tab.window ? tab.window : null;
    replaceAuthWindow(tab && !tab.blocked ? owned : null);
    const loginButton = document.querySelector("#login");
    loginButton.disabled = true;
    const link = document.querySelector("#verify-link");
    link.href = GITHUB_DEVICE_URL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    try {
        const started = await proxy("/login/device/code", {});
        if (attempt !== state.loginAttempt) return;
        if (!started.ok || !started.data.user_code || !started.data.device_code) {
            closeWindow(owned);
            throw new Error(failureMessage(started.data, "无法开始 GitHub 登录"));
        }
        const device = document.querySelector("#device");
        device.hidden = false;
        document.querySelector("#user-code").textContent = started.data.user_code;
        link.href = safeVerificationUri(started.data.verification_uri);
        setStatus(tab && tab.blocked
            ? "浏览器拦住了新标签。请点「打开 GitHub」，这个页面会留在这里。"
            : "授权页已在新标签打开。在那边输入验证码，再回到这里。");
        let interval = Math.max(5, Number(started.data.interval) || 5) * 1000;
        const deadline = Date.now() + (Number(started.data.expires_in) || 900) * 1000;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, interval));
            if (attempt !== state.loginAttempt) return;
            const token = await proxy("/login/oauth/access_token", { device_code: started.data.device_code });
            if (attempt !== state.loginAttempt) return;
            if (token.data.session) {
                closeWindow(owned);
                clearDevicePrompt();
                const session = await verifyWriter({ session: token.data.session, login: token.data.login || "" });
                writeSession(session);
                await enterStudio(session);
                setStatus("");
                return;
            }
            if (token.data.error === "authorization_pending") continue;
            if (token.data.error === "slow_down") {
                interval += 5000;
                continue;
            }
            closeWindow(owned);
            clearDevicePrompt();
            throw new Error(failureMessage(token.data, "GitHub 没有完成授权"));
        }
        closeWindow(owned);
        clearDevicePrompt();
        throw new Error("验证码过期了，请再试一次");
    } finally {
        loginButton.disabled = false;
    }
}

let saveTimer = 0;
function scheduleSave() {
    if (!state.unlocked || state.publishing) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveDraft({ quiet: true })
            .then(() => setSave("已保存在这台设备"))
            .catch((error) => setStatus(error.message || "草稿保存失败"));
    }, 600);
}

bodyEditor = createWriterEditor(document.querySelector("#writer-surface"), {
    value: "",
    resolveImage(id) {
        const image = state.images.find((item) => item.id === id);
        if (!image) return "";
        if (!image.previewUrl && image.blob) image.previewUrl = URL.createObjectURL(image.blob);
        return image.previewUrl || image.remotePath || "";
    },
    onChange(text) {
        const area = document.querySelector("#post-body");
        if (area) area.value = text;
        scheduleSave();
    },
    onPasteImages(files) {
        addImages(files).catch((error) => setStatus(error.message || "图片添加失败"));
    }
});

form.addEventListener("submit", (event) => event.preventDefault());
form.addEventListener("input", (event) => {
    if (event.target.id === "post-slug") state.slugEdited = true;
    if (event.target.id === "post-title" && !state.slugEdited && !state.existingPath) {
        document.querySelector("#post-slug").value = defaultPostSlug(event.target.value, state.draftId);
    }
    updateSlugHint();
    scheduleSave();
});

document.querySelector("#new-draft").addEventListener("click", () => {
    resetEditor();
    setSave("");
    setStatus("");
});
document.querySelector("#open-new").addEventListener("click", () => {
    resetEditor();
    setSave("");
    setStatus("");
});
document.querySelector("#open-profile").addEventListener("click", () => {
    openProfile().catch((error) => setStatus(error.message || "没有读到简介"));
});
document.querySelector("#open-links").addEventListener("click", () => {
    openLinks().catch((error) => setStatus(error.message || "没有读到主页链接"));
});
document.querySelector("#save-profile").addEventListener("click", () => {
    saveProfile().catch((error) => setStatus(error.message || "简介没有保存"));
});
document.querySelector("#save-links").addEventListener("click", () => {
    saveLinks().catch((error) => setStatus(error.message || "链接没有保存"));
});
document.querySelector("#profile-panel").addEventListener("input", () => renderProfilePreview());
document.querySelector("#portrait-input").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    stagePortrait(file).catch((error) => setStatus(error.message || "照片没有读到"));
});
document.querySelector("#home-links").addEventListener("input", () => renderLinksPreview());
document.querySelector("#preview-toggle").addEventListener("click", () => setSourceMode(!state.sourceMode));
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
    const tab = openVerificationTab();
    startLogin(tab).catch((error) => setStatus(error.message || "登录失败"));
});
document.querySelector("#logout").addEventListener("click", () => {
    writeSession(null);
    showLoggedOut();
    setStatus("已退出。");
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
document.querySelector("#post-slug").addEventListener("blur", () => ensureSlug(true));
document.querySelector("#image-input").addEventListener("change", (event) => {
    addImages(event.target.files).catch((error) => setStatus(error.message || "图片添加失败"));
    event.target.value = "";
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
