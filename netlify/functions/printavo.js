// Netlify Function: Printavo proxy
const https = require('https');

exports.handler = async (event) => {
  const { hash, acct } = event.queryStringParameters || {};
  if (!hash || !acct) return { statusCode: 400, body: JSON.stringify({ error: 'Missing params' }) };
  if (!/^[a-f0-9]+$/i.test(hash) || !/^[a-z0-9-]+$/i.test(acct))
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid' }) };
  try {
    const html = await fetchUrl('https://' + acct + '.printavo.com/customer/' + hash);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }, body: JSON.stringify(parse(html)) };
  } catch (e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }
};

function fetchUrl(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej);
  });
}

function parse(html) {
  let customerName = null;
  const skip = ['due','invoice','t-shirt','tpx','payment','billing','shipping','print xpress'];
  for (const m of html.matchAll(/<strong>([^<]{2,80})<\/strong>/g)) {
    const t = m[1].trim();
    if (t.length > 2 && !skip.some(w => t.toLowerCase().includes(w))) { customerName = t; break; }
  }
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => ({
    raw: m[1], text: m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()
  }));
  const orders = [], seen = new Set();
  for (let i = 0; i + 4 < cells.length; i += 5) {
    const [id, cu, du, am, st] = cells.slice(i, i+5);
    const hm = (id.raw + st.raw).match(/\/invoice\/([a-f0-9]{20,36})/);
    if (!hm || seen.has(hm[1])) continue;
    seen.add(hm[1]);
    const im = id.text.match(/\b(\d{5,6})\b/);
    if (!im) continue;
    const oid = im[1], cust = cu.text.trim(), it = id.text;
    const ne = it.indexOf(oid) + oid.length, cs = cust ? it.indexOf(cust, ne) : -1;
    let name = cs > ne ? it.slice(ne, cs).replace(/\s+/g,' ').trim() : '';
    if (!name) { const di = it.toLowerCase().indexOf('due:'); name = di > ne ? it.slice(ne,di).replace(/\s+/g,' ').trim() : ''; }
    if (!name) name = 'Orden #' + oid;
    const dm = du.text.match(/([A-Za-z]{3,9}\s+\d{1,2}(?:,?\s*\d{4})?)/);
    const mm = am.text.match(/\$?([\d,]+\.\d{2})/);
    const outstanding = mm ? parseFloat(mm[1].replace(/,/g,'')) : 0;
    const paid = /paid|pagad/i.test(id.text + st.text);
    orders.push({ id: oid, hash: hm[1], name, due: dm ? dm[1] : du.text.trim(), outstanding, status: outstanding > 0 ? 'active' : paid ? 'paid' : 'done', statusLabel: st.text.trim().slice(0,60) });
  }
  return { customerName, orders: orders.slice(0,40) };
