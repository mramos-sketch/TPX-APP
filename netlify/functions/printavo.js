// Netlify Function: fetches Printavo customer page server-side (no CORS issues)
const https = require('https');

exports.handler = async (event) => {
  const { hash, acct } = event.queryStringParameters || {};
  if (!hash || !acct) return { statusCode: 400, body: JSON.stringify({ error: 'Missing params' }) };
  if (!/^[a-f0-9]+$/i.test(hash) || !/^[a-z0-9-]+$/i.test(acct))
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid parameters' }) };

  try {
    const html = await fetchUrl(`https://${acct}.printavo.com/customer/${hash}`);
    const data = parsePrintavoPage(html);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

function fetchUrl(url) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' } }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function parsePrintavoPage(html) {
  const orders = [];
  let customerName = null;
  const skipWords = ['due','invoice','t-shirt','tpx','payment','billing','shipping','print xpress'];
  for (const m of html.matchAll(/<strong>([^<]{2,80})<\/strong>/g)) {
    const txt = m[1].trim();
    if (txt.length > 2 && !skipWords.some(w => txt.toLowerCase().includes(w))) { customerName = txt; break; }
  }

  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => ({
    raw: m[1], text: m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()
  }));

  const seen = new Set();
  for (let i = 0; i + 4 < cells.length; i += 5) {
    const [idC, custC, dueC, amtC, statC] = cells.slice(i, i+5);
    const hm = (idC.raw + statC.raw).match(/\/invoice\/([a-f0-9]{20,36})/);
    if (!hm || seen.has(hm[1])) continue;
    seen.add(hm[1]);
    const idm = idC.text.match(/\b(\d{5,6})\b/);
    if (!idm) continue;
    const oid = idm[1], cust = custC.text.trim(), idTxt = idC.text;
    const ne = idTxt.indexOf(oid) + oid.length, cs = cust ? idTxt.indexOf(cust, ne) : -1;
    let name = cs > ne ? idTxt.slice(ne, cs).replace(/\s+/g,' ').trim() : '';
    if (!name || name.length < 2) { const di = idTxt.toLowerCase().indexOf('due:'); name = di > ne ? idTxt.slice(ne, di).replace(/\s+/g,' ').trim() : ''; }
    if (!name || name.length < 2) name = 'Orden #' + oid;
    const dm = dueC.text.match(/([A-Za-z]{3,9}\s+\d{1,2}(?:,?\s*\d{4})?)/);
    const am = amtC.text.match(/\$?([\d,]+\.\d{2})/);
    const outstanding = am ? parseFloat(am[1].replace(/,/g,'')) : 0;
    const isPaid = /paid|pagad/i.test(idC.text + statC.text);
    orders.push({ id: oid, hash: hm[1], name, due: dm?.[1] || dueC.text.trim(), outstanding, status: outstanding > 0 ? 'active' : isPaid ? 'paid' : 'done', statusLabel: statC.text.trim().slice(0,60) });
  }
  return { customerName, orders: orders.slice(0,40) };
      }
