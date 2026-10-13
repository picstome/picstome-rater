const state = {
  lang: "en",
  strings: null,
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

function fmt(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    key in vars ? String(vars[key]) : match,
  );
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
  if (!state.strings) return;
  const s = state.strings;

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
      ? fmt(s.ready, {
          n: state.files.length,
          s: state.files.length === 1 ? "" : "s",
          r: state.rating,
        })
      : s.needFolder;
  } else {
    els.subtitle.textContent = state.folder ? s.needFiles : s.waiting;
  }

  els.btnRate.disabled = !canRate();

  if (state.busy) show(els.spinner);
  else hide(els.spinner);
}

function showResults({ rated, notFound, errors, details }) {
  const s = state.strings;
  if (!s) return;

  let cls = "ok";
  const parts = [fmt(s.rated, { n: rated, s: rated === 1 ? "" : "s" })];

  if (notFound > 0) {
    parts.push(fmt(s.notFound, { n: notFound, s: notFound === 1 ? "" : "s" }));
    cls = "warn";
  }

  if (errors > 0) {
    parts.push(fmt(s.errors, { n: errors, s: errors === 1 ? "" : "s" }));
    cls = "error";
  }

  els.resultSummary.textContent = parts.join(" · ");
  els.resultSummary.className = `result-summary ${cls}`;

  const fragment = document.createDocumentFragment();

  for (const d of details) {
    const row = document.createElement("div");
    row.className = d.status === "ok" ? "ok" : d.status === "notfound" ? "miss" : "err";
    row.textContent = d.status === "ok" ? d.file : `${d.name} — ${d.msg}`;
    fragment.appendChild(row);
  }

  els.detailList.replaceChildren(fragment);

  show(els.results);
}

window.api.onInit(({ lang, config, strings }) => {
  state.lang = lang || "en";
  state.strings = strings;
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
  if (!canRate() || !state.strings) return;

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
  } catch (err) {
    els.resultSummary.textContent = String(err);
    els.resultSummary.className = "result-summary error";
    els.detailList.replaceChildren();
    show(els.results);
  } finally {
    state.busy = false;
    render();
  }
});

els.btnUpdate.addEventListener("click", () => {
  window.api.installUpdate();
});
