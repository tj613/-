(function () {
  const loginPanel = document.getElementById("loginPanel");
  const adminPanel = document.getElementById("adminPanel");
  const loginForm = document.getElementById("adminLoginForm");
  const loginMessage = document.getElementById("adminLoginMessage");
  const generateForm = document.getElementById("generateForm");
  const generatedCodes = document.getElementById("generatedCodes");
  const codesBody = document.getElementById("codesBody");
  const logoutBtn = document.getElementById("adminLogoutBtn");
  const passwordForm = document.getElementById("passwordForm");
  const passwordMessage = document.getElementById("passwordMessage");

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    return response.json();
  }

  function showAdmin() {
    loginPanel.classList.add("hidden");
    adminPanel.classList.remove("hidden");
  }

  function showLogin() {
    loginPanel.classList.remove("hidden");
    adminPanel.classList.add("hidden");
  }

  function fmt(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  async function loadCodes() {
    const result = await api("/api/admin/codes");
    if (!result.ok) {
      showLogin();
      return;
    }
    showAdmin();
    codesBody.innerHTML = "";
    result.codes.forEach((code) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><code>${code.code}</code></td>
        <td><span class="status ${code.status}">${code.status === "active" ? "启用" : "封禁"}</span></td>
        <td title="${code.deviceLabel || ""}">${code.deviceHash || "未绑定"}</td>
        <td>${fmt(code.boundAt)}</td>
        <td>${fmt(code.lastSeen)}</td>
        <td>${code.uses || 0}</td>
        <td class="actions"></td>
      `;
      const actions = row.querySelector(".actions");
      const revoke = document.createElement("button");
      revoke.textContent = code.status === "active" ? "封禁" : "启用";
      revoke.className = "small-button";
      revoke.addEventListener("click", async () => {
        await api(code.status === "active" ? "/api/admin/revoke" : "/api/admin/activate", {
          method: "POST",
          body: JSON.stringify({ code: code.code })
        });
        loadCodes();
      });
      const unbind = document.createElement("button");
      unbind.textContent = "解绑";
      unbind.className = "small-button";
      unbind.addEventListener("click", async () => {
        await api("/api/admin/unbind", {
          method: "POST",
          body: JSON.stringify({ code: code.code })
        });
        loadCodes();
      });
      const remove = document.createElement("button");
      remove.textContent = "删除";
      remove.className = "small-button danger-button";
      remove.addEventListener("click", async () => {
        if (!confirm(`确定删除卡密 ${code.code} 吗？删除后不可恢复。`)) return;
        await api("/api/admin/delete", {
          method: "POST",
          body: JSON.stringify({ code: code.code })
        });
        loadCodes();
      });
      actions.append(revoke, unbind, remove);
      codesBody.append(row);
    });
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginMessage.textContent = "正在登录...";
    const result = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: document.getElementById("adminPassword").value })
    });
    if (result.ok) {
      loginMessage.textContent = "";
      loadCodes();
    } else {
      loginMessage.textContent = result.message || "登录失败。";
    }
  });

  generateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/admin/generate", {
      method: "POST",
      body: JSON.stringify({
        prefix: document.getElementById("prefix").value,
        count: document.getElementById("count").value
      })
    });
    if (result.ok) {
      generatedCodes.value = result.codes.join("\n");
      loadCodes();
    }
  });

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = document.getElementById("newAdminPassword").value;
    const prompt = password ? "确定要修改后台密码吗？修改后需要重新登录。" : "确定要删除后台密码吗？删除后任何能打开后台链接的人都可以进入。";
    if (!confirm(prompt)) return;
    const result = await api("/api/admin/password", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    if (result.ok) {
      passwordMessage.textContent = password ? "密码已修改，请重新登录。" : "密码已删除，请重新登录。";
      setTimeout(showLogin, 700);
    } else {
      passwordMessage.textContent = result.message || "保存失败。";
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" });
    showLogin();
  });

  loadCodes();
})();
