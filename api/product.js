const HEADERS = {
  'accept': 'application/json,text/plain,*/*',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  'referer': 'https://www.wildberries.ru/'
};
function parseId(value) {
  const input = String(value || '').trim();
  if (/^\d{5,12}$/.test(input)) return input;
  const match = input.match(/(?:wildberries\.[a-z.]+|wb\.ru)\/catalog\/(\d{5,12})\//i);
  if (match) return match[1];
  throw new Error('Укажите корректную ссылку Wildberries или артикул товара');
}
function extractStock(product) {
  const stocks = (product.sizes || []).flatMap(s => s.stocks || []);
  if (!stocks.length) return null;
  let total = 0;
  let hasValid = false;
  for (const stock of stocks) {
    const count = stock.qty ?? stock.quantity ?? stock.vol;
    if (typeof count === 'number' && Number.isFinite(count)) { total += count; hasValid = true; }
  }
  return hasValid ? total : null;
}
function extractPrice(product) {
  const entries = (product.sizes || []).map(s => s.price).filter(Boolean);
  const cents = entries.map(p => p.product ?? p.total ?? p.basic).filter(v => typeof v === 'number' && v > 0);
  if (cents.length) return Math.min(...cents) / 100;
  for (const key of ['salePriceU','priceU']) {
    if (typeof product[key] === 'number' && product[key] > 0) return product[key] / 100;
  }
  return null;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({error:'Метод не поддерживается'});
  let id;
  try { id = parseId(req.query.url || req.query.id); }
  catch(e) { return res.status(400).json({error:e.message}); }
  const currency = req.query.currency === 'rub' ? 'rub' : 'kzt';
  // dest можно задать для своего адреса доставки; значение по умолчанию — региональная витрина.
  const dest = /^-?\d{1,12}$/.test(String(req.query.dest || '')) ? String(req.query.dest) : '-1257786';
  const endpoint = new URL('https://card.wb.ru/cards/v4/detail');
  for(const [key,value] of Object.entries({appType:'1',curr:currency,dest,lang:'ru',nm:id})) endpoint.searchParams.set(key,value);
  try {
    const response = await fetch(endpoint, {headers:HEADERS, signal:AbortSignal.timeout(12000), cache:'no-store'});
    if (!response.ok) throw new Error(`Wildberries вернул HTTP ${response.status}`);
    const json = await response.json();
    const product = json?.products?.find(p => String(p.id ?? p.nmId) === id) || json?.data?.products?.find(p => String(p.id ?? p.nmId) === id);
    if (!product) return res.status(502).json({id,status:'unverified',error:'Wildberries не вернул товар для данного региона. Цена не подтверждена.'});
    const price = extractPrice(product);
    const stock = extractStock(product);
    const result = {
      id, title: product.name || product.title || `Товар ${id}`,
      brand: product.brand || null, price, currency: currency.toUpperCase(),
      stock, availability: stock === null ? 'не подтверждено' : stock > 0 ? 'в наличии' : 'нет в наличии',
      deliveryDays:null,
      deliveryNote:'Срок доставки зависит от адреса и не подтверждается данным API.',
      sellerId:product.supplierId || null,
      url:`https://global.wildberries.ru/catalog/${id}/detail.aspx`,
      checkedAt:new Date().toISOString(), status:price !== null ? 'verified' : 'partial',
      note:price === null ? 'Цена не пришла из API; подменять её нулём нельзя.' : 'Цена из публичного API. Персональные скидки могут отличаться.'
    };
    return res.status(200).json(result);
  } catch(e) {
    return res.status(502).json({id,status:'unverified',error:`Не удалось получить подтверждённые данные: ${e.message}`});
  }
}
