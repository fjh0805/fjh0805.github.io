(function () {
    var saved = null;
    try {
        saved = JSON.parse(sessionStorage.getItem("jh-write-session") || "null");
    } catch (error) {
        return;
    }
    if (!saved || typeof saved.session !== "string" || !saved.session) return;
    document.querySelectorAll("[data-manage-edit]").forEach(function (node) {
        node.hidden = false;
    });
})();
