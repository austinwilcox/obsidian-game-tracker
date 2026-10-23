/* Game Tracker - an Obsidian plugin (plain JS, no build step needed) */
const {
  Plugin,
  ItemView,
  Modal,
  Menu,
  Setting,
  PluginSettingTab,
  Notice,
  normalizePath,
  setIcon,
  debounce,
  moment,
  requestUrl,
} = require("obsidian");

const VIEW_TYPE = "game-tracker-dashboard";
const RAWG_API = "https://api.rawg.io/api";
const LIBRETRO_META = "https://raw.githubusercontent.com/libretro/libretro-database/master/metadat";
const LIBRETRO_THUMBS = "thumbnails.libretro.com";
const DB_VERSION = 1;
const DB_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const STATUSES = [
  { id: "playing", label: "Playing", icon: "gamepad-2", folder: "Playing" },
  { id: "next", label: "Up next", icon: "list-ordered", folder: "Up next" },
  { id: "backlog", label: "Backlog", icon: "library", folder: "Backlog" },
  { id: "paused", label: "On hold", icon: "pause", folder: "On hold" },
  { id: "beaten", label: "Beaten", icon: "check", folder: "Beaten" },
  { id: "completed", label: "100% completed", icon: "trophy", folder: "Completed" },
  { id: "dropped", label: "Dropped", icon: "x", folder: "Dropped" },
];
const FINISHED = ["beaten", "completed"];
const statusLabel = (id) => (STATUSES.find((s) => s.id === id) || {}).label || id;

/**
 * Systems supported by the retro (libretro) search. `id` is the exact name libretro
 * uses for the database file and the thumbnail folder. `src` is the folder holding the
 * game list: No-Intro for cartridge systems, Redump for disc systems.
 */
const SYSTEMS = [
  { id: "Atari - 2600", short: "Atari 2600", src: "no-intro" },
  { id: "Atari - 5200", short: "Atari 5200", src: "no-intro" },
  { id: "Atari - 7800", short: "Atari 7800", src: "no-intro" },
  { id: "Atari - Jaguar", short: "Atari Jaguar", src: "no-intro" },
  { id: "Atari - Lynx", short: "Atari Lynx", src: "no-intro" },
  { id: "Atari - ST", short: "Atari ST", src: "no-intro" },
  { id: "Bandai - WonderSwan", short: "WonderSwan", src: "no-intro" },
  { id: "Bandai - WonderSwan Color", short: "WonderSwan Color", src: "no-intro" },
  { id: "Coleco - ColecoVision", short: "ColecoVision", src: "no-intro" },
  { id: "Commodore - 64", short: "Commodore 64", src: "no-intro" },
  { id: "GCE - Vectrex", short: "Vectrex", src: "no-intro" },
  { id: "Magnavox - Odyssey2", short: "Odyssey 2", src: "no-intro" },
  { id: "Mattel - Intellivision", short: "Intellivision", src: "no-intro" },
  { id: "Microsoft - MSX", short: "MSX", src: "no-intro" },
  { id: "Microsoft - MSX2", short: "MSX2", src: "no-intro", metaName: "Microsoft - MSX 2" },
  { id: "NEC - PC Engine - TurboGrafx 16", short: "TurboGrafx-16", src: "no-intro" },
  { id: "NEC - PC Engine SuperGrafx", short: "SuperGrafx", src: "no-intro" },
  { id: "NEC - PC Engine CD - TurboGrafx-CD", short: "TurboGrafx-CD", src: "redump" },
  { id: "Nintendo - Nintendo Entertainment System", short: "NES", src: "no-intro" },
  { id: "Nintendo - Family Computer Disk System", short: "Famicom Disk System", src: "no-intro" },
  { id: "Nintendo - Super Nintendo Entertainment System", short: "SNES", src: "no-intro" },
  { id: "Nintendo - Game Boy", short: "Game Boy", src: "no-intro" },
  { id: "Nintendo - Game Boy Color", short: "Game Boy Color", src: "no-intro" },
  { id: "Nintendo - Game Boy Advance", short: "Game Boy Advance", src: "no-intro" },
  { id: "Nintendo - Nintendo 64", short: "Nintendo 64", src: "no-intro" },
  { id: "Nintendo - Nintendo DS", short: "Nintendo DS", src: "no-intro" },
  { id: "Nintendo - Virtual Boy", short: "Virtual Boy", src: "no-intro" },
  { id: "Nintendo - Pokemon Mini", short: "Pokemon Mini", src: "no-intro" },
  { id: "Philips - CD-i", short: "CD-i", src: "redump" },
  { id: "Sega - SG-1000", short: "SG-1000", src: "no-intro" },
  { id: "Sega - Master System - Mark III", short: "Master System", src: "no-intro" },
  { id: "Sega - Mega Drive - Genesis", short: "Genesis", src: "no-intro" },
  { id: "Sega - 32X", short: "Sega 32X", src: "no-intro" },
  { id: "Sega - Mega-CD - Sega CD", short: "Sega CD", src: "redump" },
  { id: "Sega - Saturn", short: "Saturn", src: "redump" },
  { id: "Sega - Dreamcast", short: "Dreamcast", src: "redump" },
  { id: "Sega - Game Gear", short: "Game Gear", src: "no-intro" },
  { id: "SNK - Neo Geo Pocket", short: "Neo Geo Pocket", src: "no-intro" },
  { id: "SNK - Neo Geo Pocket Color", short: "Neo Geo Pocket Color", src: "no-intro" },
  { id: "SNK - Neo Geo CD", short: "Neo Geo CD", src: "redump" },
  { id: "Sony - PlayStation", short: "PlayStation", src: "redump" },
  { id: "Sony - PlayStation 2", short: "PlayStation 2", src: "redump" },
  { id: "Sony - PlayStation Portable", short: "PSP", src: "no-intro" },
  { id: "The 3DO Company - 3DO", short: "3DO", src: "redump" },
];
const DEFAULT_SYSTEM = "Nintendo - Super Nintendo Entertainment System";

const DEFAULT_SETTINGS = {
  folder: "Games",
  statusFolders: true,
  platforms: ["PC", "PlayStation 5", "Nintendo Switch", "Xbox Series X", "Steam Deck", "Mobile"],
  defaultSort: "title",
  rawgKey: "",
  downloadCovers: true,
  wikipedia: true,
  lastSource: "retro",
  lastSystem: DEFAULT_SYSTEM,
};

const DATE_FMT = "YYYY-MM-DD";
const today = () => moment().format(DATE_FMT);

function parseDate(v) {
  if (!v) return null;
  const m = moment(String(v).slice(0, 10), DATE_FMT, true);
  return m.isValid() ? m : null;
}
function fmtDate(v) {
  const m = parseDate(v);
  return m ? m.format("MMM D, YYYY") : "";
}
function daysBetween(a, b) {
  const x = parseDate(a);
  const y = parseDate(b);
  if (!x || !y) return null;
  return Math.max(0, y.diff(x, "days"));
}
function toList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
/** RAWG serves resized copies of its images; much lighter than the originals. */
function resizeUrl(url, width) {
  if (url && url.includes("/media/games/")) {
    return url.replace("/media/games/", `/media/resize/${width}/-/games/`);
  }
  return url;
}
function shorten(text, max = 900) {
  const t = (text || "").split(/\n\s*Español\s*\n/)[0].replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastStop = cut.lastIndexOf(". ");
  return (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + "...").trim();
}
function sanitizeName(s) {
  return (s || "")
    .replace(/[\\/:*?"<>|#^\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function slugify(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
function normalizeText(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
/** Show an image, trying each URL in turn until one loads. */
function loadImageChain(img, urls) {
  let i = 0;
  img.onerror = () => {
    i++;
    if (i < urls.length) img.src = urls[i];
    else img.addClass("is-missing");
  };
  img.src = urls[0];
}

function normalizeRawg(raw) {
  return {
    source: "rawg",
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    released: raw.released || "",
    image: raw.background_image || "",
    platforms: (raw.platforms || []).map((p) => p.platform && p.platform.name).filter(Boolean),
    genres: (raw.genres || []).map((g) => g.name),
    developers: (raw.developers || []).map((d) => d.name),
    publishers: (raw.publishers || []).map((d) => d.name),
    metacritic: raw.metacritic || null,
    description: raw.description_raw || "",
    url: `https://rawg.io/games/${raw.slug}`,
  };
}

/* ------------------------------------------------------------------ */
/* libretro database: parsing, merging, searching                      */
/* ------------------------------------------------------------------ */

/** Parse a clrmamepro-style .dat into [{name, comment, serial, crcs[], developer, ...}]. */
function parseDat(text) {
  const out = [];
  const chunks = text.split(/^game\s*\(\s*$/m); // chunk 0 is the file header
  for (let i = 1; i < chunks.length; i++) {
    const g = { crcs: [] };
    for (const raw of chunks[i].split("\n")) {
      const line = raw.trim();
      if (!line || line === ")") continue;
      if (/^rom\s*\(/.test(line)) {
        const c = line.match(/\bcrc\s+([0-9a-fA-F]{8})\b/);
        if (c) g.crcs.push(c[1].toLowerCase());
        const s = line.match(/\bserial\s+"([^"]+)"/);
        if (s && !g.serial) g.serial = s[1];
        continue;
      }
      const m = line.match(/^(\w+)\s+(?:"(.*)"|(\S+))\s*$/);
      if (m && !(m[1] in g)) {
        let v = m[2] !== undefined ? m[2] : m[3];
        // Some fields hold several values: developer "Ape", "HAL Laboratory"
        if (m[2] !== undefined && !["name", "comment", "description"].includes(m[1])) {
          v = v
            .split(/"\s*,\s*"/)
            .map((x) => x.replace(/\s*\?{2,}\s*/g, " ").trim()) // upstream uses ??? as a placeholder
            .filter(Boolean)
            .join("; ");
        }
        g[m[1]] = v;
      }
    }
    if (g.name || g.comment) out.push(g);
  }
  return out;
}

const META_FIELDS = {
  developer: "d",
  publisher: "p",
  genre: "g",
  releaseyear: "y",
  franchise: "f",
  description: "u",
};

/** Combine a game list (No-Intro/Redump) with metadata dats, matched by CRC, serial, then name. */
function buildDb(listText, metaTexts) {
  const maps = { c: new Map(), s: new Map(), n: new Map() };
  for (const text of metaTexts) {
    for (const e of parseDat(text)) {
      const vals = {};
      let any = false;
      for (const [key, short] of Object.entries(META_FIELDS)) {
        if (e[key]) {
          vals[short] = e[key];
          any = true;
        }
      }
      if (!any) continue;
      const put = (map, k) => {
        if (k) map.set(k, Object.assign(map.get(k) || {}, vals));
      };
      e.crcs.forEach((c) => put(maps.c, c));
      put(maps.s, e.serial);
      put(maps.n, (e.name || e.comment || "").toLowerCase());
    }
  }

  return parseDat(listText).map((g) => {
    const rec = { n: g.name || g.comment };
    const vals = Object.assign(
      {},
      maps.n.get(rec.n.toLowerCase()),
      g.serial ? maps.s.get(g.serial) : null,
      ...g.crcs.map((c) => maps.c.get(c))
    );
    for (const [k, v] of Object.entries(vals)) {
      if (!v) continue;
      if (k === "y") {
        const yr = String(v).match(/\d{4}/);
        if (yr) rec.y = yr[0];
      } else if (k === "u") {
        rec.u = shorten(v, 600);
      } else {
        rec[k] = v;
      }
    }
    return rec;
  });
}

/** Store each distinct description once; games point at it by index. */
function packDb(games) {
  const descs = [];
  const index = new Map();
  const packed = games.map((g) => {
    const { u, ...rest } = g;
    if (u) {
      if (!index.has(u)) {
        index.set(u, descs.length);
        descs.push(u);
      }
      rest.u = index.get(u);
    }
    return rest;
  });
  return { games: packed, descs };
}
function unpackDb(stored) {
  const descs = stored.descs || [];
  return stored.games.map((g) => (typeof g.u === "number" ? { ...g, u: descs[g.u] } : g));
}

const REGIONS = new Set(
  [
    "USA", "Europe", "Japan", "World", "Australia", "Asia", "Brazil", "Canada", "China", "France", "Germany",
    "Hong Kong", "Italy", "Korea", "Netherlands", "Russia", "Scandinavia", "Spain", "Sweden", "Taiwan", "UK",
    "Denmark", "Finland", "Norway", "Poland", "Portugal", "Greece", "Mexico", "Unknown", "Latin America", "New Zealand",
  ].map((r) => r.toLowerCase())
);

function regionOf(name) {
  for (const m of name.matchAll(/\(([^)]*)\)/g)) {
    const parts = m[1].split(",").map((p) => p.trim().toLowerCase());
    if (parts.every((p) => REGIONS.has(p))) return m[1];
  }
  return "";
}
function regionRank(region) {
  const parts = region.split(",").map((p) => p.trim().toLowerCase());
  const rank = (p) => (p === "usa" ? 0 : p === "world" ? 1 : p === "europe" ? 2 : p === "japan" ? 3 : 4);
  return parts.length ? Math.min(...parts.map(rank)) : 5;
}
const BAD_VARIANT = /\((?:Beta|Proto|Demo|Sample|Unl|Pirate|Aftermarket|Kiosk|Promo|Alt|Virtual Console|Switch Online|Rev|v\d)/i;

/** "Legend of Zelda, The - A Link to the Past (USA)" -> "The Legend of Zelda - A Link to the Past" */
function displayTitle(name) {
  let t = name.replace(/\s*\([^)]*\)/g, "").replace(/\s*\[[^\]]*\]/g, "").trim();
  const m = t.match(/^(.+?), (The|A|An)( - .*)?$/);
  if (m) t = `${m[2]} ${m[1]}${m[3] || ""}`;
  return t || name;
}

function thumbUrl(systemId, type, name, scheme = "https") {
  const safe = name.replace(/[&*/:`<>?\\|"]/g, "_");
  return `${scheme}://${LIBRETRO_THUMBS}/${encodeURIComponent(systemId)}/${type}/${encodeURIComponent(safe)}.png`;
}

function decorateGames(games) {
  for (const g of games) {
    if (g._t) continue;
    g._t = displayTitle(g.n);
    g._nt = normalizeText(g._t);
  }
  return games;
}

/** Search a system's games. Returns up to `limit` grouped results (one per distinct title). */
function searchGames(games, sys, query, limit = 12) {
  const q = normalizeText(query);
  const toks = q.split(" ").filter(Boolean);
  if (!toks.length) return [];

  const groups = new Map();
  for (const g of games) {
    const padded = " " + g._nt;
    if (!toks.every((t) => padded.includes(" " + t))) continue;
    let grp = groups.get(g._nt);
    if (!grp) {
      grp = { title: g._t, nt: g._nt, variants: [] };
      groups.set(g._nt, grp);
    }
    grp.variants.push(g);
  }

  const ranked = [...groups.values()].map((grp) => {
    let score = grp.nt === q ? 100 : grp.nt.startsWith(q) ? 80 : 50;
    score -= Math.min(30, (grp.nt.length - q.length) * 0.15);
    grp.variants.sort(
      (a, b) =>
        (BAD_VARIANT.test(a.n) ? 1 : 0) - (BAD_VARIANT.test(b.n) ? 1 : 0) ||
        regionRank(regionOf(a.n)) - regionRank(regionOf(b.n)) ||
        a.n.length - b.n.length
    );
    return { grp, score };
  });
  ranked.sort((a, b) => b.score - a.score || a.grp.title.localeCompare(b.grp.title));

  return ranked.slice(0, limit).map(({ grp }) => {
    const v = grp.variants;
    const best = v[0];
    const pick = (k) => (v.find((x) => x[k]) || {})[k];
    const urls = [];
    v.slice(0, 3).forEach((x) => urls.push(thumbUrl(sys.id, "Named_Boxarts", x.n)));
    urls.push(thumbUrl(sys.id, "Named_Titles", best.n), thumbUrl(sys.id, "Named_Snaps", best.n));
    urls.push(thumbUrl(sys.id, "Named_Boxarts", best.n, "http"));
    return {
      source: "retro",
      id: best.n,
      slug: slugify(`${sys.short} ${grp.title}`),
      name: grp.title,
      released: pick("y") || "",
      image: urls[0],
      imageUrls: urls,
      platforms: [sys.short],
      genres: pick("g") ? [pick("g")] : [],
      developers: pick("d") ? pick("d").split("; ") : [],
      publishers: pick("p") ? pick("p").split("; ") : [],
      metacritic: null,
      description: pick("u") || "",
      url: "",
      region: regionOf(best.n),
      franchise: pick("f") || "",
      system: sys.id,
      otherReleases: v.length - 1,
    };
  });
}

function guessSystem(platformText) {
  const p = normalizeText(platformText || "");
  if (!p) return null;
  const aliases = {
    "mega drive": "Genesis",
    "sega genesis": "Genesis",
    "super nintendo": "SNES",
    "super nes": "SNES",
    "super famicom": "SNES",
    famicom: "NES",
    "nintendo entertainment system": "NES",
    gba: "Game Boy Advance",
    gbc: "Game Boy Color",
    gb: "Game Boy",
    n64: "Nintendo 64",
    nds: "Nintendo DS",
    ps1: "PlayStation",
    psx: "PlayStation",
    ps2: "PlayStation 2",
    "pc engine": "TurboGrafx-16",
    "master system": "Master System",
  };
  const target = aliases[p] || platformText;
  const t = normalizeText(target);
  return SYSTEMS.find((s) => normalizeText(s.short) === t || normalizeText(s.id) === t) || null;
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

class GameTrackerPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new GameDashboardView(leaf, this));
    this.addRibbonIcon("gamepad-2", "Open game tracker", () => this.activateView());

    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => this.activateView() });
    this.addCommand({ id: "add-game", name: "Add game (search)", callback: () => this.openAddFlow() });
    this.addCommand({
      id: "fetch-info",
      name: "Fetch game info for current note",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || !this.inFolder(f) || f.extension !== "md") return false;
        if (!checking) this.openFetchInfo(f);
        return true;
      },
    });
    this.addCommand({
      id: "mark-playing",
      name: "Mark current note as playing",
      checkCallback: (checking) => {
        const g = this.getActiveGame();
        if (!g) return false;
        if (!checking) this.setStatus(g, "playing");
        return true;
      },
    });
    this.addCommand({
      id: "mark-beaten",
      name: "Mark current note as beaten",
      checkCallback: (checking) => {
        const g = this.getActiveGame();
        if (!g) return false;
        if (!checking) new GameModal(this, g, "beaten").open();
        return true;
      },
    });
    this.addCommand({
      id: "edit-game",
      name: "Edit current game details",
      checkCallback: (checking) => {
        const g = this.getActiveGame();
        if (!g) return false;
        if (!checking) new GameModal(this, g).open();
        return true;
      },
    });

    this.addCommand({
      id: "sort-into-status-folders",
      name: "Sort games into status folders",
      callback: () => this.organizeAll(true),
    });

    this.addSettingTab(new GameTrackerSettingTab(this.app, this));

    const refresh = debounce(() => this.refreshViews(), 300, true);
    this.registerEvent(
      this.app.metadataCache.on("changed", (f) => {
        if (!this.inFolder(f)) return;
        refresh();
        this.syncFolder(f);
      })
    );
    this.app.workspace.onLayoutReady(() => this.organizeAll(false));
    this.registerEvent(this.app.vault.on("delete", (f) => this.inFolder(f) && refresh()));
    this.registerEvent(this.app.vault.on("rename", () => refresh()));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshViews();
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  refreshViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof GameDashboardView) leaf.view.render();
    });
  }

  /* ---------- add flow ---------- */

  openAddFlow(initial = "") {
    new GameSearchModal(this, {
      initial,
      onChoose: (meta) => new GameModal(this, null, null, meta).open(),
      onManual: (title) => {
        const m = new GameModal(this, null);
        m.d.title = title;
        m.open();
      },
    }).open();
  }

  openFetchInfo(file) {
    const g = this.getGame(file);
    const sys = guessSystem(g && g.platform);
    new GameSearchModal(this, {
      title: "Fetch info for this game",
      initial: file.basename.replace(/\s*\([^)]*\)\s*$/, ""),
      source: sys ? "retro" : undefined,
      systemId: sys ? sys.id : undefined,
      onChoose: (meta) => this.applyMeta(file, meta),
    }).open();
  }

  /* ---------- libretro (retro games, no key) ---------- */

  dbCachePath(sys) {
    const dir = normalizePath(`${this.manifest.dir}/cache`);
    return { dir, file: normalizePath(`${dir}/${sys.id.replace(/[^a-z0-9]+/gi, "_")}.json`) };
  }

  async hasDbCache(sys) {
    try {
      return await this.app.vault.adapter.exists(this.dbCachePath(sys).file);
    } catch (e) {
      return false;
    }
  }

  async getSystemDb(sys) {
    if (this._db && this._db.id === sys.id) return this._db.games;
    if (this._dbLoading && this._dbLoading.id === sys.id) return this._dbLoading.promise;
    const promise = this.loadSystemDb(sys);
    this._dbLoading = { id: sys.id, promise };
    try {
      const games = await promise;
      this._db = { id: sys.id, games };
      return games;
    } finally {
      this._dbLoading = null;
    }
  }

  async loadSystemDb(sys) {
    const adapter = this.app.vault.adapter;
    const { dir, file } = this.dbCachePath(sys);
    let stored = null;
    try {
      if (await adapter.exists(file)) stored = JSON.parse(await adapter.read(file));
    } catch (e) {
      stored = null;
    }
    const valid = stored && stored.v === DB_VERSION && Array.isArray(stored.games);
    if (valid && Date.now() - stored.fetched < DB_MAX_AGE_MS) return decorateGames(unpackDb(stored));

    try {
      const games = await this.downloadSystemDb(sys);
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
      const packed = packDb(games);
      await adapter.write(file, JSON.stringify({ v: DB_VERSION, fetched: Date.now(), ...packed }));
      return decorateGames(games);
    } catch (e) {
      if (valid) return decorateGames(unpackDb(stored)); // stale cache beats nothing
      throw e;
    }
  }

  async downloadSystemDb(sys) {
    const fetchDat = async (folder, name) => {
      try {
        const r = await requestUrl({ url: `${LIBRETRO_META}/${folder}/${encodeURIComponent(name)}.dat`, throw: false });
        return r.status === 200 ? r.text : null;
      } catch (e) {
        return null;
      }
    };
    const metaName = sys.metaName || sys.id;
    const [list, ...metas] = await Promise.all([
      fetchDat(sys.src, sys.id),
      fetchDat("developer", metaName),
      fetchDat("genre", metaName),
      fetchDat("releaseyear", metaName),
      fetchDat("franchise", metaName),
    ]);
    if (!list) throw new Error(`Couldn't download the ${sys.short} game list. Check your connection and try again.`);
    return buildDb(list, metas.filter(Boolean));
  }

  /** Best-effort description from Wikipedia. Returns {text, url} or null. */
  async wikiSummary(title, systemShort) {
    try {
      const q = `${title} ${systemShort} video game`;
      const s = await requestUrl({
        url: `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=4&format=json`,
        throw: false,
      });
      const hits = (s.json && s.json.query && s.json.query.search) || [];
      const want = normalizeText(title);
      for (const h of hits) {
        const have = normalizeText(h.title.replace(/\s*\([^)]*\)\s*$/, ""));
        if (!(have === want || have.startsWith(want) || want.startsWith(have))) continue;
        const r = await requestUrl({
          url: `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
          throw: false,
        });
        if (r.status !== 200 || !r.json || !r.json.extract) continue;
        if (!/game/i.test(r.json.description || "")) continue; // make sure it's a video game page
        const page = (r.json.content_urls && r.json.content_urls.desktop && r.json.content_urls.desktop.page) || "";
        return { text: r.json.extract, url: page };
      }
    } catch (e) {
      console.error("Game Tracker: Wikipedia lookup failed", e);
    }
    return null;
  }

  /* ---------- RAWG (optional, modern games) ---------- */

  async rawgGet(path, params = {}) {
    const key = this.settings.rawgKey.trim();
    if (!key) throw new Error("Modern game search needs a RAWG API key. Add one in the plugin settings.");
    const qs = new URLSearchParams({ key, ...params }).toString();
    let res;
    try {
      res = await requestUrl({ url: `${RAWG_API}${path}?${qs}`, throw: false });
    } catch (e) {
      throw new Error("Could not reach RAWG. Check your connection.");
    }
    if (res.status === 401 || res.status === 403) throw new Error("RAWG rejected your API key. Check it in settings.");
    if (res.status === 429) throw new Error("RAWG rate limit reached. Try again later.");
    if (res.status !== 200) throw new Error(`RAWG returned an error (${res.status}).`);
    return res.json;
  }

  async rawgSearch(query) {
    const json = await this.rawgGet("/games", { search: query, page_size: "8" });
    return (json.results || []).map(normalizeRawg);
  }

  async rawgDetails(id) {
    return normalizeRawg(await this.rawgGet(`/games/${id}`));
  }

  /* ---------- covers and notes ---------- */

  async ensureFolder(path) {
    const p = normalizePath(path);
    if (this.app.vault.getAbstractFileByPath(p)) return;
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    if (parent) await this.ensureFolder(parent);
    await this.app.vault.createFolder(p);
  }

  /** Returns a vault path (saved), a working remote URL (if saving is off), or "" if none loads. */
  async downloadCover(meta) {
    const urls = meta.imageUrls && meta.imageUrls.length ? meta.imageUrls : meta.image ? [meta.image] : [];
    if (!urls.length) return "";
    const candidates = [];
    for (const u of urls) {
      const r = resizeUrl(u, 640);
      candidates.push(r);
      if (r !== u) candidates.push(u);
    }
    const extOf = (u) => ((u.match(/\.(jpg|jpeg|png|webp)(\?|$)/i) || [])[1] || "jpg").toLowerCase();
    const base = slugify(meta.slug || String(meta.id)) || "cover";
    const folder = normalizePath(`${this.settings.folder}/_covers`);

    if (this.settings.downloadCovers) {
      for (const ext of ["png", "jpg", "jpeg", "webp"]) {
        const existing = normalizePath(`${folder}/${base}.${ext}`);
        if (this.app.vault.getAbstractFileByPath(existing)) return existing;
      }
    }
    for (const url of candidates) {
      let res;
      try {
        res = await requestUrl({ url, throw: false });
      } catch (e) {
        continue;
      }
      if (res.status !== 200 || !res.arrayBuffer || res.arrayBuffer.byteLength < 200) continue;
      if (!this.settings.downloadCovers) return url;
      try {
        await this.ensureFolder(folder);
        const path = normalizePath(`${folder}/${base}.${extOf(url)}`);
        await this.app.vault.createBinary(path, res.arrayBuffer);
        return path;
      } catch (e) {
        console.error("Game Tracker: could not save cover", e);
        return url;
      }
    }
    return "";
  }

  metaPatch(meta, cover) {
    const base = {
      cover,
      released: /^\d{4}$/.test(meta.released || "") ? Number(meta.released) : meta.released,
      developer: meta.developers,
      publisher: meta.publishers,
      metacritic: meta.metacritic,
    };
    if (meta.source === "retro") {
      Object.assign(base, { region: meta.region, franchise: meta.franchise, libretro_name: meta.id });
    } else {
      Object.assign(base, { rawg_id: meta.id, rawg_url: meta.url });
    }
    return base;
  }

  /** Cover embed + short description + source credit, as note text. */
  infoBlock(meta, cover) {
    if (!meta) return "";
    let out = "";
    if (cover) {
      out += /^https?:/i.test(cover) ? `![|260](${cover})\n\n` : `![[${cover}|260]]\n\n`;
    }
    if (meta.description) out += `## About\n${shorten(meta.description)}\n\n`;
    const credits = [];
    if (meta.source === "rawg") credits.push(`[RAWG](${meta.url})`);
    if (meta.source === "retro") {
      credits.push(
        "the [libretro database](https://github.com/libretro/libretro-database) and [thumbnails](https://github.com/libretro-thumbnails/libretro-thumbnails)"
      );
    }
    if (meta.descUrl) credits.push(`[Wikipedia](${meta.descUrl})`);
    if (credits.length) out += `*Game info from ${credits.join(" and ")}.*\n\n`;
    return out;
  }

  /** Fill in details for an existing note from a search result. */
  async applyMeta(file, meta) {
    new Notice(`Fetching info for ${meta.name}...`);
    const g = this.getGame(file);
    const cover = await this.downloadCover(meta);
    const patch = this.metaPatch(meta, cover);
    if (!g || !g.genre.length) patch.genre = meta.genres;
    if (meta.source === "retro" && (!g || !g.platform)) patch.platform = meta.platforms[0];
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
    );
    await this.updateGame(file, clean);

    const info = this.infoBlock(meta, cover);
    await this.app.vault.process(file, (data) => {
      if (/^## About/m.test(data) || !info.trim()) return data;
      const m = data.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      const at = m ? m[0].length : 0;
      return data.slice(0, at) + "\n" + info + data.slice(at);
    });
    new Notice(`Updated ${file.basename}.`);
  }

  /* ---------- data ---------- */

  inFolder(file) {
    const folder = normalizePath(this.settings.folder);
    return !!file && !!file.path && file.path.startsWith(folder + "/");
  }

  getGame(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || !(fm.type === "game" || fm.status)) return null;
    const status = STATUSES.some((s) => s.id === fm.status) ? fm.status : "backlog";
    const started = parseDate(fm.started);
    const finished = parseDate(fm.finished);
    return {
      file,
      title: file.basename,
      status,
      platform: fm.platform ? String(fm.platform) : "",
      genre: toList(fm.genre),
      started: started ? started.format(DATE_FMT) : "",
      finished: finished ? finished.format(DATE_FMT) : "",
      rating: Number(fm.rating) || 0,
      hours: Number(fm.hours) || 0,
      cover: fm.cover ? String(fm.cover) : "",
      released: fm.released ? String(fm.released).slice(0, 10) : "",
      developer: toList(fm.developer),
      metacritic: Number(fm.metacritic) || 0,
      fromRawg: !!(fm.rawg_url || fm.rawg_id),
      fromLibretro: !!fm.libretro_name,
    };
  }

  getGames() {
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => this.inFolder(f))
      .map((f) => this.getGame(f))
      .filter(Boolean);
  }

  /** Subfolder of the games folder that holds notes with this status. */
  statusFolder(status) {
    const s = STATUSES.find((x) => x.id === status);
    return normalizePath(`${this.settings.folder}/${s.folder}`);
  }

  /** Moves a game note into its status folder, if status folders are on. */
  async syncFolder(file) {
    if (!this.settings.statusFolders || file.extension !== "md") return false;
    // Only act on a valid status, so half-typed values in the properties editor don't move the note.
    const status = this.app.metadataCache.getFileCache(file)?.frontmatter?.status;
    if (!STATUSES.some((s) => s.id === status)) return false;
    const folder = this.statusFolder(status);
    if (file.parent?.path === folder) return false;
    const dest = normalizePath(`${folder}/${file.name}`);
    if (this.app.vault.getAbstractFileByPath(dest)) {
      new Notice(`Couldn't move "${file.basename}": ${folder} already has a note with that name.`);
      return false;
    }
    await this.ensureFolder(folder);
    await this.app.fileManager.renameFile(file, dest);
    return true;
  }

  async organizeAll(notify) {
    if (!this.settings.statusFolders) {
      if (notify) new Notice("Turn on status folders in the Game Tracker settings first.");
      return;
    }
    let moved = 0;
    for (const g of this.getGames()) if (await this.syncFolder(g.file)) moved++;
    if (notify || moved) new Notice(moved ? `Moved ${moved} game${moved === 1 ? "" : "s"} into status folders.` : "All games are already in their status folders.");
  }

  getActiveGame() {
    const file = this.app.workspace.getActiveFile();
    return file && this.inFolder(file) ? this.getGame(file) : null;
  }

  async updateGame(file, patch) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.type = "game";
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) {
          delete fm[k];
        } else {
          fm[k] = v;
        }
      }
    });
  }

  /** Quick status change with sensible dates. */
  async setStatus(game, status) {
    const patch = { status };
    if (status === "playing" && !game.started) patch.started = today();
    if (FINISHED.includes(status)) {
      if (!game.finished) patch.finished = today();
    } else {
      patch.finished = null;
    }
    await this.updateGame(game.file, patch);
    new Notice(`${game.title}: ${statusLabel(status)}`);
  }

  /** Create a game note. `meta` (optional) is a search result to import. */
  async createGame(title, patch, meta) {
    const name = sanitizeName(title);
    if (!name) {
      new Notice("Enter a game title first.");
      return null;
    }
    const status = STATUSES.some((s) => s.id === patch.status) ? patch.status : "backlog";
    const folder = this.settings.statusFolders ? this.statusFolder(status) : normalizePath(this.settings.folder);
    await this.ensureFolder(folder);

    // With status folders, a title can live in any subfolder, so check the whole library.
    const taken = (n) =>
      this.app.vault.getMarkdownFiles().some((f) => this.inFolder(f) && f.basename === n);
    let fileName = name;
    if (taken(fileName) && patch.platform) {
      // Same title on another system (e.g. Sonic on Genesis and Game Gear): add the platform.
      fileName = sanitizeName(`${name} (${patch.platform})`);
    }
    const path = normalizePath(`${folder}/${fileName}.md`);
    if (taken(fileName)) {
      new Notice(`"${name}" is already in your library.`);
      return null;
    }

    let cover = "";
    if (meta) {
      cover = await this.downloadCover(meta);
      Object.assign(patch, this.metaPatch(meta, cover));
    }
    const body = this.infoBlock(meta, cover) + "## Notes\n\n";
    const file = await this.app.vault.create(path, `---\ntype: game\n---\n\n${body}`);
    await this.updateGame(file, patch);
    return file;
  }
}

module.exports = GameTrackerPlugin;
// Exposed for testing outside Obsidian.
module.exports.__test = { parseDat, buildDb, packDb, unpackDb, searchGames, displayTitle, regionOf, thumbUrl, decorateGames, guessSystem, SYSTEMS };

/* ------------------------------------------------------------------ */
/* Search modal                                                        */
/* ------------------------------------------------------------------ */

class GameSearchModal extends Modal {
  /**
   * opts: { initial, title, source, systemId, onChoose(meta), onManual?(title) }
   */
  constructor(plugin, opts) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts;
    this.source = opts.source || plugin.settings.lastSource || "retro";
    this.systemId = opts.systemId || plugin.settings.lastSystem || DEFAULT_SYSTEM;
    this.results = [];
    this.lastQuery = "";
    this.seq = 0;
    this.run = debounce(() => this.search(), 250, true);
  }

  get system() {
    return SYSTEMS.find((s) => s.id === this.systemId) || SYSTEMS.find((s) => s.id === DEFAULT_SYSTEM);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("gt-search-modal");
    this.titleEl.setText(this.opts.title || "Search for a game");

    const row = contentEl.createDiv("gt-search-row");
    const srcSel = row.createEl("select");
    srcSel.createEl("option", { text: "Retro games", value: "retro" });
    srcSel.createEl("option", { text: "Modern games (RAWG)", value: "rawg" });
    srcSel.value = this.source;

    this.sysSel = row.createEl("select");
    [...SYSTEMS]
      .sort((a, b) => a.short.localeCompare(b.short, undefined, { numeric: true, sensitivity: "base" }))
      .forEach((s) => this.sysSel.createEl("option", { text: s.short, value: s.id }));
    this.sysSel.value = this.system.id;
    this.sysSel.style.display = this.source === "retro" ? "" : "none";

    srcSel.onchange = () => {
      this.source = srcSel.value;
      this.plugin.settings.lastSource = this.source;
      this.plugin.saveData(this.plugin.settings);
      this.sysSel.style.display = this.source === "retro" ? "" : "none";
      this.search();
      this.input.focus();
    };
    this.sysSel.onchange = () => {
      this.systemId = this.sysSel.value;
      this.plugin.settings.lastSystem = this.systemId;
      this.plugin.saveData(this.plugin.settings);
      this.search();
      this.input.focus();
    };

    this.input = contentEl.createEl("input", {
      cls: "gt-search-input",
      attr: { type: "text", placeholder: "Type a game title", spellcheck: "false" },
    });
    this.input.value = this.opts.initial || "";
    this.input.addEventListener("input", () => this.run());
    this.input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const q = this.input.value.trim();
      if (this.results.length && q === this.lastQuery) this.choose(this.results[0]);
      else this.search();
    });

    this.listEl = contentEl.createDiv("gt-results");

    const foot = contentEl.createDiv("gt-search-foot");
    if (this.opts.onManual) {
      const b = foot.createEl("button", { text: "Add manually instead" });
      b.onclick = () => {
        const t = this.input.value.trim();
        this.close();
        this.opts.onManual(t);
      };
    }
    const credit = foot.createDiv("gt-credit");
    credit.createEl("a", { text: "libretro", attr: { href: "https://github.com/libretro/libretro-database" } });
    credit.appendText(" and ");
    credit.createEl("a", { text: "RAWG", attr: { href: "https://rawg.io" } });

    setTimeout(() => {
      this.input.focus();
      this.input.select();
    }, 50);
    if (this.input.value.trim()) this.search();
  }

  showMessage(text) {
    this.listEl.empty();
    this.listEl.createDiv({ cls: "gt-empty", text });
  }

  async search() {
    const q = this.input.value.trim();
    this.lastQuery = q;
    const stamp = ++this.seq;
    if (q.length < 2) {
      this.results = [];
      this.listEl.empty();
      return;
    }
    try {
      let res;
      if (this.source === "rawg") {
        this.showMessage("Searching...");
        res = await this.plugin.rawgSearch(q);
      } else {
        const sys = this.system;
        const cached = await this.plugin.hasDbCache(sys);
        this.showMessage(cached ? `Searching ${sys.short}...` : `Downloading the ${sys.short} game list. This only happens the first time.`);
        const games = await this.plugin.getSystemDb(sys);
        res = searchGames(games, sys, q);
      }
      if (stamp !== this.seq) return;
      this.results = res;
      this.renderResults(q);
    } catch (e) {
      if (stamp !== this.seq) return;
      this.results = [];
      this.showMessage(e.message || "Search failed.");
    }
  }

  renderResults(q) {
    this.listEl.empty();
    if (!this.results.length) {
      const sysNote = this.source === "retro" ? ` in ${this.system.short}` : "";
      this.showMessage(`No matches for "${q}"${sysNote}. Try fewer words, check the system, or add it manually.`);
      return;
    }
    this.results.forEach((r) => {
      const row = this.listEl.createDiv("gt-result");
      const thumb = row.createDiv("gt-result-thumb");
      if (r.source === "retro") {
        loadImageChain(thumb.createEl("img", { attr: { alt: "", loading: "lazy" } }), r.imageUrls);
      } else if (r.image) {
        thumb.createEl("img", { attr: { src: resizeUrl(r.image, 200), loading: "lazy", alt: "" } });
      }
      const text = row.createDiv("gt-result-text");
      text.createDiv({ text: r.name, cls: "gt-result-name" });
      let sub;
      if (r.source === "retro") {
        const bits = [r.released || "Year unknown"];
        if (r.developers[0]) bits.push(r.developers[0]);
        if (r.region) bits.push(r.region);
        sub = bits.join(", ");
        if (r.otherReleases > 0) sub += `, ${r.otherReleases} other version${r.otherReleases === 1 ? "" : "s"}`;
      } else {
        const year = r.released ? r.released.slice(0, 4) : "Unreleased";
        const plats = r.platforms.slice(0, 4).join(", ") + (r.platforms.length > 4 ? ` and ${r.platforms.length - 4} more` : "");
        sub = plats ? `${year}, ${plats}` : year;
      }
      text.createDiv({ text: sub, cls: "gt-result-sub" });
      row.onclick = () => this.choose(r);
    });
  }

  async choose(r) {
    let meta = r;
    this.showMessage(`Loading ${r.name}...`);
    try {
      if (r.source === "rawg") {
        meta = await this.plugin.rawgDetails(r.id);
      } else {
        meta = { ...r };
        if (!meta.description && this.plugin.settings.wikipedia) {
          this.showMessage(`Looking for a description of ${r.name}...`);
          const w = await this.plugin.wikiSummary(meta.name, meta.platforms[0]);
          if (w) {
            meta.description = w.text;
            meta.descUrl = w.url;
          }
        }
      }
    } catch (e) {
      console.error("Game Tracker: could not load details, using search result", e);
    }
    this.close();
    this.opts.onChoose(meta);
  }

  onClose() {
    this.seq++;
    this.contentEl.empty();
  }
}

/* ------------------------------------------------------------------ */
/* Add / edit modal                                                    */
/* ------------------------------------------------------------------ */

class GameModal extends Modal {
  /**
   * @param plugin   the plugin
   * @param game     existing game object (edit) or null (add)
   * @param preset   optional status to preselect (fills in sensible dates)
   * @param meta     optional search result to import when adding
   */
  constructor(plugin, game, preset, meta) {
    super(plugin.app);
    this.plugin = plugin;
    this.game = game;
    this.meta = meta || null;
    this.d = game
      ? { ...game, genre: game.genre.join(", "), hours: game.hours || "" }
      : {
          title: meta ? meta.name : "",
          status: "backlog",
          platform: meta && meta.source === "retro" ? meta.platforms[0] : "",
          genre: meta ? meta.genres.join(", ") : "",
          started: "",
          finished: "",
          rating: 0,
          hours: "",
        };
    if (preset) {
      this.d.status = preset;
      this.applyStatusDefaults();
    }
  }

  applyStatusDefaults() {
    const d = this.d;
    if (d.status === "playing" && !d.started) d.started = today();
    if (FINISHED.includes(d.status) && !d.finished) d.finished = today();
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl, d } = this;
    contentEl.empty();
    contentEl.addClass("gt-modal");
    this.titleEl.setText(this.game ? `Edit ${this.game.title}` : "Add a game");

    if (this.meta) {
      const m = this.meta;
      const pv = contentEl.createDiv("gt-preview");
      const imgs = m.imageUrls && m.imageUrls.length ? m.imageUrls : m.image ? [resizeUrl(m.image, 420)] : [];
      if (imgs.length) loadImageChain(pv.createEl("img", { attr: { alt: "" } }), imgs);
      const t = pv.createDiv("gt-preview-text");
      t.createDiv({ text: m.name, cls: "gt-preview-name" });
      const bits = [];
      if (m.released) bits.push(String(m.released).slice(0, 4));
      if (m.developers[0]) bits.push(m.developers[0]);
      if (m.region) bits.push(m.region);
      if (m.metacritic) bits.push(`Metacritic ${m.metacritic}`);
      if (bits.length) t.createDiv({ text: bits.join(", "), cls: "gt-preview-sub" });
    }

    if (!this.game) {
      new Setting(contentEl).setName("Title").addText((t) => {
        t.setPlaceholder("Hollow Knight")
          .setValue(d.title)
          .onChange((v) => (d.title = v));
        t.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") this.save();
        });
        if (!this.meta) setTimeout(() => t.inputEl.focus(), 50);
      });
    }

    new Setting(contentEl).setName("Status").addDropdown((dd) => {
      STATUSES.forEach((s) => dd.addOption(s.id, s.label));
      dd.setValue(d.status).onChange((v) => {
        d.status = v;
        this.applyStatusDefaults();
        this.render();
      });
    });

    const platformList = contentEl.createEl("datalist", { attr: { id: "gt-platforms" } });
    const platforms = new Set([
      ...(this.meta ? this.meta.platforms : []),
      ...SYSTEMS.map((s) => s.short),
      ...this.plugin.settings.platforms,
      ...this.plugin.getGames().map((g) => g.platform),
    ]);
    [...platforms].filter(Boolean).forEach((p) => platformList.createEl("option", { value: p }));
    new Setting(contentEl)
      .setName("Platform")
      .setDesc("Where you play it. For emulated games, use the original system.")
      .addText((t) => {
        t.setPlaceholder("SNES").setValue(d.platform).onChange((v) => (d.platform = v));
        t.inputEl.setAttribute("list", "gt-platforms");
      });

    new Setting(contentEl)
      .setName("Genres")
      .setDesc("Separate with commas.")
      .addText((t) => t.setPlaceholder("Platformer, Action").setValue(d.genre).onChange((v) => (d.genre = v)));

    new Setting(contentEl).setName("Started").addText((t) => {
      t.inputEl.type = "date";
      t.setValue(d.started).onChange((v) => (d.started = v));
    });

    if (FINISHED.includes(d.status)) {
      new Setting(contentEl)
        .setName(d.status === "completed" ? "Completed on" : "Beaten on")
        .addText((t) => {
          t.inputEl.type = "date";
          t.setValue(d.finished).onChange((v) => (d.finished = v));
        });
    }

    new Setting(contentEl)
      .setName("Rating")
      .setDesc("Out of 10.")
      .addDropdown((dd) => {
        dd.addOption("0", "Not rated");
        for (let i = 1; i <= 10; i++) dd.addOption(String(i), String(i));
        dd.setValue(String(d.rating || 0)).onChange((v) => (d.rating = Number(v)));
      });

    new Setting(contentEl).setName("Hours played").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.min = "0";
      t.inputEl.step = "0.5";
      t.setPlaceholder("0").setValue(String(d.hours)).onChange((v) => (d.hours = v));
    });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.game ? "Save changes" : "Add game").setCta().onClick(() => this.save()));
  }

  async save() {
    if (this.saving) return;
    const d = this.d;
    const patch = {
      status: d.status,
      platform: d.platform.trim(),
      genre: toList(d.genre),
      started: d.started || null,
      finished: FINISHED.includes(d.status) ? d.finished || today() : null,
      rating: d.rating || null,
      hours: Number(d.hours) > 0 ? Number(d.hours) : null,
    };
    if (this.game) {
      await this.plugin.updateGame(this.game.file, patch);
      new Notice("Saved.");
      this.close();
    } else {
      this.saving = true;
      if (this.meta) new Notice("Adding game and downloading cover...");
      const file = await this.plugin.createGame(d.title, patch, this.meta);
      this.saving = false;
      if (file) {
        new Notice(`Added ${file.basename}.`);
        this.close();
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ------------------------------------------------------------------ */
/* Dashboard view                                                      */
/* ------------------------------------------------------------------ */

class GameDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.tab = "library";
    this.search = "";
    this.platform = "";
    this.year = "";
    this.sort = plugin.settings.defaultSort;
    this.closed = new Set(["beaten", "completed", "dropped"]);
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Game tracker";
  }
  getIcon() {
    return "gamepad-2";
  }
  async onOpen() {
    this.render();
  }

  coverSrc(g) {
    if (!g.cover) return null;
    if (/^https?:/i.test(g.cover)) return g.cover;
    const m = g.cover.match(/^!?\[\[([^|\]]+)/);
    const link = m ? m[1] : g.cover;
    const f =
      this.app.metadataCache.getFirstLinkpathDest(link, "") || this.app.vault.getAbstractFileByPath(normalizePath(link));
    return f && f.extension ? this.app.vault.getResourcePath(f) : null;
  }

  openNote(file) {
    this.app.workspace.getLeaf("tab").openFile(file);
  }

  render() {
    const c = this.contentEl;
    const scroll = c.scrollTop;
    c.empty();
    c.addClass("gt-root");
    this.games = this.plugin.getGames();

    const head = c.createDiv("gt-header");
    head.createEl("h2", { text: "Game tracker" });
    const add = head.createEl("button", { text: "Add game", cls: "mod-cta" });
    add.onclick = () => this.plugin.openAddFlow();

    this.renderStats(c);
    this.renderToolbar(c);
    this.bodyEl = c.createDiv("gt-body");
    this.renderBody();

    const useLibretro = this.games.some((g) => g.fromLibretro);
    const useRawg = this.games.some((g) => g.fromRawg);
    if (useLibretro || useRawg) {
      const foot = c.createDiv("gt-footer");
      foot.appendText("Game info from ");
      if (useLibretro) {
        foot.createEl("a", { text: "libretro", attr: { href: "https://github.com/libretro/libretro-database" } });
        if (useRawg) foot.appendText(" and ");
      }
      if (useRawg) foot.createEl("a", { text: "RAWG", attr: { href: "https://rawg.io" } });
    }
    c.scrollTop = scroll;
  }

  /* ---------- stats ---------- */

  renderStats(parent) {
    const games = this.games;
    const year = String(moment().year());
    const finished = games.filter((g) => FINISHED.includes(g.status));
    const thisYear = finished.filter((g) => g.finished.startsWith(year)).length;
    const rated = games.filter((g) => g.rating);
    const avg = rated.length ? (rated.reduce((a, g) => a + g.rating, 0) / rated.length).toFixed(1) : "-";

    const tiles = [
      [games.filter((g) => g.status === "playing").length, "Playing now"],
      [games.filter((g) => g.status === "backlog").length, "In backlog"],
      [thisYear, `Beaten in ${year}`],
      [finished.length, "Beaten overall"],
      [avg, "Average rating"],
    ];
    const row = parent.createDiv("gt-stats");
    tiles.forEach(([n, label]) => {
      const t = row.createDiv("gt-stat");
      t.createDiv({ cls: "gt-stat-num", text: String(n) });
      t.createDiv({ cls: "gt-stat-label", text: label });
    });
  }

  /* ---------- toolbar ---------- */

  renderToolbar(parent) {
    const bar = parent.createDiv("gt-toolbar");

    const tabs = bar.createDiv("gt-tabs");
    [
      ["library", "Library"],
      ["log", "Beaten log"],
    ].forEach(([id, label]) => {
      const b = tabs.createEl("button", { text: label, cls: this.tab === id ? "is-active" : "" });
      b.onclick = () => {
        this.tab = id;
        this.render();
      };
    });

    const search = bar.createEl("input", {
      cls: "gt-search",
      attr: { type: "search", placeholder: "Search your games" },
    });
    search.value = this.search;
    search.oninput = () => {
      this.search = search.value;
      this.renderBody();
    };

    const platforms = [...new Set(this.games.map((g) => g.platform).filter(Boolean))].sort();
    const pSel = bar.createEl("select");
    pSel.createEl("option", { text: "All platforms", value: "" });
    platforms.forEach((p) => pSel.createEl("option", { text: p, value: p }));
    pSel.value = this.platform;
    pSel.onchange = () => {
      this.platform = pSel.value;
      this.renderBody();
    };

    if (this.tab === "log") {
      const years = [...new Set(this.games.map((g) => g.finished.slice(0, 4)).filter(Boolean))].sort().reverse();
      const ySel = bar.createEl("select");
      ySel.createEl("option", { text: "All years", value: "" });
      years.forEach((y) => ySel.createEl("option", { text: y, value: y }));
      ySel.value = this.year;
      ySel.onchange = () => {
        this.year = ySel.value;
        this.renderBody();
      };
    } else {
      const sSel = bar.createEl("select");
      [
        ["title", "Sort by title"],
        ["recent", "Recently changed"],
        ["rating", "Highest rated"],
        ["hours", "Most hours"],
      ].forEach(([v, l]) => sSel.createEl("option", { text: l, value: v }));
      sSel.value = this.sort;
      sSel.onchange = () => {
        this.sort = sSel.value;
        this.renderBody();
      };
    }
  }

  /* ---------- body ---------- */

  filtered() {
    const q = this.search.trim().toLowerCase();
    return this.games.filter(
      (g) =>
        (!this.platform || g.platform === this.platform) &&
        (!q || [g.title, g.platform, ...g.genre, ...g.developer].join(" ").toLowerCase().includes(q))
    );
  }

  sortGames(list) {
    const by = {
      title: (a, b) => a.title.localeCompare(b.title),
      recent: (a, b) => b.file.stat.mtime - a.file.stat.mtime,
      rating: (a, b) => b.rating - a.rating || a.title.localeCompare(b.title),
      hours: (a, b) => b.hours - a.hours || a.title.localeCompare(b.title),
    };
    return [...list].sort(by[this.sort] || by.title);
  }

  renderBody() {
    const body = this.bodyEl;
    body.empty();
    if (!this.games.length) {
      const empty = body.createDiv("gt-empty-state");
      empty.createEl("p", { text: "No games yet. Search for one to add it with its box art and details." });
      const b = empty.createEl("button", { text: "Add your first game", cls: "mod-cta" });
      b.onclick = () => this.plugin.openAddFlow();
      return;
    }
    if (this.tab === "log") this.renderLog(body);
    else this.renderLibrary(body);
  }

  renderLibrary(body) {
    const games = this.filtered();
    const searching = !!this.search.trim();

    for (const s of STATUSES) {
      const list = this.sortGames(games.filter((g) => g.status === s.id));
      if (!list.length && s.id !== "playing") continue;

      const det = body.createEl("details", { cls: "gt-section" });
      if (!this.closed.has(s.id) || (searching && list.length)) det.open = true;
      det.addEventListener("toggle", () => {
        if (searching) return;
        det.open ? this.closed.delete(s.id) : this.closed.add(s.id);
      });

      const sum = det.createEl("summary");
      setIcon(sum.createSpan("gt-sec-icon"), s.icon);
      sum.createSpan({ text: s.label, cls: "gt-sec-title" });
      sum.createSpan({ text: String(list.length), cls: "gt-count" });

      const grid = det.createDiv("gt-grid");
      if (!list.length) {
        grid.createDiv({
          cls: "gt-empty",
          text: "Nothing in progress. Start something from Up next or your backlog.",
        });
      }
      list.forEach((g) => this.renderCard(grid, g));
    }
  }

  renderCard(grid, g) {
    const card = grid.createDiv({ cls: `gt-card gt-status-${g.status}` });

    const src = this.coverSrc(g);
    if (src) {
      const cover = card.createDiv("gt-cover");
      const img = cover.createEl("img", { attr: { src, loading: "lazy", alt: "" } });
      // Box art is often portrait; show it whole instead of cropping it to a banner.
      img.onload = () => {
        if (img.naturalHeight > img.naturalWidth * 0.9) cover.addClass("is-boxart");
      };
      cover.onclick = () => this.openNote(g.file);
    }

    const main = card.createDiv("gt-card-main");

    const top = main.createDiv("gt-card-top");
    const titleWrap = top.createDiv("gt-title-wrap");
    const title = titleWrap.createEl("a", { text: g.title, cls: "gt-title" });
    title.onclick = (e) => {
      e.preventDefault();
      this.openNote(g.file);
    };
    const sub = [g.developer[0], g.released && g.released.slice(0, 4)].filter(Boolean).join(", ");
    if (sub) titleWrap.createDiv({ text: sub, cls: "gt-sub" });

    const more = top.createEl("button", { cls: "clickable-icon gt-more", attr: { "aria-label": "More actions" } });
    setIcon(more, "more-vertical");
    more.onclick = (e) => {
      const m = new Menu();
      STATUSES.forEach((s) =>
        m.addItem((i) =>
          i
            .setTitle(s.label)
            .setIcon(s.icon)
            .setChecked(g.status === s.id)
            .onClick(() => {
              if (FINISHED.includes(s.id)) new GameModal(this.plugin, g, s.id).open();
              else this.plugin.setStatus(g, s.id);
            })
        )
      );
      m.addSeparator();
      m.addItem((i) => i.setTitle("Edit details").setIcon("pencil").onClick(() => new GameModal(this.plugin, g).open()));
      m.addItem((i) =>
        i
          .setTitle(g.cover ? "Refresh game info" : "Fetch game info")
          .setIcon("download")
          .onClick(() => this.plugin.openFetchInfo(g.file))
      );
      m.addItem((i) => i.setTitle("Open note").setIcon("file-text").onClick(() => this.openNote(g.file)));
      m.showAtMouseEvent(e);
    };

    const chips = main.createDiv("gt-chips");
    if (g.platform) chips.createSpan({ text: g.platform, cls: "gt-chip gt-chip-platform" });
    g.genre.slice(0, 3).forEach((x) => chips.createSpan({ text: x, cls: "gt-chip" }));

    const info = main.createDiv("gt-info");
    if (g.status === "playing" && g.started) {
      const days = daysBetween(g.started, today());
      info.createDiv({ text: `Started ${fmtDate(g.started)}` + (days ? ` (${days} days ago)` : " (today)") });
    } else if (FINISHED.includes(g.status)) {
      const verb = g.status === "completed" ? "100%'d" : "Beaten";
      const days = daysBetween(g.started, g.finished);
      info.createDiv({
        text: `${verb} ${fmtDate(g.finished)}` + (days !== null ? ` in ${days} day${days === 1 ? "" : "s"}` : ""),
      });
    } else if (g.started) {
      info.createDiv({ text: `Started ${fmtDate(g.started)}` });
    }
    const score = [];
    if (g.rating) score.push(`${g.rating}/10`);
    if (g.hours) score.push(`${g.hours}h played`);
    if (score.length) info.createDiv({ text: score.join(", "), cls: "gt-score" });

    const actions = main.createDiv("gt-actions");
    const act = (label, icon, fn, cta) => {
      const b = actions.createEl("button", { cls: cta ? "mod-cta" : "" });
      setIcon(b.createSpan("gt-btn-icon"), icon);
      b.createSpan({ text: label });
      b.onclick = fn;
    };
    if (g.status === "playing") {
      act("Beat it", "check", () => new GameModal(this.plugin, g, "beaten").open(), true);
    } else if (g.status === "next" || g.status === "backlog" || g.status === "paused" || g.status === "dropped") {
      const fresh = g.status === "next" || g.status === "backlog";
      act(fresh ? "Start playing" : "Resume", "play", () => this.plugin.setStatus(g, "playing"), true);
      if (g.status === "backlog") act("Up next", "list-plus", () => this.plugin.setStatus(g, "next"));
    } else if (g.status === "beaten") {
      act("Mark 100%", "trophy", () => new GameModal(this.plugin, g, "completed").open());
    }
  }

  renderLog(body) {
    let list = this.filtered().filter((g) => FINISHED.includes(g.status) || g.finished);
    if (this.year) list = list.filter((g) => g.finished.startsWith(this.year));

    if (!list.length) {
      body.createDiv({ cls: "gt-empty-state", text: "No finished games match. Beat something and it will show up here." });
      return;
    }

    const dated = list.filter((g) => g.finished).sort((a, b) => b.finished.localeCompare(a.finished));
    const undated = list.filter((g) => !g.finished);

    const byYear = new Map();
    dated.forEach((g) => {
      const y = g.finished.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(g);
    });

    for (const [year, games] of byYear) {
      const sec = body.createDiv("gt-year");
      const hours = games.reduce((a, g) => a + g.hours, 0);
      const rated = games.filter((g) => g.rating);
      const avg = rated.length ? (rated.reduce((a, g) => a + g.rating, 0) / rated.length).toFixed(1) : null;

      const h = sec.createDiv("gt-year-head");
      h.createEl("h3", { text: year });
      const bits = [`${games.length} game${games.length === 1 ? "" : "s"}`];
      if (hours) bits.push(`${Math.round(hours)} hours`);
      if (avg) bits.push(`${avg} avg rating`);
      h.createSpan({ text: bits.join(", "), cls: "gt-year-sum" });

      // beaten-per-month mini chart
      const counts = Array(12).fill(0);
      games.forEach((g) => counts[Number(g.finished.slice(5, 7)) - 1]++);
      const max = Math.max(...counts, 1);
      const chart = sec.createDiv("gt-months");
      counts.forEach((n, i) => {
        const col = chart.createDiv({ cls: "gt-month", attr: { "aria-label": `${moment().month(i).format("MMMM")}: ${n}` } });
        const bar = col.createDiv("gt-month-bar");
        bar.style.height = n ? `${Math.max(12, (n / max) * 100)}%` : "2px";
        if (!n) bar.addClass("is-empty");
        col.createDiv({ cls: "gt-month-label", text: moment().month(i).format("MMM")[0] });
      });

      this.renderLogTable(sec, games);
    }

    if (undated.length) {
      const sec = body.createDiv("gt-year");
      sec.createDiv("gt-year-head").createEl("h3", { text: "No date recorded" });
      this.renderLogTable(sec, undated);
    }
  }

  renderLogTable(parent, games) {
    const wrap = parent.createDiv("gt-table-wrap");
    const table = wrap.createEl("table", { cls: "gt-table" });
    const hr = table.createEl("thead").createEl("tr");
    ["Finished", "Game", "Platform", "Rating", "Hours", "Time to beat"].forEach((t) => hr.createEl("th", { text: t }));
    const tb = table.createEl("tbody");
    games.forEach((g) => {
      const tr = tb.createEl("tr");
      tr.createEl("td", { text: g.finished ? moment(g.finished, DATE_FMT).format("MMM D") : "-" });
      const td = tr.createEl("td");
      const cell = td.createDiv("gt-game-cell");
      const src = this.coverSrc(g);
      if (src) cell.createEl("img", { cls: "gt-thumb", attr: { src, loading: "lazy", alt: "" } });
      const a = cell.createEl("a", { text: g.title });
      a.onclick = (e) => {
        e.preventDefault();
        this.openNote(g.file);
      };
      if (g.status === "completed") cell.createSpan({ text: "100%", cls: "gt-chip gt-chip-hundred" });
      tr.createEl("td", { text: g.platform || "-" });
      tr.createEl("td", { text: g.rating ? `${g.rating}/10` : "-" });
      tr.createEl("td", { text: g.hours ? String(g.hours) : "-" });
      const d = daysBetween(g.started, g.finished);
      tr.createEl("td", { text: d === null ? "-" : `${d} day${d === 1 ? "" : "s"}` });
    });
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

class GameTrackerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Games folder").setDesc("Each game is a note in this folder. Existing notes with a status property are picked up automatically.").addText((t) =>
      t
        .setPlaceholder("Games")
        .setValue(this.plugin.settings.folder)
        .onChange(async (v) => {
          this.plugin.settings.folder = v.trim() || "Games";
          await this.plugin.saveSettings();
        })
    );

    new Setting(containerEl)
      .setName("Status folders")
      .setDesc("Keeps each game in a subfolder for its status (Playing, Up next, Backlog, On hold, Beaten, Completed, Dropped) and moves it when the status changes. Turning this off leaves notes where they are.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.statusFolders).onChange(async (v) => {
          this.plugin.settings.statusFolders = v;
          await this.plugin.saveSettings();
          if (v) await this.plugin.organizeAll(true);
        })
      );

    new Setting(containerEl).setName("Retro game search").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Retro search needs no account or key. It uses the same game lists and box art that RetroArch uses. The first search for each system downloads its list once and keeps it in this plugin's folder.",
    });

    new Setting(containerEl)
      .setName("Look up descriptions on Wikipedia")
      .setDesc("Best effort. Adds a short description when libretro doesn't have one. Only used when the Wikipedia page clearly matches the game.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.wikipedia).onChange(async (v) => {
          this.plugin.settings.wikipedia = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Save covers into the vault")
      .setDesc("Saves cover images to a _covers folder inside your games folder so they work offline. When off, notes link to the image online instead.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.downloadCovers).onChange(async (v) => {
          this.plugin.settings.downloadCovers = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Modern game search (optional)").setHeading();
    const keySetting = new Setting(containerEl)
      .setName("RAWG API key")
      .setDesc("Only needed to search modern games. Free, 20,000 requests a month. Get one at ")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("Paste your key")
          .setValue(this.plugin.settings.rawgKey)
          .onChange(async (v) => {
            this.plugin.settings.rawgKey = v.trim();
            await this.plugin.saveSettings();
          });
      });
    keySetting.descEl.createEl("a", { text: "rawg.io/apidocs", attr: { href: "https://rawg.io/apidocs" } });
    keySetting.descEl.appendText(". The key is saved in this plugin's data.json inside your vault.");

    new Setting(containerEl).setName("Library").setHeading();
    new Setting(containerEl)
      .setName("Platform suggestions")
      .setDesc("Comma-separated list shown as suggestions for modern platforms. Retro systems are always suggested.")
      .addTextArea((t) =>
        t.setValue(this.plugin.settings.platforms.join(", ")).onChange(async (v) => {
          this.plugin.settings.platforms = toList(v);
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Default sort")
      .setDesc("How games are ordered in the library when you open the dashboard.")
      .addDropdown((dd) =>
        dd
          .addOption("title", "Title")
          .addOption("recent", "Recently changed")
          .addOption("rating", "Highest rated")
          .addOption("hours", "Most hours")
          .setValue(this.plugin.settings.defaultSort)
          .onChange(async (v) => {
            this.plugin.settings.defaultSort = v;
            await this.plugin.saveSettings();
          })
      );
  }
}
