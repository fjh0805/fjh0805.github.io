const ROUTES = {
    "/login/device/code": "https://github.com/login/device/code",
    "/login/oauth/access_token": "https://github.com/login/oauth/access_token"
};

const MAX_REQUEST_BYTES = 4096;
const MAX_RESPONSE_BYTES = 65536;

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
        vary: "Origin"
    };
}

function json(status, payload, extraHeaders = {}) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders }
    });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get("origin") || "";
        const allowlist = parseAllowlist(env?.ALLOWED_ORIGINS);

        if (request.method === "GET" && url.pathname === "/health") {
            return json(200, { ok: true });
        }

        if (request.method === "OPTIONS") {
            if (!isOriginAllowed(origin, allowlist)) return json(403, { error: "origin_not_allowed" });
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

        const upstream = resolveUpstream(url.pathname);
        if (!upstream) return json(404, { error: "not_found" });
        if (!isOriginAllowed(origin, allowlist)) return json(403, { error: "origin_not_allowed" });

        const declaredLength = Number(request.headers.get("content-length") || 0);
        if (declaredLength > MAX_REQUEST_BYTES) return json(413, { error: "body_too_large" }, corsHeaders(origin));

        const body = await request.arrayBuffer();
        if (body.byteLength > MAX_REQUEST_BYTES) return json(413, { error: "body_too_large" }, corsHeaders(origin));

        let upstreamResponse;
        try {
            upstreamResponse = await fetch(upstream, {
                method: "POST",
                headers: {
                    accept: request.headers.get("accept") || "application/json",
                    "content-type": request.headers.get("content-type") || "application/x-www-form-urlencoded"
                },
                body
            });
        } catch (error) {
            console.error(JSON.stringify({
                message: "upstream failed",
                path: url.pathname,
                error: error instanceof Error ? error.message : "unknown"
            }));
            return json(502, { error: "upstream_failed" }, corsHeaders(origin));
        }

        const responseBody = await upstreamResponse.arrayBuffer();
        console.log(JSON.stringify({
            message: "forwarded",
            path: url.pathname,
            status: upstreamResponse.status
        }));
        if (responseBody.byteLength > MAX_RESPONSE_BYTES) {
            return json(502, { error: "upstream_too_large" }, corsHeaders(origin));
        }

        const headers = {
            ...corsHeaders(origin),
            "content-type": upstreamResponse.headers.get("content-type") || "application/json; charset=utf-8"
        };
        return new Response(responseBody, { status: upstreamResponse.status, headers });
    }
};
