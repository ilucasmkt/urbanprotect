/*
 * Formulário de qualificação em etapas (versão Meta Ads) — Urban Protect
 *
 * Na página /forms, todo botão que abriria o WhatsApp abre este pop-up antes:
 *   1) momento  2) o que procura  3) carro  4) valor (filtro)  5) nome + WhatsApp
 * Quem não aceita o valor recebe um agradecimento e NÃO é enviado ao Meta.
 * Quem aceita é "qualificado": vai ao Pixel + API de Conversões e segue para o WhatsApp.
 *
 * Para mudar textos, opções ou o valor, edite só o bloco CONFIG abaixo.
 */
(function () {
  'use strict';

  var CONFIG = {
    whatsapp: '5511946855147',
    title: 'Para melhor atendê-lo, responda apenas 3 perguntas rápidas',
    subtitle: 'Leva menos de 1 minuto.',
    endpoint: '/api/lead',
    redirectToWhatsApp: true,
    price: {
      title: 'Show! Vamos entrar em contato com você!',
      text: 'Nós somos credenciados da AVG, visando a melhor qualidade possível para o seu carro, e os nossos serviços de PPF partem de R$ 7.600,00, podendo ser parcelado em até 12x se preferir.',
      question: 'Esse valor faz sentido para você?',
      yes: 'Sim, já conheço os produtos',
      no: 'Não, procuro algo mais em conta'
    },
    thanks: {
      title: 'Obrigado pelo contato!',
      text: 'Agradecemos o seu interesse. Quando fizer sentido para você, é só nos chamar.',
      button: 'Fechar'
    },
    contact: {
      title: 'Perfeito! Para quem podemos falar?',
      subtitle: 'Informe seu nome e WhatsApp para nossa equipe te atender.',
      submit: 'Enviar e falar no WhatsApp'
    },
    // Só quem aceita o valor é qualificado (vai ao Meta como "Lead").
    qualify: function (a) { return a.valor === CONFIG.price.yes; },
    // Temperatura (vai no aviso do grupo e no evento do Meta):
    //   quente = concordou com o valor e quer agendar nos próximos dias
    //   morno  = concordou com o valor mas ainda está pesquisando
    //   frio   = não concordou com o valor (não é enviado ao Meta, só avisa o grupo)
    temperature: function (a) {
      if (a.valor !== CONFIG.price.yes) return 'frio';
      return a.prioridade === 'Pretendo agendar nos próximos dias' ? 'quente' : 'morno';
    },
    steps: [
      { id: 'prioridade', type: 'choice', label: 'Em que momento você está?', options: ['Ainda estou pesquisando', 'Pretendo agendar nos próximos dias'] },
      { id: 'servico', type: 'choice', label: 'O que você procura?', options: ['PPF completo', 'PPF frontal', 'Quero orientação'] },
      { id: 'veiculo', type: 'text', label: 'Qual é o seu carro?', placeholder: 'Marca e modelo (ex.: BMW X1)' }
    ]
  };

  window.UP_LEAD_HOOKS = window.UP_LEAD_HOOKS || { onOpen: function () {}, onSubmit: function () {} };

  var realOpen = window.open.bind(window);
  var WA_RE = /^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i;
  var root, body, state, currentText = '';

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function maskPhone(v) {
    var d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length > 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length > 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    if (d.length > 2) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    return d;
  }
  function cookie(n) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function fbcFromUrl() {
    var m = location.search.match(/[?&]fbclid=([^&]+)/);
    return m ? 'fb.1.' + Date.now() + '.' + m[1] : '';
  }
  function gtagEvent(name, params) {
    if (typeof window.gtag === 'function') { try { window.gtag('event', name, params || {}); } catch (e) {} }
  }

  // ---- Estado e navegação ----
  // Etapas: 0..n-1 = perguntas, 'price' = valor, 'contact' = nome/WhatsApp, 'thanks' = agradecimento
  function total() { return CONFIG.steps.length; }
  function go(step) { state.step = step; render(); }
  function back() {
    if (state.step === 'thanks' || state.step === 'contact') return go('price');
    if (state.step === 'price') return go(total() - 1);
    if (typeof state.step === 'number' && state.step > 0) go(state.step - 1);
  }

  function header(title, subtitle) {
    return [el('h2', { class: 'upl-title', text: title }), subtitle ? el('p', { class: 'upl-sub', text: subtitle }) : null];
  }
  function backBtn() {
    var b = el('button', { type: 'button', class: 'upl-back', text: '← Voltar' });
    b.addEventListener('click', back);
    return b;
  }
  function progress(i) {
    var wrap = el('div', { class: 'upl-progress', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(total()), 'aria-valuenow': String(i + 1) });
    for (var k = 0; k < total(); k++) wrap.appendChild(el('span', { class: 'upl-dot' + (k <= i ? ' on' : '') }));
    return wrap;
  }
  function put(nodes) {
    body.innerHTML = '';
    nodes.forEach(function (n) { if (n) body.appendChild(n); });
  }

  function render() {
    var s = state.step;
    if (typeof s === 'number') return renderQuestion(s);
    if (s === 'price') return renderPrice();
    if (s === 'contact') return renderContact();
    if (s === 'thanks') return renderThanks();
  }

  function renderQuestion(s) {
    var q = CONFIG.steps[s];
    var kids = [];
    if (s === 0) kids = kids.concat(header(CONFIG.title, CONFIG.subtitle));
    kids.push(progress(s));
    kids.push(el('p', { class: 'upl-q', text: q.label }));
    var nextStep = s + 1 < total() ? s + 1 : 'price';
    if (q.type === 'choice') {
      var group = el('div', { class: 'upl-opts' });
      q.options.forEach(function (opt) {
        var b = el('button', { type: 'button', class: 'upl-opt' + (state.answers[q.id] === opt ? ' sel' : ''), text: opt });
        b.addEventListener('click', function () {
          state.answers[q.id] = opt;
          Array.prototype.forEach.call(group.children, function (c) { c.classList.toggle('sel', c === b); });
          setTimeout(function () { go(nextStep); }, 180);
        });
        group.appendChild(b);
      });
      kids.push(group);
    } else {
      var input = el('input', { class: 'upl-input', type: 'text', id: 'upl-' + q.id, placeholder: q.placeholder || '', autocomplete: 'off' });
      input.value = state.answers[q.id] || '';
      var err = el('p', { class: 'upl-err' });
      var next = el('button', { type: 'button', class: 'upl-submit', text: 'Continuar' });
      var advance = function () {
        var v = input.value.trim();
        if (v.length < 2) { err.textContent = 'Conte qual é o seu carro.'; input.classList.add('bad'); return; }
        state.answers[q.id] = v;
        go(nextStep);
      };
      next.addEventListener('click', advance);
      input.addEventListener('keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); advance(); } });
      input.addEventListener('input', function () { err.textContent = ''; input.classList.remove('bad'); });
      kids.push(input, err, next);
      setTimeout(function () { input.focus(); }, 50);
    }
    if (s > 0) kids.push(backBtn());
    put(kids);
  }

  function renderPrice() {
    var P = CONFIG.price;
    var opts = el('div', { class: 'upl-opts' });
    [P.yes, P.no].forEach(function (label, i) {
      var b = el('button', { type: 'button', class: 'upl-opt' + (i === 0 ? ' yes' : ''), text: label });
      b.addEventListener('click', function () {
        state.answers.valor = label;
        if (label === P.yes) go('contact');
        else { gtagEvent('lead_nao_qualificado', { motivo: 'valor' }); sendCold(); go('thanks'); }
      });
      opts.appendChild(b);
    });
    put([el('h2', { class: 'upl-title', text: P.title }), el('p', { class: 'upl-price', text: P.text }), el('p', { class: 'upl-q', text: P.question }), opts, backBtn()]);
  }

  function renderContact() {
    var C = CONFIG.contact;
    var nome = el('input', { class: 'upl-input', id: 'upl-nome', type: 'text', placeholder: 'Como podemos te chamar?', autocomplete: 'name' });
    var zap = el('input', { class: 'upl-input', id: 'upl-whatsapp', type: 'tel', inputmode: 'numeric', placeholder: '(11) 91234-5678', autocomplete: 'tel' });
    zap.addEventListener('input', function () { zap.value = maskPhone(zap.value); });
    var eN = el('p', { class: 'upl-err' }), eZ = el('p', { class: 'upl-err' });
    nome.addEventListener('input', function () { eN.textContent = ''; nome.classList.remove('bad'); });
    zap.addEventListener('input', function () { eZ.textContent = ''; zap.classList.remove('bad'); });
    var form = el('form', { class: 'upl-form', novalidate: 'novalidate' }, [
      el('label', { class: 'upl-label', for: 'upl-nome', text: 'Seu nome' }), nome, eN,
      el('label', { class: 'upl-label', for: 'upl-whatsapp', text: 'Seu WhatsApp' }), zap, eZ,
      el('button', { type: 'submit', class: 'upl-submit', text: C.submit }),
      el('p', { class: 'upl-privacy', text: 'Seus dados são usados só para o atendimento deste orçamento.' })
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var okN = nome.value.trim().length >= 2, okZ = zap.value.replace(/\D/g, '').length >= 10;
      eN.textContent = okN ? '' : 'Informe seu nome.'; nome.classList.toggle('bad', !okN);
      eZ.textContent = okZ ? '' : 'Informe o WhatsApp com DDD.'; zap.classList.toggle('bad', !okZ);
      if (!okN || !okZ) return;
      state.answers.nome = nome.value.trim();
      state.answers.whatsapp = zap.value.trim();
      submit();
    });
    put(header(C.title, C.subtitle).concat([form, backBtn()]));
    setTimeout(function () { nome.focus(); }, 50);
  }

  function renderThanks() {
    var T = CONFIG.thanks;
    var closeB = el('button', { type: 'button', class: 'upl-submit', text: T.button });
    closeB.addEventListener('click', close);
    put([el('h2', { class: 'upl-title', text: T.title }), el('p', { class: 'upl-sub', text: T.text }), closeB]);
  }

  function buildMessage(a) {
    return [
      'Olá! Vim pelo site e quero um orçamento na URBAN PROTECT PPF.', '',
      'Nome: ' + a.nome,
      'Carro: ' + a.veiculo,
      'Interesse: ' + a.servico,
      'Momento: ' + a.prioridade,
      'Concordo com o valor a partir de R$ 7.600,00 (até 12x).'
    ].join('\n');
  }

  function post(payload) {
    if (!CONFIG.endpoint) return;
    try {
      fetch(CONFIG.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify(payload) });
    } catch (e) {}
  }

  // Quem não concorda com o valor não deixa contato: só avisa o grupo (lead frio), sem Meta.
  function sendCold() {
    var a = state.answers;
    var eventId = 'frio-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    try { window.UP_LEAD_HOOKS.onSubmit({ answers: a, qualified: false, temperature: 'frio', eventId: eventId, page: location.href }); } catch (e) {}
    post({ answers: a, qualified: false, temperature: 'frio', eventId: eventId, sourceUrl: location.href });
  }

  function submit() {
    var a = state.answers, qualified = false, temp = 'morno';
    try { qualified = !!CONFIG.qualify(a); temp = CONFIG.temperature(a); } catch (e) {}
    var eventId = 'lead-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    var text = buildMessage(a);
    var lead = { answers: a, text: text, createdAt: new Date().toISOString(), page: location.href, clickText: currentText, qualified: qualified, temperature: temp, eventId: eventId };
    try { window.UP_LEAD_HOOKS.onSubmit(lead); } catch (e) {}
    gtagEvent('generate_lead', { qualificado: qualified ? 'sim' : 'nao', servico: a.servico || '', momento: a.prioridade || '' });
    if (qualified && typeof window.fbq === 'function') {
      try { window.fbq('track', 'Lead', { content_name: a.servico || '', lead_quality: 'qualificado', lead_temperature: temp }, { eventID: eventId }); } catch (e) {}
    }
    post({ answers: a, qualified: qualified, temperature: temp, eventId: eventId, sourceUrl: location.href, fbp: cookie('_fbp'), fbc: cookie('_fbc') || fbcFromUrl() });
    close();
    if (CONFIG.redirectToWhatsApp) realOpen('https://wa.me/' + CONFIG.whatsapp + '?text=' + encodeURIComponent(text), '_blank');
  }

  // ---- Pop-up ----
  function build() {
    var closeBtn = el('button', { type: 'button', class: 'upl-close', 'aria-label': 'Fechar', text: '×' });
    closeBtn.addEventListener('click', close);
    body = el('div', { class: 'upl-body' });
    var card = el('div', { class: 'upl-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Orçamento' }, [closeBtn, body]);
    root = el('div', { class: 'upl-overlay', hidden: 'hidden' }, [card]);
    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });
    document.addEventListener('keydown', function (e) { if (e.keyCode === 27 && !root.hidden) close(); });
    document.body.appendChild(root);
  }
  function open(text) {
    currentText = text || '';
    if (!root) build();
    state = { step: 0, answers: {} };
    render();
    root.hidden = false;
    document.documentElement.classList.add('upl-lock');
    try { window.UP_LEAD_HOOKS.onOpen({ page: location.href }); } catch (e) {}
  }
  function close() {
    if (root) root.hidden = true;
    document.documentElement.classList.remove('upl-lock');
  }

  // ---- Intercepta os botões que abririam o WhatsApp ----
  function textOf(url) {
    var m = String(url).match(/[?&]text=([^&]*)/), t = '';
    try { t = m ? decodeURIComponent(m[1]) : ''; } catch (e) {}
    return t;
  }
  window.open = function (url) {
    if (typeof url === 'string' && WA_RE.test(url)) { open(textOf(url)); return null; }
    return realOpen.apply(window, arguments);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a && WA_RE.test(a.getAttribute('href') || '')) { e.preventDefault(); e.stopPropagation(); open(textOf(a.getAttribute('href'))); }
  }, true);

  window.UP_LEAD_FORM = { open: open, close: close, config: CONFIG };
})();
