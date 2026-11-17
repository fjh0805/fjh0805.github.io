const NEW_POST = /^_posts\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const EXISTING_POST = /^_posts\/[^/\\?#%]+\.md$/;
const IMAGE = /^img\/posts\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9][a-z0-9.-]*\.(png|jpe?g|gif|webp)$/;

export function isExistingPostPath(path) {
    return typeof path === "string" && EXISTING_POST.test(path) && !path.includes("..");
}

export function isPublishablePath(path) {
    if (typeof path !== "string" || path.includes("..") || path.startsWith("/") || path.includes("\\")) return false;
    return NEW_POST.test(path) || isExistingPostPath(path) || IMAGE.test(path);
}

export function assertOwner(login, owner) {
    if (!login || !owner || String(login).toLowerCase() !== String(owner).toLowerCase()) {
        throw new Error("当前 GitHub 账号不能发布到这个站点");
    }
}

export function hasRepoWritePermission(repository) {
    const permissions = repository && repository.permissions;
    if (!permissions || typeof permissions !== "object") return false;
    return permissions.push === true || permissions.maintain === true || permissions.admin === true;
}

export function extensionForImage(type) {
    if (type === "image/png") return "png";
    if (type === "image/gif") return "gif";
    if (type === "image/webp") return "webp";
    if (type === "image/jpeg" || type === "image/jpg") return "jpg";
    return "";
}

export function clipboardImageFiles(clipboard) {
    if (!clipboard) return [];
    const collected = [];
    const push = (file) => {
        if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) return;
        collected.push(file);
    };
    if (clipboard.files) {
        for (const file of clipboard.files) push(file);
    }
    if (!collected.length && clipboard.items) {
        for (const item of clipboard.items) {
            if (item && item.kind === "file" && typeof item.getAsFile === "function") push(item.getAsFile());
        }
    }
    return collected;
}

export function imagesStillToUpload(images) {
    return (images || []).filter((image) => image && !image.remotePath);
}

export function publishFingerprint(input) {
    return JSON.stringify({
        title: String(input.title ?? ""),
        subtitle: String(input.subtitle ?? ""),
        date: String(input.date ?? ""),
        tags: input.tags || [],
        slug: String(input.slug ?? ""),
        body: String(input.body ?? ""),
        existingPath: String(input.existingPath ?? "")
    });
}

export function safeVerificationUri(value) {
    try {
        const url = new URL(value || "");
        if (url.origin === "https://github.com" && url.pathname === "/login/device") return url.toString();
    } catch {
        /* use the fixed device page */
    }
    return "https://github.com/login/device";
}

export function safeCommitUrl(value) {
    try {
        const url = new URL(value || "");
        if (url.protocol !== "https:" || url.hostname !== "github.com") return "";
        if (!url.pathname.startsWith("/fjh0805/fjh0805.github.io/")) return "";
        return url.toString();
    } catch {
        return "";
    }
}
