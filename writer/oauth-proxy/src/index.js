import { openToken, sealToken } from "./session.js";
import { listPosts, readPost, updateManaged, verifyPublisher, writeRepoFile } from "./github.js";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const SCOPE = "public_repo";
const MAX_SMALL_BYTES = 4096;
const MAX_WRITE_BYTES = 2000000;

const ROUTES = {
    "/login/device/code": DEVICE_CODE_URL,
    "/login/oauth/access_token": ACCESS_TOKEN_URL
};

export function parseAllowlist(value) {
    return String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

export function resolveUpstream(pathname) {
    return ROUTES[pathname] || "";
}

export function isOriginAllowed(origin, allowlist) {
    return Boolean(origin) && allowlist.includes(origin);
}

function corsHeaders(origin) {
    return {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type, accept",
        "access-control-max-age": "600",
        "cache-control": "no-store",
        vary: "Origin"
    };
}

function json(status, payload, extraHeaders = {}) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            ...extraHeaders
        }
    });
}

async function readBody(request, max) {
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > max) return { error: "body_too_large" };
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > max) return { error: "body_too_large" };
    return { text: new TextDecoder().decode(buffer) };
}

function readJson(text) {
    if (!text) return {};
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("json");
    return data;
}

async function authorizeSession(session, env) {
    if (!env.SESSION_KEY) return { ok: false, status: 503, error: "proxy_not_configured" };
    let token = "";
    try {
        token = await openToken(session, env.SESSION_KEY);
    } catch {
        return { ok: false, status: 401, error: "unauthorized" };
    }
    try {
        const verdict = await verifyPublisher(token, env);
        if (!verdict.ok) return { ok: false, status: verdict.status === 401 ? 401 : 403, error: verdict.status === 401 ? "unauthorized" : "not_authorized" };
        return { ok: true, auth: verdict };
    } catch {
        return { ok: false, status: 502, error: "upstream_failed" };
    }
}

async function startDeviceFlow(env) {
    if (!env.CLIENT_ID || !env.SESSION_KEY) return json(503, { error: "proxy_not_configured" });
    let upstream;
    try {
        upstream = await fetch(DEVICE_CODE_URL, {
            method: "POST",
            headers: {
                accept: "application/json",
                "content-type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({ client_id: env.CLIENT_ID, scope: SCOPE })
        });
    } catch {
        return json(502, { error: "upstream_failed" });
    }
    const text = await upstream.text();
    let payload = null;
    try {
        payload = JSON.parse(text);
    } catch {
        payload = null;
    }
    if (!upstream.ok || !payload || typeof payload.user_code !== "string" || typeof payload.device_code !== "string") {
        return json(502, { error: "upstream_failed" });
    }
    if (payload.user_code.length > 32 || payload.device_code.length > 80) {
        return json(502, { error: "upstream_failed" });
    }
    return json(200, {
        user_code: payload.user_code,
        device_code: payload.device_code,
        verification_uri: payload.verification_uri || "https://github.com/login/device",
        expires_in: Number(payload.expires_in) || 900,
        interval: Number(payload.interval) || 5
    });
}

async function finishDeviceFlow(deviceCode, env) {
    if (!env.CLIENT_ID || !env.SESSION_KEY) return json(503, { error: "proxy_not_configured" });
    if (!/^[A-Za-z0-9]{20,80}$/.test(deviceCode)) return json(400, { error: "incorrect_device_code" });
    let upstream;
    try {
        upstream = await fetch(ACCESS_TOKEN_URL, {
            method: "POST",
            headers: {
                accept: "application/json",
                "content-type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                client_id: env.CLIENT_ID,
                device_code: deviceCode,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code"
            })
        });
    } catch {
        return json(502, { error: "upstream_failed" });
    }
    const text = await upstream.text();
    let payload = null;
    try {
        payload = JSON.parse(text);
    } catch {
        payload = null;
    }
    if (!payload || typeof payload !== "object") return json(502, { error: "upstream_failed" });
    if (!payload.access_token) {
        return json(upstream.ok ? 200 : upstream.status, { error: payload.error || "authorization_pending" });
    }
    let verdict;
    try {
        verdict = await verifyPublisher(payload.access_token, env);
    } catch {
        return json(502, { error: "upstream_failed" });
    }
    if (!verdict.ok) return json(403, { error: "not_authorized" });
    try {
        const session = await sealToken(payload.access_token, env.SESSION_KEY);
        return json(200, { ok: true, session, login: verdict.login });
    } catch {
        return json(503, { error: "proxy_not_configured" });
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get("origin") || "";
        const allowlist = parseAllowlist(env?.ALLOWED_ORIGINS);
        const cors = origin ? corsHeaders(origin) : {};

        if (request.method === "GET" && url.pathname === "/health") {
            return json(200, { ok: true });
        }

        if (request.method === "OPTIONS") {
            if (!isOriginAllowed(origin, allowlist)) return json(403, { error: "origin_not_allowed" });
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
        if (!resolveUpstream(url.pathname) && !["/session/whoami", "/repo/list", "/repo/read", "/repo/write", "/repo/update"].includes(url.pathname)) {
            return json(404, { error: "not_found" });
        }
        if (!isOriginAllowed(origin, allowlist)) return json(403, { error: "origin_not_allowed" });

        const limit = url.pathname === "/repo/write" || url.pathname === "/repo/update" ? MAX_WRITE_BYTES : MAX_SMALL_BYTES;
        const body = await readBody(request, limit);
        if (body.error) return json(413, { error: body.error }, cors);

        try {
            if (url.pathname === "/login/device/code") {
                const response = await startDeviceFlow(env || {});
                const headers = new Headers(response.headers);
                for (const [key, value] of Object.entries(cors)) headers.set(key, value);
                return new Response(response.body, { status: response.status, headers });
            }

            const data = readJson(body.text);
            if (url.pathname === "/login/oauth/access_token") {
                const response = await finishDeviceFlow(String(data.device_code || ""), env || {});
                const headers = new Headers(response.headers);
                for (const [key, value] of Object.entries(cors)) headers.set(key, value);
                return new Response(response.body, { status: response.status, headers });
            }

            const session = await authorizeSession(data.session, env || {});
            if (!session.ok) return json(session.status, { error: session.error }, cors);

            if (url.pathname === "/session/whoami") {
                return json(200, { ok: true, login: session.auth.login }, cors);
            }
            if (url.pathname === "/repo/list") {
                const result = await listPosts(session.auth);
                return json(result.status, result.body, cors);
            }
            if (url.pathname === "/repo/read") {
                const result = await readPost(session.auth, data.path);
                return json(result.status, result.body, cors);
            }
            if (url.pathname === "/repo/write") {
                const result = await writeRepoFile(session.auth, {
                    path: data.path,
                    message: data.message,
                    content: data.content,
                    sha: data.sha
                });
                return json(result.status, result.body, cors);
            }
            if (url.pathname === "/repo/update") {
                const result = await updateManaged(session.auth, data);
                return json(result.status, result.body, cors);
            }
        } catch (error) {
            console.error(JSON.stringify({
                message: "request failed",
                path: url.pathname,
                error: error instanceof Error ? error.name : "unknown"
            }));
            return json(400, { error: "bad_request" }, cors);
        }

        return json(404, { error: "not_found" }, cors);
    }
};
