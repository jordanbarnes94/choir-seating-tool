/*
 * vite-manual — the user manual, as static pages inside the app's build.
 *
 * Each manual/*.md becomes manual/<slug>/index.html through manual/template.html, styled by
 * manual/manual.css on top of the app's src/base.css, with the screenshots in manual/. A page's
 * address is its folder, /manual/<slug>/, as it was when the website rendered the manual. The pages
 * are emitted by the Vite build itself, not by a script run after it, so that the service worker
 * precaches them with everything else. `npm run dev` serves the same pages from /manual/.
 *
 * The pages link to each other as Markdown files (`arranging.md#moving-singers`), which is what
 * makes the manual readable in the repository on GitHub. The built page links to the folder.
 * manual/README.md is the contents list GitHub shows for the folder. It is not a page and is not
 * in the build, and the build fails unless it links to every page, in order.
 *
 * A link to a page or heading that does not exist, or an image that is not in manual/, fails the
 * build, and the dev server answers with the same message.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import attrs from 'markdown-it-attrs';
import spans from 'markdown-it-bracketed-spans';

const DIR = fileURLToPath(new URL('../manual/', import.meta.url));
const BASE_CSS = fileURLToPath(new URL('../src/base.css', import.meta.url));
const read = (name) => readFileSync(DIR + name, 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A heading's id: its letters and digits, lower case, joined by hyphens ("↻ Auto-arrange" is
// `auto-arrange`). Links into the manual from outside it depend on these staying as they are.
export const headingId = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-');

const linked = anchor.permalink.headerLink({ class: null });
const md = new MarkdownIt()
  .use(spans) // [⊘ Block]{.tool .block}
  .use(attrs) // ![…](stage.png){.wide}
  .use(anchor, {
    slugify: headingId,
    tabIndex: false,
    // The page title takes an id but is not a link to itself.
    permalink: (slug, opts, state, idx) => { if (state.tokens[idx].tag !== 'h1') linked(slug, opts, state, idx); }
  });

// `key: value` lines between two `---` lines; the manual needs nothing YAML can do beyond that.
function frontMatter(file, text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) throw new Error(`manual/${file}: no front matter`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at < 0) throw new Error(`manual/${file}: front matter line without a colon: ${line}`);
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  for (const key of ['title', 'description', 'order']) {
    if (!meta[key]) throw new Error(`manual/${file}: front matter has no ${key}`);
  }
  if (!Number.isFinite(Number(meta.order))) throw new Error(`manual/${file}: order is not a number`);
  return { meta: { ...meta, order: Number(meta.order) }, body: text.slice(m[0].length) };
}

// Every link target and image a page names, read off the parsed tokens.
function references(tokens, out = { links: [], images: [], ids: [] }) {
  for (const t of tokens) {
    if (t.type === 'link_open') out.links.push(t.attrGet('href'));
    if (t.type === 'image') out.images.push(t.attrGet('src'));
    if (t.type === 'heading_open' && t.attrGet('id')) out.ids.push(t.attrGet('id'));
    if (t.children) references(t.children, out);
  }
  return out;
}

// What GitHub shows for the folder: a list of the pages, kept by hand.
const CONTENTS = 'README.md';

function loadPages() {
  const pages = readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== CONTENTS).map((file) => {
    const { meta, body } = frontMatter(file, read(file));
    return { file, slug: file.slice(0, -3), ...meta, body, ...references(md.parse(body, {})) };
  });
  return pages.sort((a, b) => a.order - b.order);
}

// A page's Markdown as HTML. `root` is the way from the built page to manual/, where the
// screenshots are. A link to another page names its Markdown file, and becomes that page's folder.
function content(p, root) {
  const env = {};
  const tokens = md.parse(p.body, env);
  const point = (list) => {
    for (const t of list) {
      if (t.type === 'link_open') t.attrSet('href', t.attrGet('href').replace(/^([^/#:]+)\.md(?=#|$)/, root + '$1/'));
      if (t.type === 'image') t.attrSet('src', root + t.attrGet('src'));
      if (t.children) point(t.children);
    }
  };
  point(tokens);
  return md.renderer.render(tokens, md.options, env);
}

function problems(pages, images) {
  const found = [];
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  for (const p of pages) {
    for (const href of p.links) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // another site
      const [path, hash] = href.split('#');
      const target = path === '' ? p : path.endsWith('.md') ? bySlug.get(path.slice(0, -3)) : null;
      if (!target) found.push(`manual/${p.file}: link to ${href}, which is not a manual page (name its .md file)`);
      else if (hash && !target.ids.includes(hash)) found.push(`manual/${p.file}: link to ${href}, but ${target.file} has no heading #${hash}`);
    }
    for (const src of p.images) {
      if (!images.includes(src)) found.push(`manual/${p.file}: image ${src} is not in manual/`);
    }
  }
  const listed = [...read(CONTENTS).matchAll(/\]\(([^)#]+\.md)\)/g)].map((m) => m[1]);
  const wanted = pages.map((q) => q.file);
  if (listed.join() !== wanted.join()) found.push(`manual/${CONTENTS}: it links to ${listed.join(', ') || 'no pages'}, and the pages in order are ${wanted.join(', ')}`);
  return found;
}

function page(p, pages, template, homepage, root) {
  const at = pages.indexOf(p);
  const prev = pages[at - 1], next = pages[at + 1];
  const fields = {
    title: esc(p.title),
    description: esc(p.description),
    homepage: esc(homepage),
    root,
    toc: pages.map((q) => `            <li><a href="${root}${q.slug}/"${q === p ? ' class="on" aria-current="page"' : ''}>${esc(q.title)}</a></li>`).join('\n'),
    picker: pages.map((q) => `            <option value="${root}${q.slug}/"${q === p ? ' selected' : ''}>${esc(q.title)}</option>`).join('\n'),
    content: content(p, root),
    pager: (prev ? `<a href="${root}${prev.slug}/" class="prev">← ${esc(prev.title)}</a>` : '')
      + (next ? `<a href="${root}${next.slug}/" class="next">${esc(next.title)} →</a>` : '')
  };
  return template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in fields)) throw new Error(`manual/template.html: unknown placeholder ${m}`);
    return fields[key];
  });
}

/**
 * The manual's text files by output path, and the names of its screenshots.
 * @param {string} homepage where the top bar's back link goes
 * @returns {{ files: Map<string, string>, images: string[] }}
 */
export function renderManual(homepage) {
  const pages = loadPages();
  const images = readdirSync(DIR).filter((f) => f.endsWith('.png'));
  const found = problems(pages, images);
  if (found.length) throw new Error('The manual has references that do not resolve:\n  ' + found.join('\n  '));
  const template = read('template.html');
  const files = new Map();
  for (const p of pages) files.set(`manual/${p.slug}/index.html`, page(p, pages, template, homepage, '../'));
  // manual/ opens on the first page, rendered again for a page that is in manual/ itself.
  files.set('manual/index.html', page(pages[0], pages, template, homepage, ''));
  files.set('manual/manual.css', readFileSync(BASE_CSS, 'utf8') + '\n' + read('manual.css'));
  return { files, images };
}

const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png' };

export default function manual({ homepage }) {
  return {
    name: 'choir-manual',
    buildStart() {
      for (const f of readdirSync(DIR)) if (!f.endsWith('.png')) this.addWatchFile(DIR + f);
      this.addWatchFile(BASE_CSS);
    },
    generateBundle() {
      let out;
      try { out = renderManual(homepage); } catch (e) { this.error(e.message); }
      for (const [fileName, source] of out.files) this.emitFile({ type: 'asset', fileName, source });
      for (const name of out.images) this.emitFile({ type: 'asset', fileName: `manual/${name}`, source: readFileSync(DIR + name) });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url || '').split(/[?#]/)[0]);
        if (path === '/manual') {
          res.statusCode = 302;
          res.setHeader('Location', '/manual/');
          return res.end();
        }
        if (!path.startsWith('/manual/')) return next();
        const name = path.endsWith('/') ? path.slice(1) + 'index.html' : path.slice(1);
        res.setHeader('Content-Type', TYPES[name.split('.').pop()] || 'application/octet-stream');
        try {
          const { files, images } = renderManual(homepage);
          if (files.has(name)) return res.end(files.get(name));
          // A page's links are relative to its folder, so it is only served with the slash.
          if (files.has(name + '/index.html')) {
            res.statusCode = 302;
            res.setHeader('Location', path + '/');
            return res.end();
          }
          if (images.includes(name.slice('manual/'.length))) return res.end(readFileSync(DIR + name.slice('manual/'.length)));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          return res.end(e.message);
        }
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(`No such manual page: ${path}`);
      });
    }
  };
}
