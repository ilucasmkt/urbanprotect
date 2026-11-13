/*
 * Google Analytics 4 + Google Ads (conversão do clique no WhatsApp) — Urban Protect
 *
 * - Página normal (Google): cada clique nos botões que abrem o WhatsApp vira o evento
 *   "whatsapp_click" no Analytics e, quando o Ads estiver configurado, a conversão do Ads.
 * - Página /forms (Meta): o formulário dispara "generate_lead" (ver lead-form.js);
 *   aqui não se conta o clique, para não duplicar.
 */
(function () {
  'use strict';

  var CONFIG = {
    ga4: 'G-FJNFZPMCC9',
    // Google Ads: preencher quando a conversão for criada. Vazio = não envia ao Ads.
    adsId: '',        // ex.: 'AW-123456789'
    adsLabel: ''      // ex.: 'AbCdEfGhIjK' (texto depois da barra em AW-123456789/AbCdEfGhIjK)
  };

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', CONFIG.ga4);
  if (CONFIG.adsId) window.gtag('config', CONFIG.adsId);

  var isMeta = /[?&]v=meta(&|$)/.test(location.search);
  var WA_RE = /^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i;
  var lastFire = 0;

  function fire(origin) {
    var now = Date.now();
    if (now - lastFire < 800) return; // o mesmo clique pode passar por mais de um caminho
    lastFire = now;
    try {
      window.gtag('event', 'whatsapp_click', { origem: origin, page_path: location.pathname });
      if (CONFIG.adsId && CONFIG.adsLabel) {
        window.gtag('event', 'conversion', { send_to: CONFIG.adsId + '/' + CONFIG.adsLabel });
      }
    } catch (e) {}
  }

  if (isMeta) return;

  // Botões do site que abrem o WhatsApp por código (window.open)
  var realOpen = window.open;
  window.open = function (url) {
    if (typeof url === 'string' && WA_RE.test(url)) fire('botao');
    return realOpen.apply(window, arguments);
  };

  // Links diretos para o WhatsApp (cabeçalho e botão flutuante)
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a && WA_RE.test(a.getAttribute('href') || '')) fire('link');
  }, true);
})();
