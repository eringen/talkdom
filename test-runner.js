// Tests intentionally create rejected promises (e.g. confirm cancel).
// Match browser behavior: warn instead of crashing.
process.on("unhandledRejection", function () {});

var JSDOM = require("jsdom").JSDOM;
var fs = require("fs");
var path = require("path");

var indexJs = fs.readFileSync(path.join(__dirname, "index.js"), "utf-8");
var testJs = fs.readFileSync(path.join(__dirname, "test.js"), "utf-8");

var dom = new JSDOM(
  '<!DOCTYPE html><html><head><title>talkDOM tests</title></head>' +
  '<body><div id="fixture"></div><div id="output"></div></body></html>',
  { url: "http://localhost", runScripts: "dangerously", pretendToBeVisual: true }
);

var window = dom.window;

// Make fetch overridable so test mocks work (jsdom may define it as non-writable)
delete window.fetch;

var s1 = window.document.createElement("script");
s1.textContent = indexJs;
window.document.head.appendChild(s1);

var s2 = window.document.createElement("script");
s2.textContent = testJs;
window.document.head.appendChild(s2);

var timeout = setTimeout(function () {
  console.error("Tests timed out after 30s");
  process.exit(1);
}, 30000);

var check = setInterval(function () {
  if (window.document.title.indexOf("\u2013") !== -1) {
    clearInterval(check);
    clearTimeout(timeout);

    var output = window.document.getElementById("output");
    var lines = [];
    for (var i = 0; i < output.childNodes.length; i++) {
      lines.push(output.childNodes[i].textContent);
    }
    console.log(lines.join("\n"));

    var failed = window.document.title.charAt(0) === "\u2717";
    process.exit(failed ? 1 : 0);
  }
}, 50);
