(function() {

  let target = null;
  function reqListener() {
    if (target) {
      target.innerHTML = this.responseText;
    }
  }

  const body = document.querySelector("body");

  body.addEventListener("click", (e) => {
    const el = e.target.closest("[eringen]");
    if (el) {
      const attr = el.getAttribute("eringen").split(' ');
      target = document.querySelector(el.getAttribute("eringen-target"));
      methods[attr[0]]?.(...attr.slice(1)) ?? console.error(`unknown message: ${attr[0]}`);
    }
  });

  const req = new XMLHttpRequest();
  req.addEventListener("load", reqListener);

  const methods = {
    get: (url) => { req.open("GET", url); req.send(); return true },
  }

}());

