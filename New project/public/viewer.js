import * as pdfjsLib from "/vendor/pdf.legacy.min.mjs";

(async function () {
  const viewerCode = document.getElementById("viewerCode");
  const watermarkLayer = document.getElementById("watermarkLayer");
  const privacyMask = document.getElementById("privacyMask");
  const logoutBtn = document.getElementById("logoutBtn");
  const pdfPages = document.getElementById("pdfPages");

  pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.legacy.min.mjs";

  const response = await fetch("/api/me", { cache: "no-store" });
  const result = await response.json();
  if (!result.ok) {
    location.href = "/";
    return;
  }

  viewerCode.textContent = result.code;

  function paintWatermarks() {
    const text = `${result.watermark} | ${new Date().toLocaleString()}`;
    watermarkLayer.innerHTML = "";
    for (let index = 0; index < 28; index += 1) {
      const mark = document.createElement("span");
      mark.textContent = text;
      watermarkLayer.append(mark);
    }
  }

  function showLoadMessage(text, isError = false) {
    const className = isError ? "loading error" : "loading";
    pdfPages.innerHTML = `<div class="${className}">${text}</div>`;
  }

  async function renderPdf() {
    showLoadMessage("Loading document...");
    try {
      const pdf = await pdfjsLib.getDocument({
        url: "/document.pdf",
        disableAutoFetch: true,
        disableStream: true,
        isEvalSupported: false
      }).promise;

      pdfPages.innerHTML = "";
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(280, pdfPages.clientWidth - 28);
        const cssWidth = Math.min(960, availableWidth, baseViewport.width);
        const deviceRatio = Math.min(window.devicePixelRatio || 1, /Android|iPhone|iPad/i.test(navigator.userAgent) ? 1.25 : 1.75);
        const renderScale = (cssWidth / baseViewport.width) * deviceRatio;
        const viewport = page.getViewport({ scale: renderScale });

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${Math.floor((baseViewport.height / baseViewport.width) * cssWidth)}px`;
        canvas.className = "pdf-page";
        canvas.setAttribute("aria-label", `Page ${pageNumber}`);
        pdfPages.append(canvas);

        await page.render({ canvasContext: context, viewport }).promise;
      }
    } catch (error) {
      console.error(error);
      showLoadMessage("Document failed to load. Please refresh or log in again.", true);
    }
  }

  function hideTemporarily() {
    privacyMask.classList.add("visible");
  }

  function showAgain() {
    privacyMask.classList.remove("visible");
  }

  paintWatermarks();
  renderPdf();

  document.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("selectstart", (event) => event.preventDefault());
  window.addEventListener("blur", hideTemporarily);
  window.addEventListener("focus", showAgain);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hideTemporarily();
    else showAgain();
  });
  window.addEventListener("beforeprint", hideTemporarily);
  window.addEventListener("afterprint", showAgain);

  document.addEventListener("keydown", async (event) => {
    const key = event.key.toLowerCase();
    if (key === "printscreen") {
      hideTemporarily();
      try {
        await navigator.clipboard.writeText("");
      } catch (_) {}
    }
    if ((event.ctrlKey || event.metaKey) && ["s", "p", "u", "c"].includes(key)) {
      event.preventDefault();
      hideTemporarily();
      setTimeout(showAgain, 800);
    }
    if (event.key === "F12" || ((event.ctrlKey || event.metaKey) && event.shiftKey && ["i", "j", "c"].includes(key))) {
      event.preventDefault();
      hideTemporarily();
      setTimeout(showAgain, 1200);
    }
  });

  setInterval(paintWatermarks, 30000);

  logoutBtn.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    location.href = "/";
  });
})();
