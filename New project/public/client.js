(function () {
  const form = document.getElementById("activationForm");
  const message = document.getElementById("message");
  const codeInput = document.getElementById("code");

  function getDeviceKey() {
    const key = "kpv_device_key";
    let value = localStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      localStorage.setItem(key, value);
    }
    return value;
  }

  function deviceLabel() {
    return [
      navigator.platform || "platform",
      navigator.userAgent || "browser",
      screen.width + "x" + screen.height,
      Intl.DateTimeFormat().resolvedOptions().timeZone || "timezone"
    ].join(" | ");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "正在验证...";
    const response = await fetch("/api/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: codeInput.value,
        deviceKey: getDeviceKey(),
        deviceLabel: deviceLabel()
      })
    });
    const result = await response.json();
    if (result.ok) {
      location.href = "/viewer";
    } else {
      message.textContent = result.message || "验证失败。";
    }
  });
})();
