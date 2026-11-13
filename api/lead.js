// Recebe cada resposta do formulário (/forms) e faz duas coisas:
//   1) SEMPRE avisa o grupo de WhatsApp da Urban Protect (pelo CRM de avisos),
//      com a temperatura do lead: quente, morno ou frio;
//   2) SÓ SE o lead for qualificado (concordou com o valor) envia o evento "Lead"
//      para a API de Conversões do Meta.
//
// Variáveis de ambiente (configuradas na Vercel, NUNCA no código):
//   META_CAPI_TOKEN        token de acesso do Pixel
//   META_TEST_EVENT_CODE   código do "Testar eventos" (ex.: TEST4053). Enquanto existir, os
//                          eventos aparecem só na aba de testes e NÃO contam nas campanhas.
//   URBAN_LEAD_SECRET      chave do aviso no grupo (a mesma configurada no CRM)
const crypto = require('crypto');

const PIXEL_ID = '1483951748129189';
const API_VERSION = 'v21.0';
const NOTIFY_URL = 'https://app.autowisebrasil.com.br/api/public/urban-lead';
const TIMEOUT_MS = 7000;

const TEMP = {
  quente: '🔥 Quente',
  morno: '⚡ Morno',
  frio: '❄️ Frio'
};

const sha256 = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 10) return '';
  return d.startsWith('55') && d.length >= 12 ? d : '55' + d;
}

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max || 200) : '';
}

function buildGroupMessage(a, temperature, qualified, phone) {
  const lines = ['🔔 *Novo lead — Urban Protect PPF*', ''];
  lines.push('🌡️ *Temperatura:* ' + (TEMP[temperature] || temperature));
  if (a.nome) lines.push('👤 *Nome:* ' + a.nome);
  if (phone) {
    lines.push('📱 *WhatsApp:* ' + (a.whatsapp || phone));
    lines.push('💬 https://wa.me/' + phone);
  } else {
    lines.push('📵 *Contato:* não deixou (não concordou com o valor)');
  }
  if (a.veiculo) lines.push('🚗 *Carro:* ' + a.veiculo);
  if (a.servico) lines.push('🛡️ *Interesse:* ' + a.servico);
  if (a.prioridade) lines.push('⏱️ *Momento:* ' + a.prioridade);
  lines.push('💰 *Valor (a partir de R$ 7.600):* ' + (qualified ? '✅ concordou' : '❌ não concordou'));
  lines.push('📍 *Origem:* Meta Ads — formulário do site');
  if (qualified) lines.push('📣 Marcado como Lead no Meta');
  return lines.join('\n');
}

async function notifyGroup(text) {
  const secret = process.env.URBAN_LEAD_SECRET;
  if (!secret) return { ok: false, error: 'sem-chave-grupo' };
  try {
    const r = await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': secret },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: 'rede' };
  }
}

async function sendToMeta(req, body, a, phone, temperature) {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return { ok: false, error: 'sem-token' };

  const parts = a.nome.split(/\s+/);
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
  const userData = {
    ph: [sha256(phone)],
    fn: [sha256(parts[0])],
    client_ip_address: ip,
    client_user_agent: clean(req.headers['user-agent'], 400)
  };
  if (parts.length > 1) userData.ln = [sha256(parts[parts.length - 1])];
  if (body.fbp) userData.fbp = clean(body.fbp, 120);
  if (body.fbc) userData.fbc = clean(body.fbc, 200);

  const event = {
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    event_id: clean(body.eventId, 80),            // mesmo id do Pixel no navegador: o Meta junta os dois
    action_source: 'website',
    event_source_url: clean(body.sourceUrl, 400) || 'https://urbanprotect.vercel.app/forms',
    user_data: userData,
    custom_data: {
      content_name: a.servico,
      vehicle: a.veiculo,
      purchase_timeframe: a.prioridade,
      lead_temperature: temperature,
      lead_quality: 'qualificado'
    }
  };

  const payload = { data: [event] };
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;

  try {
    const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: 'meta', detail: out && out.error ? { code: out.error.code, message: out.error.message } : null };
    return { ok: true, received: out.events_received, test: !!payload.test_event_code };
  } catch (e) {
    return { ok: false, error: 'rede' };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const raw = body.answers || {};
  const a = {
    nome: clean(raw.nome, 120),
    whatsapp: clean(raw.whatsapp, 30),
    veiculo: clean(raw.veiculo, 120),
    servico: clean(raw.servico, 120),
    prioridade: clean(raw.prioridade, 120),
    valor: clean(raw.valor, 120)
  };
  // Precisa ter respondido o formulário até a pergunta do valor.
  if (!a.valor || !a.veiculo || !a.servico || !a.prioridade) return res.status(400).json({ ok: false, error: 'dados' });

  const qualified = body.qualified === true;
  const phone = normalizePhone(a.whatsapp);
  // Qualificado sempre tem nome e WhatsApp; quem não concordou com o valor não deixa contato.
  if (qualified && (!phone || !a.nome)) return res.status(400).json({ ok: false, error: 'contato' });

  const temperature = ['quente', 'morno', 'frio'].includes(body.temperature) ? body.temperature : (qualified ? 'morno' : 'frio');

  const [group, meta] = await Promise.all([
    notifyGroup(buildGroupMessage(a, temperature, qualified, qualified ? phone : '')),
    qualified ? sendToMeta(req, body, a, phone, temperature) : Promise.resolve({ ok: true, skipped: 'nao-qualificado' })
  ]);

  const ok = group.ok !== false || meta.ok !== false;
  return res.status(200).json({ ok, group: group.ok, meta: meta.skipped ? 'ignorado' : (meta.ok ? 'enviado' : meta.error || 'erro'), test: !!meta.test });
};
