export function safeImageSrc(url, lookup) {
    const value = String(url ?? "").trim();
    if (value.startsWith("draft:")) {
        const src = lookup ? lookup(value.slice(6)) : "";
        if (typeof src !== "string" || !src) return "";
        if (src.startsWith("blob:") || src.startsWith("/") || src.startsWith("https:") || src.startsWith("http:")) {
            if (src.startsWith("/") && (src.startsWith("//") || src.includes(".."))) return "";
            return src;
        }
        return "";
    }
    if (value.startsWith("/") && !value.startsWith("//") && !value.includes("..")) return value;
    try {
        const parsed = new URL(value);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.toString();
    } catch {
        return "";
    }
    return "";
}
