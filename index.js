(function () {

  function parseMessage(str) {
    const tokens = str.trim().split(/\s+/);
    const receiver = tokens[0];
    const rest = tokens.slice(1);
    const keywords = [];
    const args = [];
    let currentArg = [];

    for (const token of rest) {
      if (token.endsWith(":")) {
        if (keywords.length > 0 && currentArg.length > 0) {
          args.push(currentArg.join(" "));
          currentArg = [];
        } else if (keywords.length > 0) {
          args.push("");
        }
        keywords.push(token);
      } else {
        currentArg.push(token);
      }
    }
    if (keywords.length > 0) {
      args.push(currentArg.join(" "));
    }

    return { receiver, selector: keywords.join(""), args };
  }

  function findReceiver(name) {
    return document.querySelector('[receiver="' + name + '"]');
  }

  function apply(el, op, content) {
    switch (op) {
      case "inner": el.innerHTML = content; break;
      case "text": el.textContent = content; break;
      case "append": el.innerHTML += content; break;
      case "outer": el.outerHTML = content; break;
    }
  }

  const methods = {
    "get:apply:": function (el, url, op) {
      fetch(url)
        .then(function (r) { return r.text(); })
        .then(function (text) { apply(el, op, text); });
    },
  };

  function send(msg) {
    const el = findReceiver(msg.receiver);
    if (!el) {
      console.error(msg.receiver + " not found");
      return;
    }
    const method = methods[msg.selector];
    if (!method) {
      console.error(msg.receiver + " does not understand " + msg.selector);
      return;
    }
    method(el, ...msg.args);
  }

  function dispatch(senderEl) {
    var raw = senderEl.getAttribute("sender");
    raw.split(";").forEach(function (part) {
      var trimmed = part.trim();
      if (trimmed) send(parseMessage(trimmed));
    });
  }

  document.addEventListener("click", function (e) {
    const sender = e.target.closest("[sender]");
    if (sender) dispatch(sender);
  });

}());
