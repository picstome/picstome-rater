const STRINGS = {
  en: {
    noFolder: "No folder selected",
    waiting: "Waiting for a Picstome link...",
    needFolder: "Select a photos folder first",
    needFiles: "Waiting for a Picstome link...",
    ready: (n, r) =>
      `Ready to rate ${n} photo${n !== 1 ? "s" : ""} with ${r} ★`,
    applying: "Applying rating…",
    applyBtn: "Apply rating",
    changeBtn: "Change...",
    folderLabel: "Photos folder",
    photos: "photos",
    rating: "Rating",
    rated: (n) => `✓ ${n} file${n !== 1 ? "s" : ""} rated`,
    notFound: (n) => `⚠ ${n} not found`,
    errors: (n) => `✖ ${n} error${n !== 1 ? "s" : ""}`,
  },
  es: {
    noFolder: "Ninguna carpeta seleccionada",
    waiting: "Esperando enlace de Picstome...",
    needFolder: "Selecciona primero la carpeta de fotos",
    needFiles: "Esperando enlace de Picstome...",
    ready: (n, r) =>
      `Listo para ratear ${n} foto${n !== 1 ? "s" : ""} con ${r} ★`,
    applying: "Aplicando rating…",
    applyBtn: "Aplicar rating",
    changeBtn: "Cambiar...",
    folderLabel: "Carpeta de fotos",
    photos: "fotos",
    rating: "Rating",
    rated: (n) =>
      `✓ ${n} archivo${n !== 1 ? "s" : ""} rateado${n !== 1 ? "s" : ""}`,
    notFound: (n) => `⚠ ${n} no encontrado${n !== 1 ? "s" : ""}`,
    errors: (n) => `✖ ${n} error${n !== 1 ? "es" : ""}`,
  },
};

const state = {
  lang: "en",
  folder: "",
  files: [],
  rating: "1",
  busy: false,
};

const els = {
  subtitle: document.getElementById("subtitle"),
  folderLabel: document.getElementById("folderLabel"),
  pathBox: document.getElementById("pathBox"),
  btnChooseFolder: document.getElementById("btnChooseFolder"),
  infoRow: document.getElementById("infoRow"),
  fileCount: document.getElementById("fileCount"),
  photosLabel: document.getElementById("photosLabel"),
  ratingLabel: document.getElementById("ratingLabel"),
  ratingVal: document.getElementById("ratingVal"),
  btnRate: document.getElementById("btnRate"),
  spinner: document.getElementById("spinner"),
  results: document.getElementById("results"),
  resultSummary: document.getElementById("resultSummary"),
  detailList: document.getElementById("detailList"),
  updateBanner: document.getElementById("updateBanner"),
  updateMsg: document.getElementById("updateMsg"),
  btnUpdate: document.getElementById("btnUpdate"),
  starButtons: Array.from(document.querySelectorAll(".star-btn")),
};

for (const [key, el] of Object.entries(els)) {
  if (Array.isArray(el)) {
    if (el.length === 0) throw new Error(`Missing DOM element: ${key}`);
  } else if (!el) {
    throw new Error(`Missing DOM element: ${key}`);
  }
}

function S() {
  return STRINGS[state.lang] ?? STRINGS.en;
}

function normalizeRating(value) {
  const v = String(value ?? "").trim();
  return ["1", "2", "3", "4", "5"].includes(v) ? v : "1";
}

function canRate() {
  return Boolean(state.folder) && state.files.length > 0 && !state.busy;
}

function show(el) {
  el.classList.remove("hidden");
}

function hide(el) {
  el.classList.add("hidden");
}

function setRating(value) {
  state.rating = normalizeRating(value);
  const current = Number(state.rating);

  for (const btn of els.starButtons) {
    const btnValue = Number(btn.dataset.rating);
    const active = btnValue <= current;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }

  els.ratingVal.textContent = state.rating;
}

function render() {
  const s = S();

  els.folderLabel.textContent = s.folderLabel;
  els.btnChooseFolder.textContent = s.changeBtn;
  els.btnRate.textContent = s.applyBtn;
  els.photosLabel.textContent = s.photos;
  els.ratingLabel.textContent = s.rating;
  els.spinner.textContent = s.applying;

  if (state.folder) {
    els.pathBox.textContent = state.folder;
    els.pathBox.classList.remove("empty");
  } else {
    els.pathBox.textContent = s.noFolder;
    els.pathBox.classList.add("empty");
  }

  if (state.files.length > 0) {
    show(els.infoRow);
    els.fileCount.textContent = String(state.files.length);
  } else {
    hide(els.infoRow);
  }

  setRating(state.rating);

  if (state.files.length > 0) {
    els.subtitle.textContent = state.folder
      ? s.ready(state.files.length, state.rating)
      : s.needFolder;
  } else {
    els.subtitle.textContent = state.folder ? s.needFiles : s.waiting;
  }

  els.btnRate.disabled = !canRate();

  if (state.busy) show(els.spinner);
  else hide(els.spinner);
}

function showResults({ rated, notFound, errors, details }) {
  const s = S();
  let cls = "ok";
  const parts = [s.rated(rated)];

  if (notFound > 0) {
    parts.push(s.notFound(notFound));
    cls = "warn";
  }

  if (errors > 0) {
    parts.push(s.errors(errors));
    cls = "error";
  }

  els.resultSummary.textContent = parts.join(" · ");
  els.resultSummary.className = `result-summary ${cls}`;

  els.detailList.innerHTML = details
    .map((d) => {
      if (d.status === "ok") return `<div class="ok">✔ ${d.file}</div>`;
      if (d.status === "notfound")
        return `<div class="miss">⚠ ${d.name} — ${d.msg}</div>`;
      return `<div class="err">✖ ${d.name} — ${d.msg}</div>`;
    })
    .join("");

  show(els.results);
}

window.api.onInit(({ lang, config }) => {
  state.lang = lang || "en";
  state.folder = config?.photosDir || "";
  state.rating = normalizeRating(config?.lastRating || "1");
  render();
});

window.api.onIncomingRate(({ files, rating }) => {
  state.files = Array.isArray(files) ? files : [];
  state.rating = rating ? normalizeRating(rating) : state.rating;
  hide(els.results);
  render();
});

window.api.onUpdateStatus(({ type, msg }) => {
  els.updateMsg.textContent = msg;
  show(els.updateBanner);

  if (type === "ready") show(els.btnUpdate);
});

els.btnChooseFolder.addEventListener("click", async () => {
  const folder = await window.api.chooseFolder();
  if (folder) {
    state.folder = folder;
    render();
  }
});

for (const btn of els.starButtons) {
  btn.addEventListener("click", () => {
    setRating(btn.dataset.rating);
    render();
  });
}

els.btnRate.addEventListener("click", async () => {
  if (!canRate()) return;

  state.busy = true;
  hide(els.results);
  render();

  try {
    const result = await window.api.rateFiles({
      files: state.files,
      rating: state.rating,
      photosDir: state.folder,
    });
    showResults(result);
  } finally {
    state.busy = false;
    render();
  }
});

els.btnUpdate.addEventListener("click", () => {
  window.api.installUpdate();
});

render();
