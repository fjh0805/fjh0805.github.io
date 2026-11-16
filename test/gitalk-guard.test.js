import assert from "node:assert/strict";
import test from "node:test";
import {
    gitalkGuardDecision,
    gitalkGuardMessage,
    gitalkRetryHref
} from "../js/gitalk-guard.js";

test("retry drops the oauth code and keeps the page", () => {
    assert.equal(
        gitalkRetryHref("https://fjh0805.github.io/about/?code=stub&foo=1#zh"),
        "/about/?foo=1#zh"
    );
    assert.equal(gitalkRetryHref("https://fjh0805.github.io/about/?code=stub"), "/about/");
    assert.equal(gitalkRetryHref("https://fjh0805.github.io/about/"), "/about/");
});

test("loading stays unresolved until an error or the deadline", () => {
    assert.equal(gitalkGuardDecision({ loading: true, errorText: "" }, 1000, 12000), "");
    assert.equal(gitalkGuardDecision({ loading: true, errorText: "Error: Network Error" }, 100, 12000), "error");
    assert.equal(gitalkGuardDecision({ loading: true, errorText: "" }, 12000, 12000), "timeout");
    assert.equal(gitalkGuardDecision({ loading: false, errorText: "" }, 12000, 12000), "");
});

test("guard copy does not contain a credential", () => {
    const message = gitalkGuardMessage("timeout");
    assert.match(message, /加载中/);
    assert.match(message, /gitalk\.proxy/);
    assert.equal(/ghp_|github_pat_|client_secret/i.test(message), false);
});
