const VERSION = "v1";

function bytesToBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
    const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

async function importKey(encoded, usage) {
    const bytes = base64UrlToBytes(String(encoded || "").trim());
    if (bytes.length !== 32) throw new Error("session key");
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [usage]);
}

export async function sealToken(token, encodedKey) {
    const key = await importKey(encodedKey, "encrypt");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(String(token))
    ));
    return `${VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(cipher)}`;
}

export async function openToken(session, encodedKey) {
    const parts = String(session || "").split(".");
    if (parts.length !== 3 || parts[0] !== VERSION) throw new Error("session");
    const key = await importKey(encodedKey, "decrypt");
    const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64UrlToBytes(parts[1]) },
        key,
        base64UrlToBytes(parts[2])
    );
    const token = new TextDecoder().decode(plain);
    if (!token) throw new Error("session");
    return token;
}
