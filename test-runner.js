// Tests intentionally create rejected promises (e.g. confirm cancel).
// Match browser behavior: warn instead of crashing.
process.on("unhandledRejection", function () {});

import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const indexJs = fs.readFileSync(path.join(__dirname, "dist", "talkdom.min.js"), "utf-8");
const testJs = fs.readFileSync(path.join(__dirname, "test.js"), "utf-8");

const dom = new JSDOM(
  '<!DOCTYPE html><html><head><title>talkDOM tests</title></head>' +
  '<body><div id="fixture"></div><div id="output"></div></body></html>',
  { url: "http://localhost", runScripts: "dangerously", pretendToBeVisual: true }
);

const window = dom.window;

// Make fetch overridable so test mocks work (jsdom may define it as non-writable)
delete window.fetch;

const s1 = window.document.createElement("script");
s1.textContent = indexJs;
window.document.head.appendChild(s1);

const s2 = window.document.createElement("script");
s2.textContent = testJs;
window.document.head.appendChild(s2);

const timeout = setTimeout(function () {
  console.error("Tests timed out after 30s");
  process.exit(1);
}, 30000);

const check = setInterval(function () {
  if (window.document.title.indexOf("\u2013") !== -1) {
    clearInterval(check);
    clearTimeout(timeout);

    const output = window.document.getElementById("output");
    const lines = [];
    for (let i = 0; i < output.childNodes.length; i++) {
      lines.push(output.childNodes[i].textContent);
    }
    console.log(lines.join("\n"));

    const failed = window.document.title.charAt(0) === "\u2717";
    process.exit(failed ? 1 : 0);
  }
}, 50);
