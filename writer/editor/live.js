import { EditorState, RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment } from "@codemirror/state";
import { safeImageSrc } from "./images.js";

export { safeImageSrc };

const refreshImages = StateEffect.define();

class ImageWidget extends WidgetType {
    constructor(src, alt) {
        super();
        this.src = src;
        this.alt = alt;
    }

    eq(other) {
        return other.src === this.src && other.alt === this.alt;
    }

    ignoreEvent() {
        return true;
    }

    toDOM() {
        const image = document.createElement("img");
        image.className = "live-image";
        image.alt = this.alt;
        image.src = this.src;
        return image;
    }
}

class BulletWidget extends WidgetType {
    eq() {
        return true;
    }

    ignoreEvent() {
        return true;
    }

    toDOM() {
        const mark = document.createElement("span");
        mark.className = "live-bullet";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = "•";
        return mark;
    }
}

function revealed(state, from, to) {
    return state.selection.ranges.some((range) => {
        if (range.empty) return range.head >= from && range.head <= to;
        return range.from < to && range.to > from;
    });
}

function childText(node, name, doc) {
    for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.name === name) return doc.sliceString(child.from, child.to);
    }
    return "";
}

export function buildLiveDecorations(state, resolveImage) {
    const builder = new RangeSetBuilder();
    const ranges = [];
    const doc = state.doc;
    const add = (from, to, deco) => {
        if (from < to) ranges.push({ from, to, deco });
    };

    syntaxTree(state).iterate({
        enter(node) {
            if (node.name === "Image") {
                const raw = doc.sliceString(node.from, node.to);
                const matched = raw.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
                const src = matched ? safeImageSrc(matched[2], resolveImage) : "";
                if (src && !revealed(state, node.from, node.to)) {
                    add(node.from, node.to, Decoration.replace({
                        widget: new ImageWidget(src, matched[1])
                    }));
                }
                return false;
            }

            if (node.name === "FencedCode") {
                add(node.from, node.to, Decoration.mark({ class: "cm-codeblock" }));
                return false;
            }

            if (node.name === "ATXHeading1" || node.name === "ATXHeading2" || node.name === "ATXHeading3") {
                const level = node.name.slice(-1);
                const mark = node.node.firstChild;
                if (mark && mark.name === "HeaderMark" && !revealed(state, mark.from, mark.to)) {
                    const hideTo = doc.sliceString(mark.to, mark.to + 1) === " " ? mark.to + 1 : mark.to;
                    add(mark.from, hideTo, Decoration.replace({}));
                }
                const textFrom = mark ? mark.to + (doc.sliceString(mark.to, mark.to + 1) === " " ? 1 : 0) : node.from;
                add(textFrom, node.to, Decoration.mark({ class: `cm-h${level}` }));
                return false;
            }

            if (node.name === "StrongEmphasis" || node.name === "Emphasis") {
                const marks = [];
                for (let child = node.node.firstChild; child; child = child.nextSibling) {
                    if (child.name === "EmphasisMark") marks.push(child);
                }
                if (marks.length >= 2 && !revealed(state, node.from, node.to)) {
                    add(marks[0].from, marks[0].to, Decoration.replace({}));
                    add(marks[marks.length - 1].from, marks[marks.length - 1].to, Decoration.replace({}));
                }
                if (marks.length >= 2) {
                    add(marks[0].to, marks[marks.length - 1].from, Decoration.mark({
                        class: node.name === "StrongEmphasis" ? "cm-strong" : "cm-em"
                    }));
                }
                return false;
            }

            if (node.name === "InlineCode") {
                const marks = [];
                for (let child = node.node.firstChild; child; child = child.nextSibling) {
                    if (child.name === "CodeMark") marks.push(child);
                }
                if (marks.length >= 2 && !revealed(state, node.from, node.to)) {
                    add(marks[0].from, marks[0].to, Decoration.replace({}));
                    add(marks[marks.length - 1].from, marks[marks.length - 1].to, Decoration.replace({}));
                    add(marks[0].to, marks[marks.length - 1].from, Decoration.mark({ class: "cm-code" }));
                } else {
                    add(node.from, node.to, Decoration.mark({ class: "cm-code" }));
                }
                return false;
            }

            if (node.name === "Link") {
                const url = childText(node, "URL", doc);
                if (!revealed(state, node.from, node.to)) {
                    for (let child = node.node.firstChild; child; child = child.nextSibling) {
                        if (child.name === "LinkMark" || child.name === "URL") add(child.from, child.to, Decoration.replace({}));
                    }
                }
                const open = node.node.firstChild;
                const close = open && open.nextSibling;
                if (open && close && open.name === "LinkMark") {
                    add(open.to, close.from, Decoration.mark({ class: "cm-link" }));
                }
                if (url.startsWith("javascript:") || url.startsWith("data:")) return false;
                return false;
            }

            if (node.name === "Blockquote") {
                if (!revealed(state, node.from, node.to)) {
                    let textFrom = node.from;
                    for (let child = node.node.firstChild; child; child = child.nextSibling) {
                        if (child.name === "QuoteMark") {
                            const to = doc.sliceString(child.to, child.to + 1) === " " ? child.to + 1 : child.to;
                            add(child.from, to, Decoration.replace({}));
                            textFrom = to;
                        }
                    }
                    add(textFrom, node.to, Decoration.mark({ class: "cm-quote" }));
                } else {
                    add(node.from, node.to, Decoration.mark({ class: "cm-quote" }));
                }
                return false;
            }

            if (node.name === "ListMark" && node.node.parent?.parent?.name === "BulletList") {
                if (!revealed(state, node.from, node.to)) {
                    const to = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
                    add(node.from, to, Decoration.replace({ widget: new BulletWidget() }));
                }
                return false;
            }

            return undefined;
        }
    });

    ranges.sort((a, b) => a.from - b.from || a.to - b.to);
    let cursor = 0;
    for (const range of ranges) {
        if (range.from < cursor) continue;
        builder.add(range.from, range.to, range.deco);
        cursor = range.to;
    }
    return builder.finish();
}

function livePlugin(resolveImage) {
    return ViewPlugin.fromClass(class {
        constructor(view) {
            this.decorations = buildLiveDecorations(view.state, resolveImage);
        }

        update(update) {
            const refreshed = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshImages)));
            const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state);
            if (update.docChanged || update.selectionSet || update.viewportChanged || refreshed || treeChanged) {
                this.decorations = buildLiveDecorations(update.state, resolveImage);
            }
        }
    }, { decorations: (value) => value.decorations });
}

const theme = EditorView.theme({
    "&": {
        backgroundColor: "transparent",
        color: "var(--ink)"
    },
    "&.cm-focused": {
        outline: "none"
    },
    ".cm-scroller": {
        fontFamily: "inherit",
        lineHeight: "1.75"
    },
    ".cm-content": {
        fontFamily: "var(--serif)",
        fontSize: "1.2rem",
        padding: "0.15rem 0 0.8rem",
        minHeight: "16rem",
        caretColor: "var(--accent)"
    },
    ".cm-line": {
        padding: "0"
    },
    ".cm-placeholder": {
        color: "#b7afa3",
        fontFamily: "var(--serif)"
    },
    ".cm-h1": {
        fontSize: "1.7rem",
        fontWeight: "500",
        letterSpacing: "-0.03em",
        lineHeight: "1.3"
    },
    ".cm-h2": {
        fontSize: "1.4rem",
        fontWeight: "500",
        lineHeight: "1.35"
    },
    ".cm-h3": {
        fontSize: "1.2rem",
        fontWeight: "600"
    },
    ".cm-strong": {
        fontWeight: "700"
    },
    ".cm-em": {
        fontStyle: "italic"
    },
    ".cm-code": {
        fontFamily: "var(--mono)",
        fontSize: "0.92em",
        backgroundColor: "var(--code-bg)",
        borderRadius: "0.3em",
        padding: "0.05em 0.28em"
    },
    ".cm-codeblock": {
        fontFamily: "var(--mono)",
        fontSize: "0.92rem",
        lineHeight: "1.6",
        backgroundColor: "var(--code-bg)",
        borderRadius: "0.7rem"
    },
    ".cm-link": {
        color: "var(--accent)",
        textDecoration: "underline",
        textUnderlineOffset: "0.15em"
    },
    ".cm-quote": {
        color: "var(--ink-soft)"
    },
    ".live-image": {
        display: "block",
        maxWidth: "100%",
        height: "auto",
        margin: "0.45rem 0",
        borderRadius: "0.85rem"
    },
    ".live-bullet": {
        color: "var(--accent)",
        paddingRight: "0.35rem"
    }
});

function plainPaste(event, view, onPasteImages) {
    const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
    if (!files.length && event.clipboardData?.items) {
        for (const item of event.clipboardData.items) {
            if (item.kind === "file" && item.type.startsWith("image/")) {
                const file = item.getAsFile();
                if (file) files.push(file);
            }
        }
    }
    if (files.length) {
        event.preventDefault();
        onPasteImages(files);
        return true;
    }
    if (!event.clipboardData) return false;
    const text = event.clipboardData.getData("text/plain");
    event.preventDefault();
    if (text) view.dispatch(view.state.replaceSelection(text.replace(/\r\n/g, "\n")));
    return true;
}

export function createWriterEditor(parent, options) {
    const live = new Compartment();
    const plugin = livePlugin((id) => options.resolveImage?.(id) || "");
    let source = false;
    let applying = false;
    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc: options.value || "",
            extensions: [
                markdown(),
                history(),
                keymap.of([...defaultKeymap, ...historyKeymap]),
                EditorView.lineWrapping,
                theme,
                placeholder("写下来。可以直接粘贴图片。"),
                EditorView.contentAttributes.of({
                    "aria-label": "正文",
                    autocapitalize: "off",
                    autocorrect: "on",
                    spellcheck: "true"
                }),
                EditorView.domEventHandlers({
                    paste(event, editor) {
                        return plainPaste(event, editor, options.onPasteImages || (() => {}));
                    },
                    drop(event, editor) {
                        const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("image/"));
                        if (!files.length) return false;
                        event.preventDefault();
                        (options.onPasteImages || (() => {}))(files);
                        return true;
                    }
                }),
                live.of(plugin),
                EditorView.updateListener.of((update) => {
                    if (applying || !update.docChanged) return;
                    options.onChange?.(update.state.doc.toString());
                })
            ]
        })
    });

    return {
        getMarkdown() {
            return view.state.doc.toString();
        },
        setMarkdown(value) {
            const next = String(value ?? "");
            if (next === view.state.doc.toString()) {
                view.dispatch({ effects: refreshImages.of(null) });
                return;
            }
            applying = true;
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: next },
                effects: refreshImages.of(null)
            });
            applying = false;
        },
        insert(text) {
            const next = String(text ?? "");
            view.dispatch(view.state.replaceSelection(next));
            view.focus();
        },
        focus() {
            view.focus();
        },
        setSourceMode(on) {
            source = Boolean(on);
            view.dispatch({ effects: live.reconfigure(source ? [] : plugin) });
        },
        sourceMode() {
            return source;
        },
        refreshImages() {
            view.dispatch({ effects: refreshImages.of(null) });
        },
        dom() {
            return view.dom;
        },
        destroy() {
            view.destroy();
        }
    };
}
