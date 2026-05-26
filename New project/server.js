const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const PDF_PATH = path.join(ROOT, "protected", "document.pdf");
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const COOKIE_NAME = "kpv_session";
const ADMIN_COOKIE_NAME = "kpv_admin";

fs.mkdirSync(DATA_DIR, { recursive: true });

function now() {
  return new Date().toISOString();
}

function randomId(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function defaultStore() {
  return {
    createdAt: now(),
    settings: {
      adminPasswordHash: hash(ADMIN_PASSWORD)
    },
    codes: [],
    sessions: {},
    adminSessions: {}
  };
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) {
    const store = defaultStore();
    saveStore(store);
    return store;
  }
  const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  if (!store.settings) store.settings = {};
  if (!Object.prototype.hasOwnProperty.call(store.settings, "adminPasswordHash")) {
    store.settings.adminPasswordHash = hash(ADMIN_PASSWORD);
  }
  if (!store.codes) store.codes = [];
  if (!store.sessions) store.sessions = {};
  if (!store.adminSessions) store.adminSessions = {};
  return store;
}

function saveStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function getCookies(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(
    raw.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    })
  );
}

function setCookie(res, name, value, maxAgeDays = 365) {
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeDays * 86400}`);
}

function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
}

function redirect(res, location) {
  send(res, 302, "", { Location: location });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, "Not found");
    send(res, 200, data, {
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff"
    });
  });
}

function sessionInfo(req, store) {
  const sid = getCookies(req)[COOKIE_NAME];
  if (!sid || !store.sessions[sid]) return null;
  const session = store.sessions[sid];
  const code = store.codes.find((item) => item.code === session.code);
  if (!code || code.status !== "active") return null;
  return { sid, session, code };
}

function adminInfo(req, store) {
  const sid = getCookies(req)[ADMIN_COOKIE_NAME];
  if (!sid || !store.adminSessions[sid]) return null;
  return { sid, session: store.adminSessions[sid] };
}

function sanitizeCode(input) {
  return String(input || "").trim().toUpperCase();
}

function makeCode(prefix = "PDF") {
  const body = crypto.randomBytes(9).toString("base64url").replace(/[-_]/g, "").slice(0, 12).toUpperCase();
  return `${prefix}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

function publicCodeView(code) {
  return {
    code: code.code,
    status: code.status,
    createdAt: code.createdAt,
    boundAt: code.boundAt || "",
    lastSeen: code.lastSeen || "",
    deviceLabel: code.deviceLabel || "",
    deviceHash: code.deviceHash ? `${code.deviceHash.slice(0, 12)}...` : "",
    uses: code.uses || 0
  };
}

function adminPasswordIsValid(store, password) {
  const saved = store.settings.adminPasswordHash;
  if (saved === "") return true;
  return saved === hash(password || "");
}

async function handleApi(req, res, store, pathname) {
  if (req.method === "POST" && pathname === "/api/activate") {
    const body = await readJson(req);
    const codeValue = sanitizeCode(body.code);
    const deviceKey = String(body.deviceKey || "").trim();
    const deviceLabel = String(body.deviceLabel || "unknown").slice(0, 160);
    if (!codeValue || !deviceKey) return json(res, 400, { ok: false, message: "请输入卡密并允许浏览器保存设备信息。" });

    const code = store.codes.find((item) => item.code === codeValue);
    if (!code) return json(res, 403, { ok: false, message: "卡密不存在。" });
    if (code.status !== "active") return json(res, 403, { ok: false, message: "卡密已被封禁或停用。" });

    const deviceHash = hash(deviceKey);
    if (code.deviceHash && code.deviceHash !== deviceHash) {
      return json(res, 403, { ok: false, message: "这个卡密已经绑定到另一台设备。" });
    }

    code.deviceHash = code.deviceHash || deviceHash;
    code.deviceLabel = code.deviceLabel || deviceLabel;
    code.boundAt = code.boundAt || now();
    code.lastSeen = now();
    code.uses = (code.uses || 0) + 1;

    const sid = randomId();
    store.sessions[sid] = { code: code.code, deviceHash, createdAt: now(), lastSeen: now() };
    saveStore(store);
    setCookie(res, COOKIE_NAME, sid);
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/me") {
    const info = sessionInfo(req, store);
    if (!info) return json(res, 200, { ok: false });
    info.session.lastSeen = now();
    info.code.lastSeen = now();
    saveStore(store);
    return json(res, 200, { ok: true, code: info.code.code, watermark: `${info.code.code} | ${info.code.deviceLabel || "device"}` });
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const cookies = getCookies(req);
    if (cookies[COOKIE_NAME]) delete store.sessions[cookies[COOKIE_NAME]];
    saveStore(store);
    clearCookie(res, COOKIE_NAME);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    const body = await readJson(req);
    if (!adminPasswordIsValid(store, String(body.password || ""))) return json(res, 403, { ok: false, message: "管理员密码错误。" });
    const sid = randomId();
    store.adminSessions[sid] = { createdAt: now(), lastSeen: now() };
    saveStore(store);
    setCookie(res, ADMIN_COOKIE_NAME, sid, 7);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/admin/logout") {
    const cookies = getCookies(req);
    if (cookies[ADMIN_COOKIE_NAME]) delete store.adminSessions[cookies[ADMIN_COOKIE_NAME]];
    saveStore(store);
    clearCookie(res, ADMIN_COOKIE_NAME);
    return json(res, 200, { ok: true });
  }

  if (pathname.startsWith("/api/admin/")) {
    const admin = adminInfo(req, store);
    if (!admin) return json(res, 401, { ok: false, message: "请先登录后台。" });
    admin.session.lastSeen = now();
  }

  if (req.method === "GET" && pathname === "/api/admin/codes") {
    return json(res, 200, {
      ok: true,
      codes: store.codes.map(publicCodeView).reverse(),
      passwordEnabled: store.settings.adminPasswordHash !== ""
    });
  }

  if (req.method === "POST" && pathname === "/api/admin/password") {
    const body = await readJson(req);
    const nextPassword = String(body.password || "");
    store.settings.adminPasswordHash = nextPassword ? hash(nextPassword) : "";
    store.adminSessions = {};
    saveStore(store);
    clearCookie(res, ADMIN_COOKIE_NAME);
    return json(res, 200, { ok: true, passwordEnabled: Boolean(nextPassword) });
  }

  if (req.method === "POST" && pathname === "/api/admin/generate") {
    const body = await readJson(req);
    const count = Math.max(1, Math.min(200, Number(body.count || 1)));
    const prefix = String(body.prefix || "PDF").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() || "PDF";
    const made = [];
    while (made.length < count) {
      const code = makeCode(prefix);
      if (!store.codes.some((item) => item.code === code)) {
        store.codes.push({ code, status: "active", createdAt: now(), uses: 0 });
        made.push(code);
      }
    }
    saveStore(store);
    return json(res, 200, { ok: true, codes: made });
  }

  if (req.method === "POST" && pathname === "/api/admin/revoke") {
    const body = await readJson(req);
    const code = store.codes.find((item) => item.code === sanitizeCode(body.code));
    if (!code) return json(res, 404, { ok: false, message: "卡密不存在。" });
    code.status = "revoked";
    code.revokedAt = now();
    Object.keys(store.sessions).forEach((sid) => {
      if (store.sessions[sid].code === code.code) delete store.sessions[sid];
    });
    saveStore(store);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/admin/activate") {
    const body = await readJson(req);
    const code = store.codes.find((item) => item.code === sanitizeCode(body.code));
    if (!code) return json(res, 404, { ok: false, message: "卡密不存在。" });
    code.status = "active";
    saveStore(store);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/admin/unbind") {
    const body = await readJson(req);
    const code = store.codes.find((item) => item.code === sanitizeCode(body.code));
    if (!code) return json(res, 404, { ok: false, message: "卡密不存在。" });
    delete code.deviceHash;
    delete code.deviceLabel;
    delete code.boundAt;
    Object.keys(store.sessions).forEach((sid) => {
      if (store.sessions[sid].code === code.code) delete store.sessions[sid];
    });
    saveStore(store);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/admin/delete") {
    const body = await readJson(req);
    const codeValue = sanitizeCode(body.code);
    const beforeCount = store.codes.length;
    store.codes = store.codes.filter((item) => item.code !== codeValue);
    if (store.codes.length === beforeCount) return json(res, 404, { ok: false, message: "卡密不存在。" });
    Object.keys(store.sessions).forEach((sid) => {
      if (store.sessions[sid].code === codeValue) delete store.sessions[sid];
    });
    saveStore(store);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { ok: false, message: "接口不存在。" });
}

const server = http.createServer(async (req, res) => {
  const store = loadStore();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith("/api/")) return await handleApi(req, res, store, pathname);

    if (pathname === "/document.pdf") {
      if (!sessionInfo(req, store)) return redirect(res, "/");
      return serveFile(res, PDF_PATH, "application/pdf");
    }

    if (pathname === "/viewer") {
      if (!sessionInfo(req, store)) return redirect(res, "/");
      return serveFile(res, path.join(PUBLIC_DIR, "viewer.html"), "text/html; charset=utf-8");
    }

    if (pathname === "/" || pathname === "/index.html") {
      if (sessionInfo(req, store)) return redirect(res, "/viewer");
      return serveFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
    }

    if (pathname === "/admin") {
      return serveFile(res, path.join(PUBLIC_DIR, "admin.html"), "text/html; charset=utf-8");
    }

    const staticMap = {
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".mjs": "application/javascript; charset=utf-8",
      ".map": "application/json; charset=utf-8",
      ".ico": "image/x-icon"
    };
    const resolved = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (resolved.startsWith(PUBLIC_DIR) && fs.existsSync(resolved)) {
      return serveFile(res, resolved, staticMap[path.extname(resolved)] || "application/octet-stream");
    }

    send(res, 404, "Not found");
  } catch (error) {
    console.error(error);
    json(res, 500, { ok: false, message: "服务器错误。" });
  }
});

server.listen(PORT, () => {
  console.log(`User link:  http://localhost:${PORT}`);
  console.log(`Admin link: http://localhost:${PORT}/admin`);
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
});
