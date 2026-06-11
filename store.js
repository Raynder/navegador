/**
 * Store de persistência simples em JSON, gravado em app.getPath('userData').
 * Usado para histórico de navegação e favoritos.
 *
 * Escrita atômica (arquivo temporário + rename) para evitar corrupção se o
 * processo morrer no meio da gravação. Sem dependências externas.
 */

const fs = require('fs');
const path = require('path');

class JsonStore {
  /**
   * @param {string} dir   Diretório base (normalmente app.getPath('userData')).
   * @param {string} file  Nome do arquivo (ex: 'history.json').
   * @param {any}    fallback Valor inicial caso o arquivo não exista/esteja corrompido.
   */
  constructor(dir, file, fallback) {
    this.path = path.join(dir, file);
    this.fallback = fallback;
    this.data = this._read();
  }

  _read() {
    try {
      const raw = fs.readFileSync(this.path, 'utf8');
      return JSON.parse(raw);
    } catch (_) {
      return structuredClone(this.fallback);
    }
  }

  _write() {
    try {
      const tmp = `${this.path}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.path);
    } catch (err) {
      console.error(`[Store] Falha ao gravar ${this.path}:`, err.message);
    }
  }

  get() {
    return this.data;
  }

  set(data) {
    this.data = data;
    this._write();
  }
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------
class HistoryStore {
  constructor(dir, max = 5000) {
    this.store = new JsonStore(dir, 'history.json', []);
    this.max = max;
  }

  /** Adiciona/atualiza uma visita. Agrupa entradas consecutivas da mesma URL. */
  add(url, title) {
    if (!url || url === 'about:blank' || url.startsWith('file://')) return;
    const list = this.store.get();
    const last = list[0];
    const now = Date.now();

    if (last && last.url === url) {
      last.title = title || last.title;
      last.visitedAt = now;
      last.visits = (last.visits || 1) + 1;
    } else {
      list.unshift({ url, title: title || url, visitedAt: now, visits: 1 });
    }

    if (list.length > this.max) list.length = this.max;
    this.store.set(list);
  }

  list(limit = 500) {
    return this.store.get().slice(0, limit);
  }

  search(query, limit = 200) {
    const q = query.toLowerCase();
    return this.store
      .get()
      .filter((e) => e.url.toLowerCase().includes(q) || (e.title || '').toLowerCase().includes(q))
      .slice(0, limit);
  }

  clear() {
    this.store.set([]);
  }

  removeUrl(url) {
    this.store.set(this.store.get().filter((e) => e.url !== url));
  }
}

// ---------------------------------------------------------------------------
// Favoritos
// ---------------------------------------------------------------------------
class BookmarksStore {
  constructor(dir) {
    this.store = new JsonStore(dir, 'bookmarks.json', []);
  }

  list() {
    return this.store.get();
  }

  has(url) {
    return this.store.get().some((b) => b.url === url);
  }

  add(url, title) {
    if (!url || this.has(url)) return this.store.get();
    const list = this.store.get();
    list.push({ url, title: title || url, addedAt: Date.now() });
    this.store.set(list);
    return list;
  }

  remove(url) {
    this.store.set(this.store.get().filter((b) => b.url !== url));
    return this.store.get();
  }

  toggle(url, title) {
    if (this.has(url)) {
      this.remove(url);
      return { bookmarked: false, list: this.store.get() };
    }
    this.add(url, title);
    return { bookmarked: true, list: this.store.get() };
  }
}

// ---------------------------------------------------------------------------
// Sessão (abas abertas — restaura no próximo start)
// ---------------------------------------------------------------------------
class SessionStore {
  constructor(dir) {
    this.store = new JsonStore(dir, 'session.json', null);
  }
  save(data) { this.store.set(data); }
  load() { return this.store.get(); }
}

// ---------------------------------------------------------------------------
// Certificados recentes
// ---------------------------------------------------------------------------
class CertRecentStore {
  constructor(dir) {
    this.store = new JsonStore(dir, 'cert-recent.json', []);
  }
  add(cert) {
    const list = this.store.get().filter((c) => c.fingerprint !== cert.fingerprint);
    list.unshift({ subjectName: cert.subjectName, fingerprint: cert.fingerprint, lastUsed: Date.now() });
    if (list.length > 10) list.length = 10;
    this.store.set(list);
  }
  list() { return this.store.get(); }
}

// ---------------------------------------------------------------------------
// Zoom por hostname
// ---------------------------------------------------------------------------
class ZoomStore {
  constructor(dir) {
    this.store = new JsonStore(dir, 'zoom.json', {});
  }
  set(hostname, level) {
    const data = this.store.get();
    if (level === 0) delete data[hostname];
    else data[hostname] = level;
    this.store.set(data);
  }
  get(hostname) { return this.store.get()[hostname] ?? 0; }
}

module.exports = { HistoryStore, BookmarksStore, SessionStore, CertRecentStore, ZoomStore };
