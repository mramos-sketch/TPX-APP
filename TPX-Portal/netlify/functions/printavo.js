// Netlify Function: fetches Printavo customer page server-side (no CORS issues)
const https = require('https');

exports.handler = async (event) => {
  const { hash, acct } = event.queryStringParameters || {};

  if (!hash || !acct) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing hash or acct' }) };
  }

  // Validate inputs — only alphanumeric + hyphens allowed
  if (!/^[a-z0-9]+$/i.test(hash) || !/^[a-z0-9-]+$/i.test(acct)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid parameters' }) };
  }

  const url = `https://${acct}.printavo.com/customer/${hash}`;

  try {
    const html = await fetchUrl(url);
    const data = parsePrintavoPage(html);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parsePrintavoPage(html) {
  // Extract customer name
  const nameMatch = html.match(/<strong>\s*([^<]+?)\s*<\/strong>\s*\n?\s*<[^>]+>[^<]*@[^<]+</);
  
  // Extract billing name more reliably
  const billingMatch = html.match(/Customer Billing[\s\S]{0,200}?<br[^>]*>\s*([A-Za-záéíóúñÁÉÍÓÚÑ][^<\n]{2,40})\s*\n/);

  // Extract customer name from meta or title
  const titleMatch = html.match(/data-customer-name="([^"]+)"/);
  
  // Try to find name near email pattern
  const emailAreaMatch = html.match(/([A-ZÁ-Ú][a-záéíóúñ]+ [A-ZÁ-Ú][a-záéíóúñ]+)[\s\S]{0,100}?[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);

  const customerName = titleMatch?.[1] || billingMatch?.[1] || emailAreaMatch?.[1] || null;

  // Extract orders from table rows
  const orders = [];
  const rowRegex = /href="https:\/\/[^.]+\.printavo\.com\/invoice\/([a-f0-9]+)"[^>]*>([^<]+)<\/a>/g;
  const rows = html.matchAll(/<tr[\s\S]*?<\/tr>/g);
  
  // Parse invoice links and order info
  const invoicePattern = /\/invoice\/([a-f0-9]{30,36})/g;
  const invoiceMatches = [...html.matchAll(invoicePattern)];
  const uniqueHashes = [...new Set(invoiceMatches.map(m => m[1]))];

  // Extract order numbers (e.g., #135077)
  const orderNumPattern = /#(\d{5,6})/g;
  const orderNums = [...html.matchAll(orderNumPattern)].map(m => m[1]);

  // Extract order names from table
  const orderNamePattern = /class="[^"]*"\s*>\s*#\d+\s*<br[^>]*>\s*([^<\n]+?)\s*<br/g;
  const orderNames = [...html.matchAll(orderNamePattern)].map(m => m[1].trim());

  // Extract due dates
  const dueDatePattern = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{4}\b/g;
  const dueDates = [...html.matchAll(dueDatePattern)].map(m => m[0]);

  // Extract amounts
  const amountPattern = /\$[\d,]+\.\d{2}/g;
  const amounts = [...html.matchAll(amountPattern)].map(m => m[0]);

  // Extract statuses — look for emoji status labels
  const statusPattern = /(➡️[^<\n]+|🥳[^<\n]+)/g;
  const statuses = [...html.matchAll(statusPattern)].map(m => m[1].trim().substring(0,40));

  // Build orders array
  for (let i = 0; i < Math.min(uniqueHashes.length, orderNums.length); i++) {
    const outstanding = amounts[i * 2 + 1] || amounts[i] || '$0.00';
    orders.push({
      id:          orderNums[i] || String(i),
      hash:        uniqueHashes[i],
      name:        orderNames[i] || `Orden #${orderNums[i]}`,
      due:         dueDates[i] || '',
      outstanding: parseFloat((outstanding || '0').replace(/[$,]/g, '')) || 0,
      status:      statuses[i] || (outstanding !== '$0.00' ? 'active' : 'done')
    });
  }

  return { customerName, orders: orders.slice(0, 30) };
}
