(function () {
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.querySelector("#site-nav");

    if (toggle && nav) {
        toggle.addEventListener("click", function () {
            var open = toggle.getAttribute("aria-expanded") === "true";
            toggle.setAttribute("aria-expanded", String(!open));
            nav.classList.toggle("is-open", !open);
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                toggle.setAttribute("aria-expanded", "false");
                nav.classList.remove("is-open");
            }
        });

        nav.querySelectorAll("a").forEach(function (link) {
            link.addEventListener("click", function () {
                if (window.matchMedia("(max-width: 720px)").matches) {
                    toggle.setAttribute("aria-expanded", "false");
                    nav.classList.remove("is-open");
                }
            });
        });
    }

    document.querySelectorAll(".prose table").forEach(function (table) {
        if (table.parentElement && table.parentElement.classList.contains("table-scroll")) return;
        var wrap = document.createElement("div");
        wrap.className = "table-scroll";
        table.before(wrap);
        wrap.appendChild(table);
    });

    var toc = document.querySelector("#toc");
    var prose = document.querySelector(".prose");
    if (toc && prose) {
        var tocNav = toc.querySelector("nav");
        var headings = prose.querySelectorAll("h2, h3");
        if (!headings.length || !tocNav) {
            toc.remove();
        } else {
            headings.forEach(function (heading) {
                if (!heading.id) {
                    heading.id = heading.textContent.trim().toLowerCase().replace(/\s+/g, "-");
                }
                var link = document.createElement("a");
                link.href = "#" + heading.id;
                link.textContent = heading.textContent.trim();
                if (heading.tagName === "H3") link.className = "toc-sub";
                tocNav.appendChild(link);
            });
            toc.hidden = false;
            var wide = window.matchMedia("(min-width: 900px)");
            var sync = function () { toc.open = wide.matches; };
            sync();
            if (wide.addEventListener) wide.addEventListener("change", sync);
        }
    }

    var panels = document.querySelectorAll("[data-lang-panel]");
    var switchers = document.querySelectorAll("[data-lang]");

    function applyLang(lang) {
        panels.forEach(function (panel) {
            panel.hidden = panel.getAttribute("data-lang-panel") !== lang;
        });
        switchers.forEach(function (button) {
            button.setAttribute("aria-pressed", String(button.getAttribute("data-lang") === lang));
        });
    }

    if (panels.length) {
        applyLang(location.hash === "#en" ? "en" : "zh");
        switchers.forEach(function (button) {
            button.addEventListener("click", function () {
                var lang = button.getAttribute("data-lang");
                applyLang(lang);
                history.replaceState(null, "", lang === "en" ? "#en" : "#zh");
            });
        });
    }
})();
