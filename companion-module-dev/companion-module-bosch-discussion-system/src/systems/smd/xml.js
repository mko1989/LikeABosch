// Small, lenient XML parser for DCN-SWSMD activities (WO-066, DEC-018). No dependency (DEC-002).
// The real stream is .NET XmlSerializer output (well-formed); the manual's examples are not (typographic quotes,
// unquoted attributes, `</Channel` without `>`, self-closed elements "closed" later). This parser accepts both:
// - attribute values in "…", '…', ”…” / “…”, or unquoted;
// - a close tag with no open element of that name re-parents the following siblings into the last self-closed
//   sibling of that name (`<Desk/> <Seat/> </Desk>` → Desk contains Seat), else it is ignored;
// - a close tag for an element further up the stack closes everything in between.

/**
 * @typedef {{ name: string, attrs: Record<string, string>, children: XmlNode[], text: string, selfClosed?: boolean }} XmlNode
 */

const QUOTES = new Set(['"', "'", '“', '”', '‘', '’']);

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k.startsWith('#x') ? Number.parseInt(k.slice(2), 16) : Number.parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

/**
 * Parse an XML document. Returns the root element, or throws if there is no element at all.
 * @param {string} text
 * @returns {XmlNode}
 */
export function parseXml(text) {
  const doc = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [doc];
  let i = 0;
  const n = text.length;
  const top = () => stack[stack.length - 1];

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { top().text += text.slice(i); break; }
    if (lt > i) top().text += text.slice(i, lt);
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) {
      const e = text.indexOf(']]>', lt + 9);
      top().text += text.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (text[lt + 1] === '?' || text[lt + 1] === '!') { const e = text.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }

    if (text[lt + 1] === '/') {
      // close tag; tolerate a missing '>'
      let j = lt + 2;
      while (j < n && !/[\s>]/.test(text[j]) && text[j] !== '<') j++;
      const name = text.slice(lt + 2, j);
      while (j < n && /\s/.test(text[j])) j++;
      i = text[j] === '>' ? j + 1 : j;
      closeTag(stack, name);
      continue;
    }

    // open tag
    let j = lt + 1;
    while (j < n && !/[\s/>]/.test(text[j])) j++;
    const node = { name: text.slice(lt + 1, j), attrs: {}, children: [], text: '' };
    // attributes
    while (j < n) {
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] === '>' || text[j] === undefined) { j++; break; }
      if (text[j] === '/' && text[j + 1] === '>') { node.selfClosed = true; j += 2; break; }
      if (text[j] === '<') break; // broken tag: let the next iteration handle '<'
      let k = j;
      while (k < n && !/[\s=/>]/.test(text[k])) k++;
      const attr = text.slice(j, k);
      j = k;
      while (j < n && /\s/.test(text[j])) j++;
      let value = '';
      if (text[j] === '=') {
        j++;
        while (j < n && /\s/.test(text[j])) j++;
        if (QUOTES.has(text[j])) {
          const q = text[j];
          const smart = q !== '"' && q !== "'";
          let e = j + 1;
          while (e < n && (smart ? !QUOTES.has(text[e]) : text[e] !== q)) e++;
          value = text.slice(j + 1, e);
          j = e + 1;
        } else {
          let e = j;
          while (e < n && !/[\s>]/.test(text[e]) && !(text[e] === '/' && text[e + 1] === '>')) e++;
          value = text.slice(j, e);
          j = e;
        }
      }
      if (attr) node.attrs[attr] = decodeEntities(value);
      if (!attr) j++; // never loop forever on garbage
    }
    i = j;
    top().children.push(node);
    if (!node.selfClosed) stack.push(node);
  }
  const root = doc.children.find(c => c.name);
  if (!root) throw new Error('no XML element found');
  const tidy = node => { node.text = decodeEntities(node.text).trim(); node.children.forEach(tidy); };
  tidy(root);
  return root;
}

function closeTag(stack, name) {
  for (let s = stack.length - 1; s > 0; s--) {
    if (stack[s].name === name) { stack.length = s; return; }
  }
  // No open element of that name: a self-closed sibling that was meant to contain what followed it.
  const parent = stack[stack.length - 1];
  for (let c = parent.children.length - 1; c >= 0; c--) {
    const sib = parent.children[c];
    if (sib.name === name && sib.selfClosed) {
      sib.children.push(...parent.children.splice(c + 1));
      sib.selfClosed = false;
      return;
    }
  }
}

// ------------------------------------------------------------------ helpers for reading activities

const lc = s => s.toLowerCase();

/** Attribute by name, case-insensitive (the manual has both Timestamp and TimeStamp). */
export function attr(node, name) {
  if (!node) return undefined;
  if (name in node.attrs) return node.attrs[name];
  const key = Object.keys(node.attrs).find(k => lc(k) === lc(name));
  return key === undefined ? undefined : node.attrs[key];
}

export const int = (node, name) => {
  const v = attr(node, name);
  if (v === undefined || v === '') return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};

export const bool = (node, name) => {
  const v = attr(node, name);
  return v === undefined ? undefined : lc(v) === 'true';
};

/** Element names match with or without the `Container` suffix, case-insensitive. */
const matches = (node, base) => {
  const n = lc(node.name);
  return n === lc(base) || n === `${lc(base)}container`;
};

/** First direct child named `base` / `baseContainer`. */
export function child(node, base) {
  return node?.children.find(c => matches(c, base));
}

/**
 * All items of a list: direct children named base/baseContainer, plus those inside direct wrapper children
 * (`<Participants>`, or any of `wrappers`). Does not descend into the items themselves.
 * @param {XmlNode} node
 * @param {string} base
 * @param {string[]} [wrappers]
 */
export function items(node, base, wrappers = []) {
  if (!node) return [];
  const wrap = new Set([`${lc(base)}s`, ...wrappers.map(lc)]);
  const out = [];
  for (const c of node.children) {
    if (matches(c, base)) out.push(c);
    else if (wrap.has(lc(c.name))) out.push(...c.children.filter(x => matches(x, base)));
  }
  return out;
}
