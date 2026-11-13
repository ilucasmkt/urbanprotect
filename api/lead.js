// Recebe o lead do formulário (/forms) e, se for qualificado, envia o evento "Lead"
// para a API de Conversões do Meta (servidor -> Meta).
//
// Variáveis de ambiente (configuradas na Vercel, NUNCA no código):
//   META_CAPI_TOKEN        token de acesso do Pixel (obrigatório)
//   META_TEST_EVENT_CODE   código do "Testar eventos" do Gerenciador (ex.: TEST1234).
//                          Enquanto existir, os eventos aparecem só na aba de testes e
//                          NÃO contam nas campanhas. Apague a variável para valer de verdade.
const crypto = require('crypto');

const PIXEL_ID = '1483951748129189';
const API_VERSION = 'v21.0';

const sha256 = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 10) return '';
  return d.startsWith('55') && d.length >= 12 ? d : '55' + d;
}

function clean(v, max) {
  return typeof v === 'string' ? v.slice(0, max || 200) : '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const answers = body.answers || {};
  const phone = normalizePhone(answers.whatsapp);
  const name = clean(answers.nome, 120);
  if (!phone || !name) return res.status(400).json({ ok: false, error: 'dados' });

  // Só vai para o Meta quem o formulário marcou como qualificado.
  if (!body.qualified) return res.status(200).json({ ok: true, sent: false, reason: 'nao-qualificado' });

  const token = process.env.META_CAPI_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: 'sem-token' });

  const parts = name.split(/\s+/);
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
      content_name: clean(answers.servico, 120),
      vehicle: clean(answers.veiculo, 120),
      purchase_timeframe: clean(answers.prazo, 120),
      lead_quality: 'qualificado'
    }
  };

  const payload = { data: [event] };
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;

  try {
    const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ ok: false, error: 'meta', detail: out && out.error ? { code: out.error.code, message: out.error.message } : null });
    return res.status(200).json({ ok: true, sent: true, received: out.events_received, test: !!payload.test_event_code });
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'rede' });
  }
};
