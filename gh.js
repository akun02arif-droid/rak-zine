/* Kecil dan sederhana: menyimpan file ke repositori GitHub lewat API, dalam satu commit. */
(function (root) {
  "use strict";
  var API = "https://api.github.com";

  function GH(cfg, fetchFn) {
    var f = fetchFn || function () { return root.fetch.apply(root, arguments); };
    var branch = cfg.branch || "main";
    var base = API + "/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo);

    function api(path, method, body, accept) {
      var headers = {
        "Accept": accept || "application/vnd.github+json",
        "Authorization": "Bearer " + cfg.token,
        "X-GitHub-Api-Version": "2022-11-28"
      };
      var opt = { method: method || "GET", headers: headers, cache: "no-store" };
      if (body) { opt.body = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
      return f(base + path, opt).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var e = new Error("GitHub " + r.status);
            e.status = r.status; e.detail = t;
            throw e;
          });
        }
        return accept ? r.text() : r.json();
      });
    }

    function toPayload(file) {
      if (file.text != null) return Promise.resolve({ content: file.text, encoding: "utf-8" });
      if (file.base64 != null) return Promise.resolve({ content: file.base64, encoding: "base64" });
      return new Promise(function (res, rej) {
        var fr = new root.FileReader();
        fr.onload = function () { res({ content: String(fr.result).split(",")[1], encoding: "base64" }); };
        fr.onerror = function () { rej(new Error("Gagal membaca file")); };
        fr.readAsDataURL(file.blob);
      });
    }

    /* Cek token dan akses tulis ke repositori. */
    function check() { return api(""); }

    /* Baca file JSON di repositori; null kalau belum ada. */
    function readJson(path) {
      return api("/contents/" + path + "?ref=" + encodeURIComponent(branch), "GET", null, "application/vnd.github.raw+json")
        .then(function (t) { return JSON.parse(t); })
        .catch(function (e) { if (e && e.status === 404) return null; throw e; });
    }

    /* Satu commit: files = [{path, text | blob | base64}], deletes = [path]. */
    function commit(files, deletes, message, onProgress) {
      var parentSha, entries = [];
      return api("/git/ref/heads/" + encodeURIComponent(branch)).then(function (ref) {
        parentSha = ref.object.sha;
        return api("/git/commits/" + parentSha);
      }).then(function (c) {
        var baseTree = c.tree.sha, chain = Promise.resolve();
        files.forEach(function (file) {
          chain = chain.then(function () {
            return toPayload(file).then(function (p) { return api("/git/blobs", "POST", p); })
              .then(function (b) {
                entries.push({ path: file.path, mode: "100644", type: "blob", sha: b.sha });
                if (onProgress) onProgress(entries.length, files.length);
              });
          });
        });
        return chain.then(function () {
          (deletes || []).forEach(function (p) { entries.push({ path: p, mode: "100644", type: "blob", sha: null }); });
          return api("/git/trees", "POST", { base_tree: baseTree, tree: entries });
        });
      }).then(function (t) {
        return api("/git/commits", "POST", { message: message, tree: t.sha, parents: [parentSha] });
      }).then(function (nc) {
        return api("/git/refs/heads/" + encodeURIComponent(branch), "PATCH", { sha: nc.sha });
      });
    }

    return { check: check, readJson: readJson, commit: commit };
  }

  root.GH = GH;
  if (typeof module !== "undefined" && module.exports) module.exports = GH;
})(typeof window !== "undefined" ? window : globalThis);
