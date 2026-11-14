// Tiny DOM helpers. Story and card content is always inserted as text nodes,
// never as HTML, matching SCEAN's existing rule for authored content.
const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'htmlFor', 'tabIndex', 'open', 'selected']);
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) el.style.setProperty(p.startsWith('--') ? p : p.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), x);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export function replace(el, ...kids) { el.replaceChildren(); return append(el, kids); }
export const icon = name => h('span', {class: `i i-${name}`, 'aria-hidden': 'true'});
