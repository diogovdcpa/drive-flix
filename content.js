// ===================== ESTADO GLOBAL =====================
let active = false; // finder ligado/desligado
let overlay = null; // container principal do finder
let grid = null; // área de resultados
let currentSections = []; // vídeos agrupados por pasta
let currentFiles = []; // lista plana de vídeos encontrados
let playlist = []; // lista navegável global
let playlistIndex = -1; // posição atual na playlist
let lastUrl = location.href; // controle de navegação SPA
let scanToken = 0; // cancela varreduras antigas
let renderFrame = 0; // throttle do render progressivo
let scanComplete = false; // finalização da varredura
const documentCache = new Map(); // cache de HTML já carregado nesta sessão
const subtreeCache = new Map(); // cache de subárvore já varrida

// ===================== HELPERS =====================
function truncate(str, max) {
  str = str || "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeWhitespace(str) {
  return String(str || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url, location.href);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(url);
  }
}

function extractDriveId(url) {
  const value = String(url || "");
  const folderMatch = value.match(/\/folders\/([a-zA-Z0-9_-]+)/i);
  if (folderMatch) return folderMatch[1];

  const fileMatch = value.match(/\/file\/d\/([a-zA-Z0-9_-]+)/i);
  if (fileMatch) return fileMatch[1];

  const openMatch = value.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  if (openMatch) return openMatch[1];

  return "";
}

function buildFolderUrl(folderId) {
  return folderId ? `https://drive.google.com/drive/folders/${folderId}` : "";
}

function cleanDriveLabel(label) {
  const value = normalizeWhitespace(label)
    .replace(/\s*-\s*(Google Drive|Drive).*$/i, "")
    .replace(/\s*\|\s*(Google Drive|Drive).*$/i, "");

  if (!value) return "";

  const ignored = [
    /^shared folder$/i,
    /^Shared folder$/i,
    /^shared with me$/i,
    /^shared drive$/i,
    /^compartilhado comigo$/i,
    /^pasta compartilhada$/i,
    /^Pasta compartilhada$/i,
    /^meu disco$/i,
    /^my drive$/i,
  ];

  if (ignored.some((pattern) => pattern.test(value))) return "";

  return value
    .replace(/\s+(Pasta compartilhada|Shared folder|shared folder|shared drive|compartilhado comigo|my drive|meu disco)\s*$/i, "")
    .replace(/^\s*(Pasta compartilhada|Shared folder|shared folder|shared drive|compartilhado comigo|my drive|meu disco)\s+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeDrivePath(path) {
  return normalizeWhitespace(path)
    .split(/\s*\/\s*/)
    .map((part) => cleanDriveLabel(part))
    .filter(Boolean)
    .join(" / ");
}

function getRootLabel(doc = document) {
  const heading = normalizeWhitespace(doc.querySelector("h1")?.textContent || "");
  const cleanHeading = cleanDriveLabel(heading);
  if (cleanHeading) return cleanHeading;

  const title = cleanDriveLabel(doc.title || "");
  if (title) return title;

  return "Pasta atual";
}

function getRelativePath(fullPath, rootPath) {
  const cleanFullPath = normalizeDrivePath(fullPath);
  const cleanRootPath = normalizeDrivePath(rootPath);
  if (!cleanRootPath) return cleanFullPath;
  const prefix = `${cleanRootPath} / `;
  if (cleanFullPath.startsWith(prefix)) return cleanFullPath.slice(prefix.length);
  if (cleanFullPath === cleanRootPath) return cleanRootPath;
  return cleanFullPath;
}

function shouldShowSectionPath(title, path) {
  const cleanTitle = normalizeDrivePath(title);
  const cleanPath = normalizeDrivePath(path);
  if (!cleanPath || !cleanTitle) return Boolean(cleanPath);
  if (cleanPath === cleanTitle) return false;
  return !cleanPath.endsWith(cleanTitle);
}

function isPlayable(file) {
  if (!file || file.isFolder) return false;
  if (file.isVideo) return true;
  const n = (file.name || "").toLowerCase();
  return /\.(mp4|webm|mkv|mov|avi|m4v)\b/.test(n);
}

function sortByName(items) {
  return [...items].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", "pt-BR", { sensitivity: "base" })
  );
}

function sortByPath(items) {
  return [...items].sort((a, b) =>
    (a.path || "").localeCompare(b.path || "", "pt-BR", { sensitivity: "base" })
  );
}

function sortVideos(items) {
  return [...items].sort((a, b) => {
    const sectionCompare = (a.sectionPath || "").localeCompare(
      b.sectionPath || "",
      "pt-BR",
      { sensitivity: "base" }
    );
    if (sectionCompare !== 0) return sectionCompare;
    return (a.name || "").localeCompare(b.name || "", "pt-BR", {
      sensitivity: "base",
    });
  });
}

async function mapWithConcurrency(items, limit, mapper) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) return;
      await mapper(item);
    }
  });

  await Promise.all(workers);
}

function buildPlaylist() {
  playlist = currentFiles.filter((f) => isPlayable(f));
}

function thumbUrl(file) {
  if (file.thumb) return file.thumb;
  if (file.id) return `https://drive.google.com/thumbnail?id=${file.id}&sz=w400`;
  return null;
}

function setStatus(text, loading = false) {
  const status = overlay?.querySelector(".nf-status");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("is-loading", loading);

  const refresh = overlay?.querySelector(".nf-refresh");
  if (refresh) refresh.disabled = loading;
}

function setLoadingState(loading) {
  grid?.classList.toggle("is-loading", loading);
}

function updateProgressStatus() {
  if (scanComplete) {
    const sectionLabel = currentSections.length === 1 ? "seção" : "seções";
    const videoLabel = currentFiles.length === 1 ? "vídeo" : "vídeos";
    setStatus(`${currentFiles.length} ${videoLabel} em ${currentSections.length} ${sectionLabel}`, false);
    return;
  }

  const sectionLabel = currentSections.length === 1 ? "seção" : "seções";
  const videoLabel = currentFiles.length === 1 ? "vídeo" : "vídeos";
  setStatus(`Varredura em andamento: ${currentFiles.length} ${videoLabel} em ${currentSections.length} ${sectionLabel}`, true);
}

function scheduleRenderSections() {
  if (renderFrame) return;

  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    if (!grid) return;

    currentSections = sortByPath(currentSections);
    currentFiles = sortVideos(currentFiles);
    buildPlaylist();
    renderSections();
    updateProgressStatus();
  });
}

function findBestLink(node) {
  const candidates = [
    node.closest?.("a[href]"),
    node.querySelector?.("a[href]"),
    node.parentElement?.closest?.("a[href]"),
    node.parentElement?.querySelector?.("a[href]"),
  ].filter(Boolean);

  for (const anchor of candidates) {
    const href = anchor.getAttribute("href") || anchor.href || "";
    if (href && href !== "#") return normalizeUrl(href);
  }

  return "";
}

function guessEntryName(node) {
  const aria = normalizeWhitespace(node.getAttribute("aria-label") || "");
  const tooltip = normalizeWhitespace(
    node.querySelector("[data-tooltip]")?.getAttribute("data-tooltip") || ""
  );
  const title = normalizeWhitespace(node.getAttribute("title") || "");
  const text = normalizeWhitespace(node.textContent || "");

  return (
    aria ||
    tooltip ||
    title ||
    text.split("\n").find((part) => normalizeWhitespace(part)) ||
    "Sem nome"
  );
}

function extractEntry(node) {
  const rawId = normalizeWhitespace(node.getAttribute("data-id") || "");
  if (!rawId) return null;

  const name = guessEntryName(node);
  const link = findBestLink(node);
  const lower = `${name} ${node.getAttribute("aria-label") || ""} ${
    node.querySelector("[data-tooltip]")?.getAttribute("data-tooltip") || ""
  } ${link}`.toLowerCase();

  const isFolder =
    /pasta|folder/.test(lower) || /\/folders\//.test(link);

  const isVideo =
    /\.(mp4|webm|mkv|mov|avi|m4v)\b/.test(lower) ||
    /\b(vídeo|video|filme|mp4|mkv)\b/.test(lower) ||
    /\/file\/d\//.test(link);

  const img = node.querySelector("img");
  const thumb =
    img && img.src && !img.src.startsWith("data:") ? img.src : null;

  const id = extractDriveId(link) || rawId;

  return {
    id,
    isFolder,
    isVideo,
    name,
    thumb,
    url: link,
  };
}

function extractEntriesFromDocument(doc) {
  const nodes = doc.querySelectorAll("[data-id]");
  const seen = new Map();

  nodes.forEach((node) => {
    const entry = extractEntry(node);
    if (!entry) return;

    const key = entry.id || normalizeUrl(entry.url) || entry.name;
    if (!key || seen.has(key)) return;
    seen.set(key, entry);
  });

  return Array.from(seen.values());
}

async function fetchDocument(url) {
  const cacheKey = normalizeUrl(url);
  if (!cacheKey) return null;
  if (documentCache.has(cacheKey)) {
    return documentCache.get(cacheKey);
  }

  const promise = (async () => {
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return null;
    const html = await response.text();
    return new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
  })();

  documentCache.set(cacheKey, promise);
  return promise;
}

function getScanRoot() {
  const rootLabel = getRootLabel(document);
  return {
    id: extractDriveId(location.href),
    path: rootLabel,
    rootPath: rootLabel,
    title: rootLabel,
    url: normalizeUrl(location.href),
    depth: 0,
  };
}

async function crawlFolderTree(context, visited, sections, videos) {
  const visitKey = context.id ? `id:${context.id}` : normalizeUrl(context.url);
  if (!visitKey || visited.has(visitKey)) return;
  visited.add(visitKey);

  const currentUrl = normalizeUrl(context.url);
  const cacheKey = currentUrl;
  const startSectionIndex = sections.length;
  const startVideoIndex = videos.length;

  if (subtreeCache.has(cacheKey)) {
    const cached = subtreeCache.get(cacheKey);
    const cachedSections = cached.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({ ...item })),
    }));
    const cachedVideos = cached.videos.map((video) => ({ ...video }));
    sections.push(...cachedSections);
    videos.push(...cachedVideos);
    currentSections.push(...cachedSections);
    currentFiles.push(...cachedVideos);
    scheduleRenderSections();
    return;
  }

  const doc =
    currentUrl === normalizeUrl(location.href)
      ? document
      : await fetchDocument(currentUrl);

  if (!doc) return;

  const entries = extractEntriesFromDocument(doc);
  const folderEntries = [];
  const videoEntries = [];

  entries.forEach((entry) => {
    if (entry.isFolder) {
      folderEntries.push(entry);
      return;
    }

    if (isPlayable(entry)) {
      videoEntries.push({
        ...entry,
        sectionPath: context.path,
        sectionTitle: context.title,
      });
    }
  });

  if (videoEntries.length) {
    const sorted = sortByName(videoEntries);
    const section = {
      depth: context.depth,
      path: context.path,
      title: context.title,
      displayTitle: getRelativePath(context.path, context.rootPath),
      items: sorted,
    };
    sections.push(section);
    videos.push(...sorted);
    currentSections.push(section);
    currentFiles.push(...sorted);
    scheduleRenderSections();
  }

  const nextFolders = sortByName(folderEntries);
  await mapWithConcurrency(nextFolders, 4, async (folder) => {
    const folderUrl = folder.url || buildFolderUrl(folder.id);
    if (!folderUrl) return;

    const folderContext = {
      id: folder.id || extractDriveId(folderUrl),
      path: `${context.path} / ${folder.name}`,
      title: folder.name,
      url: folderUrl,
      depth: context.depth + 1,
      rootPath: context.rootPath,
    };

    await crawlFolderTree(folderContext, visited, sections, videos);
  });

  subtreeCache.set(cacheKey, {
    sections: sections.slice(startSectionIndex).map((section) => ({
      ...section,
      items: section.items.map((item) => ({ ...item })),
    })),
    videos: videos.slice(startVideoIndex).map((video) => ({ ...video })),
  });
}

async function collectLibrary() {
  const visited = new Set();
  const sections = [];
  const videos = [];
  const root = getScanRoot();

  await crawlFolderTree(root, visited, sections, videos);
  sections.splice(0, sections.length, ...sortByPath(sections));
  videos.splice(0, videos.length, ...sortVideos(videos));

  return {
    sections,
    videos,
  };
}

// ===================== RENDER DA GRADE =====================
function createCard(file) {
  const card = document.createElement("div");
  card.className = "nf-card";
  card.setAttribute("data-id", file.id);
  if (file.sectionPath) card.setAttribute("data-section-path", file.sectionPath);

  const img = thumbUrl(file);
  const icon = "🎬";

  card.innerHTML = `
    <div class="nf-thumb">
      ${
        img
          ? `<img src="${img}" loading="lazy" alt="${escapeHtml(
              file.name
            )}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /> <div class="nf-thumb-fallback">${icon}</div>`
          : `<div class="nf-thumb-fallback">${icon}</div>`
      }
      <div class="nf-play">▶</div>
    </div>
    <div class="nf-card-title" title="${escapeHtml(file.name)}">${escapeHtml(
    truncate(file.name, 48)
  )}</div>`;

  card.addEventListener("click", () => openModal(file));
  return card;
}

function renderSections() {
  grid.innerHTML = "";

  if (currentFiles.length === 0) {
    grid.innerHTML = `<div class="nf-empty">Nenhum vídeo encontrado nesta pasta e nas subpastas.</div>`;
    return;
  }

  currentSections.forEach((section) => {
    const sectionEl = document.createElement("section");
    sectionEl.className = "nf-section";
    const title = normalizeDrivePath(section.displayTitle || section.title);
    const sectionPath = normalizeDrivePath(section.path);
    const showPath = shouldShowSectionPath(title, sectionPath);

    sectionEl.innerHTML = `
      <div class="nf-section-head">
        <div class="nf-section-meta">
          <div class="nf-section-title" title="${escapeHtml(title)}">${escapeHtml(
      truncate(title, 64)
    )}</div>
          ${
            showPath
              ? `<div class="nf-section-path" title="${escapeHtml(sectionPath)}">${escapeHtml(
                  sectionPath
                )}</div>`
              : ""
          }
        </div>
        <span class="nf-section-count">${section.items.length} vídeo(s)</span>
      </div>`;

    const sectionGrid = document.createElement("div");
    sectionGrid.className = "nf-section-grid";

    section.items.forEach((file) => {
      sectionGrid.appendChild(createCard(file));
    });

    sectionEl.appendChild(sectionGrid);
    grid.appendChild(sectionEl);
  });
}

function renderLoading(message) {
  grid.innerHTML = `<div class="nf-loading">${escapeHtml(message)}</div>`;
}

async function renderGrid() {
  if (!grid) return;

  const token = ++scanToken;
  scanComplete = false;
  currentSections = [];
  currentFiles = [];
  playlist = [];
  setLoadingState(true);
  setStatus("Varredura em andamento...", true);
  renderLoading("Varrendo a pasta atual e as subpastas...");

  try {
    const { sections, videos } = await collectLibrary();
    if (token !== scanToken) return;

    currentSections = sections;
    currentFiles = videos;
    buildPlaylist();
    renderSections();
    scanComplete = true;
    updateProgressStatus();
  } catch (error) {
    if (token !== scanToken) return;
    currentSections = [];
    currentFiles = [];
    playlist = [];
    grid.innerHTML = `<div class="nf-empty">Falha ao varrer o Drive. Tente atualizar a página e abrir o plugin novamente.</div>`;
    setStatus("Falha na varredura.", false);
    console.error("[Drive Flix] scan error", error);
  } finally {
    if (token === scanToken) {
      setLoadingState(false);
      if (renderFrame) {
        cancelAnimationFrame(renderFrame);
        renderFrame = 0;
      }
    }
  }
}

// ===================== MODAL / PLAYER =====================
function openModal(file) {
  buildPlaylist();

  playlistIndex = playlist.findIndex((f) => {
    if (file.id && f.id) return f.id === file.id;
    if (file.url && f.url) return normalizeUrl(f.url) === normalizeUrl(file.url);
    return f.name === file.name;
  });

  if (playlistIndex === -1) {
    renderModal(file, false);
  } else {
    renderModal(playlist[playlistIndex], true);
  }
}

function renderModal(file, withNav) {
  closeModal();

  const modal = document.createElement("div");
  modal.className = "nf-modal";

  const previewUrl = file.id
    ? `https://drive.google.com/file/d/${file.id}/preview`
    : null;

  const hasPrev = withNav && playlistIndex > 0;
  const hasNext = withNav && playlistIndex < playlist.length - 1;
  const counter = withNav
    ? `<span class="nf-modal-counter">${playlistIndex + 1} / ${
        playlist.length
      }</span>`
    : "";
  const sectionPath = file.sectionPath
    ? `<span class="nf-modal-subtitle" title="${escapeHtml(
        normalizeDrivePath(file.sectionPath)
      )}">${escapeHtml(
        truncate(normalizeDrivePath(file.sectionPath), 96)
      )}</span>`
    : "";

  modal.innerHTML = `
    <button class="nf-nav nf-prev" ${
      hasPrev ? "" : "disabled"
    } title="Anterior (←)">‹</button>

    <div class="nf-modal-box">
      <div class="nf-modal-head">
        <div class="nf-modal-heading">
          <span class="nf-modal-title" title="${escapeHtml(file.name)}">${escapeHtml(
    truncate(file.name, 60)
  )}</span>
          ${sectionPath}
        </div>
        <div class="nf-modal-actions">
          ${counter}
          ${
            file.id
              ? `<a class="nf-modal-open" target="_blank" rel="noreferrer"
                   href="https://drive.google.com/file/d/${file.id}/view">Abrir no Drive ↗</a>`
              : ""
          }
          <button class="nf-modal-close" title="Fechar (Esc)">✕</button>
        </div>
      </div>
      <div class="nf-modal-body">
        ${
          previewUrl
            ? `<iframe src="${previewUrl}" allow="autoplay" allowfullscreen></iframe>`
            : `<div class="nf-empty">Sem preview disponível para este item.</div>`
        }
      </div>
      ${
        hasNext
          ? `<button class="nf-next-cta">Próximo: ${escapeHtml(
              truncate(playlist[playlistIndex + 1].name, 40)
            )} ›</button>`
          : ""
      }
    </div>

    <button class="nf-nav nf-next" ${
      hasNext ? "" : "disabled"
    } title="Próximo (→)">›</button>`;

  overlay.appendChild(modal);

  modal.querySelector(".nf-modal-close").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  modal.querySelector(".nf-prev")?.addEventListener("click", () => playNav(-1));
  modal.querySelector(".nf-next")?.addEventListener("click", () => playNav(1));
  modal
    .querySelector(".nf-next-cta")
    ?.addEventListener("click", () => playNav(1));
}

function playNav(step) {
  const target = playlistIndex + step;
  if (target < 0 || target >= playlist.length) return;
  playlistIndex = target;
  renderModal(playlist[playlistIndex], true);
}

function closeModal() {
  overlay?.querySelector(".nf-modal")?.remove();
}

// ===================== ABRIR / FECHAR FINDER =====================
function openFinder() {
  if (active) return;
  active = true;

  overlay = document.createElement("div");
  overlay.className = "nf-overlay";
  overlay.innerHTML = `
    <div class="nf-topbar">
      <div class="nf-topbar-left">
        <span class="nf-logo">🎬 Drive Flix</span>
        <span class="nf-status">Pronto para varrer a pasta atual e subpastas.</span>
      </div>
      <div class="nf-topbar-actions">
        <button class="nf-refresh" title="Atualizar lista">⟳ Atualizar</button>
        <button class="nf-close-finder" title="Fechar (Esc)">✕ Fechar</button>
      </div>
    </div>
    <div class="nf-grid"></div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  grid = overlay.querySelector(".nf-grid");
  overlay
    .querySelector(".nf-close-finder")
    .addEventListener("click", closeFinder);
  overlay.querySelector(".nf-refresh").addEventListener("click", renderGrid);

  renderGrid();
}

function closeFinder() {
  closeModal();
  scanToken += 1;
  scanComplete = false;
  if (renderFrame) {
    cancelAnimationFrame(renderFrame);
    renderFrame = 0;
  }
  overlay?.remove();
  overlay = null;
  grid = null;
  active = false;
  document.body.style.overflow = "";
}

function toggleFinder() {
  active ? closeFinder() : openFinder();
}

// ===================== BOTÃO FLUTUANTE FIXO =====================
function injectToggleButton() {
  if (document.querySelector(".nf-fab")) return;
  const fab = document.createElement("button");
  fab.className = "nf-fab";
  fab.textContent = "🎬";
  fab.title = "Abrir Drive Flix";
  fab.addEventListener("click", toggleFinder);
  document.body.appendChild(fab);
}

// ===================== TECLADO =====================
document.addEventListener("keydown", (e) => {
  const modalOpen = overlay?.querySelector(".nf-modal");
  if (modalOpen) {
    if (e.key === "Escape") return closeModal();
    if (e.key === "ArrowRight") return playNav(1);
    if (e.key === "ArrowLeft") return playNav(-1);
    return;
  }

  if (e.key === "Escape" && active) closeFinder();
});

// ===================== OBSERVADOR DE NAVEGAÇÃO SPA =====================
// O Drive troca de pasta sem recarregar a página; reavalia a grade.
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (active) {
      setTimeout(() => {
        renderGrid();
      }, 600);
    }
  }
}, 800);

// ===================== INICIALIZAÇÃO =====================
injectToggleButton();

// reintroduz o botão caso o Drive limpe o DOM
const fabObserver = new MutationObserver(() => injectToggleButton());
fabObserver.observe(document.body, { childList: true, subtree: false });
