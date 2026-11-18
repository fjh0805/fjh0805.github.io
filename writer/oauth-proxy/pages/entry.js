import worker from "../src/index.js";

const POST_ROUTES = new Set([
    "/login/device/code",
    "/login/oauth/access_token",
    "/session/whoami",
    "/repo/list",
    "/repo/read",
    "/repo/write",
    "/repo/update"
]);

export function pagesHandles(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return true;
    if (request.method === "OPTIONS") return true;
    return request.method === "POST" && POST_ROUTES.has(url.pathname);
}

export function withPagesDefaults(env = {}) {
    return {
        ALLOWED_ORIGINS: "https://fjh0805.github.io",
        GITHUB_OWNER: "fjh0805",
        GITHUB_REPO: "fjh0805.github.io",
        GITHUB_BRANCH: "master",
        ALLOWED_LOGIN: "fjh0805",
        CLIENT_ID: "Ov23liCuomd3yYskOX3l",
        ...env
    };
}

export default {
    async fetch(request, env, ctx) {
        const filled = withPagesDefaults(env);
        if (!pagesHandles(request) && filled.ASSETS && typeof filled.ASSETS.fetch === "function") {
            return filled.ASSETS.fetch(request);
        }
        return worker.fetch(request, filled, ctx);
    }
};
