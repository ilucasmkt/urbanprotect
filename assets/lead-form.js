/*
 * Formulário de qualificação (versão Meta Ads) — Urban Protect
 *
 * Na página meta.html, todo botão que abriria o WhatsApp abre este pop-up antes.
 * Ao enviar, o lead é entregue aos "ganchos" abaixo (CRM, Pixel/API de Conversões)
 * e a pessoa segue para o WhatsApp já com as respostas na mensagem.
 *
 * Para trocar as perguntas, edite só a lista CONFIG.fields.
 * As perguntas atuais são PROVISÓRIAS (aguardando o roteiro definitivo).
 */
(function () {
  'use strict';

  var CONFIG = {
    whatsapp: '5511946855147',
    title: 'Solicite seu orçamento',
    subtitle: 'Responda rapidinho para nossa equipe te atender com o valor certo.',
    submitLabel: 'Enviar e falar no WhatsApp',
    // true = depois de enviar, abre a conversa no WhatsApp com as respostas.
    redirectToWhatsApp: true,
    // Quando existir um endereço de recebimento (CRM / API de Conversões), coloque aqui.
    // O lead é enviado por POST em JSON. Vazio = não envia para lugar nenhum.
    endpoint: '/api/lead',
    // Regra de qualificação (PROVISÓRIA — aguardando o critério definitivo).
    // Só quem passa nela é enviado ao Meta (Pixel + API de Conversões) como "Lead".
    // Recebe as respostas { id_da_pergunta: 'resposta' } e devolve true/false.
    qualify: function (a) {
      var semPressa = a.prazo === 'Estou só pesquisando';
      return !semPressa;
    },
    fields: [
      { id: 'nome', label: 'Seu nome', type: 'text', required: true, placeholder: 'Como podemos te chamar?', autocomplete: 'name' },
      { id: 'whatsapp', label: 'Seu WhatsApp', type: 'tel', required: true, placeholder: '(11) 91234-5678', autocomplete: 'tel' },
      { id: 'veiculo', label: 'Qual é o seu veículo?', type: 'text', required: true, placeholder: 'Ex.: BMW X1 2022' },
      {
        id: 'servico', label: 'Qual serviço você quer?', type: 'choice', required: true,
        options: ['PPF Transparente (brilho)', 'PPF Fosco / Acetinado', 'PPF Colorido', 'Anti-vandalismo', 'Ainda não sei, quero orientação']
      },
      {
        id: 'prazo', label: 'Quando pretende fazer?', type: 'choice', required: true,
        options: ['O quanto antes', 'Nas próximas semanas', 'Estou só pesquisando']
      }
    ]
  };

  // ---- Ganchos para integrações futuras (Pixel, API de Conversões, CRM) ----
  // Cada função recebe o lead: { answers, text, createdAt, page }.
  window.UP_LEAD_HOOKS = window.UP_LEAD_HOOKS || {
    onOpen: function () {},
    onSubmit: function () {}
  };

  function cookie(n) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function fbcFromUrl() {
    var m = location.search.match(/[?&]fbclid=([^&]+)/);
    return m ? 'fb.1.' + Date.now() + '.' + m[1] : '';
  }

  var realOpen = window.open.bind(window);
  var WA_RE = /^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i;
  var root, form, errorBox, currentText = '';

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function maskPhone(v) {
    var d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length > 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length > 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    if (d.length > 2) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    return d;
  }

  function build() {
    var closeBtn = el('button', { type: 'button', class: 'upl-close', 'aria-label': 'Fechar', text: '×' });
    closeBtn.addEventListener('click', close);

    form = el('form', { class: 'upl-form', novalidate: 'novalidate' });
    CONFIG.fields.forEach(function (f) {
      var wrap = el('div', { class: 'upl-field', 'data-field': f.id });
      wrap.appendChild(el('label', { class: 'upl-label', text: f.label }));
      if (f.type === 'choice') {
        var group = el('div', { class: 'upl-choices', role: 'radiogroup', 'aria-label': f.label });
        f.options.forEach(function (opt, i) {
          var id = 'upl-' + f.id + '-' + i;
          var input = el('input', { type: 'radio', name: f.id, id: id, value: opt });
          var lab = el('label', { class: 'upl-choice', for: id, text: opt });
          group.appendChild(input);
          group.appendChild(lab);
        });
        wrap.appendChild(group);
      } else {
        var attrs = { class: 'upl-input', name: f.id, id: 'upl-' + f.id, type: f.type === 'tel' ? 'tel' : 'text', placeholder: f.placeholder || '' };
        if (f.autocomplete) attrs.autocomplete = f.autocomplete;
        if (f.type === 'tel') attrs.inputmode = 'numeric';
        var input2 = el('input', attrs);
        if (f.type === 'tel') input2.addEventListener('input', function () { input2.value = maskPhone(input2.value); });
        wrap.appendChild(input2);
      }
      wrap.appendChild(el('p', { class: 'upl-err', 'aria-live': 'polite' }));
      form.appendChild(wrap);
    });
    errorBox = el('p', { class: 'upl-global-err', 'aria-live': 'polite' });
    form.appendChild(errorBox);
    form.appendChild(el('button', { type: 'submit', class: 'upl-submit', text: CONFIG.submitLabel }));
    form.appendChild(el('p', { class: 'upl-privacy', text: 'Seus dados são usados só para o atendimento deste orçamento.' }));
    form.addEventListener('submit', onSubmit);
    // Ao corrigir um campo, o aviso de erro dele some na hora.
    function clearErr(e) {
      var w = e.target.closest ? e.target.closest('.upl-field') : null;
      if (!w) return;
      w.classList.remove('upl-invalid');
      var er = w.querySelector('.upl-err');
      if (er) er.textContent = '';
      if (!form.querySelector('.upl-invalid')) errorBox.textContent = '';
    }
    form.addEventListener('input', clearErr);
    form.addEventListener('change', clearErr);

    var card = el('div', { class: 'upl-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': CONFIG.title }, [
      closeBtn,
      el('h2', { class: 'upl-title', text: CONFIG.title }),
      el('p', { class: 'upl-sub', text: CONFIG.subtitle }),
      form
    ]);
    root = el('div', { class: 'upl-overlay', hidden: 'hidden' }, [card]);
    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !root.hidden) close(); });
    document.body.appendChild(root);
  }

  function open(text) {
    currentText = text || '';
    if (!root) build();
    root.hidden = false;
    document.documentElement.classList.add('upl-lock');
    try { window.UP_LEAD_HOOKS.onOpen({ page: location.href }); } catch (e) {}
    var first = form.querySelector('input');
    if (first) setTimeout(function () { first.focus(); }, 50);
  }

  function close() {
    if (root) root.hidden = true;
    document.documentElement.classList.remove('upl-lock');
  }

  function collect() {
    var answers = {}, ok = true;
    CONFIG.fields.forEach(function (f) {
      var wrap = form.querySelector('[data-field="' + f.id + '"]');
      var err = wrap.querySelector('.upl-err');
      var v;
      if (f.type === 'choice') {
        var c = form.querySelector('input[name="' + f.id + '"]:checked');
        v = c ? c.value : '';
      } else {
        v = form.querySelector('[name="' + f.id + '"]').value.trim();
      }
      var msg = '';
      if (f.required && !v) msg = f.type === 'choice' ? 'Escolha uma opção.' : 'Preencha este campo.';
      else if (f.type === 'tel' && v.replace(/\D/g, '').length < 10) msg = 'Informe o WhatsApp com DDD.';
      err.textContent = msg;
      wrap.classList.toggle('upl-invalid', !!msg);
      if (msg) ok = false;
      answers[f.id] = v;
    });
    return ok ? answers : null;
  }

  function buildMessage(answers) {
    var lines = ['Olá! Vim pelo site e quero um orçamento na URBAN PROTECT PPF.', ''];
    CONFIG.fields.forEach(function (f) {
      if (answers[f.id]) lines.push(f.label.replace(/\?$/, '') + ': ' + answers[f.id]);
    });
    return lines.join('\n');
  }

  function onSubmit(e) {
    e.preventDefault();
    var answers = collect();
    if (!answers) { errorBox.textContent = 'Confira os campos destacados.'; return; }
    errorBox.textContent = '';
    var text = buildMessage(answers);
    var qualified = false;
    try { qualified = !!CONFIG.qualify(answers); } catch (err) {}
    var eventId = 'lead-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    var lead = { answers: answers, text: text, createdAt: new Date().toISOString(), page: location.href, clickText: currentText, qualified: qualified, eventId: eventId };
    try { window.UP_LEAD_HOOKS.onSubmit(lead); } catch (err) {}
    // Pixel no navegador (só se qualificado) + mesmo evento pelo servidor (API de Conversões).
    if (qualified && typeof window.fbq === 'function') {
      try { window.fbq('track', 'Lead', { content_name: answers.servico || '', lead_quality: 'qualificado' }, { eventID: eventId }); } catch (err) {}
    }
    if (CONFIG.endpoint) {
      try {
        fetch(CONFIG.endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
          body: JSON.stringify({ answers: answers, qualified: qualified, eventId: eventId, sourceUrl: location.href, fbp: cookie('_fbp'), fbc: cookie('_fbc') || fbcFromUrl() })
        });
      } catch (err) {}
    }
    close();
    if (CONFIG.redirectToWhatsApp) realOpen('https://wa.me/' + CONFIG.whatsapp + '?text=' + encodeURIComponent(text), '_blank');
  }

  // ---- Intercepta os botões que abririam o WhatsApp ----
  window.open = function (url) {
    if (typeof url === 'string' && WA_RE.test(url)) {
      var m = url.match(/[?&]text=([^&]*)/);
      var t = ''; try { t = m ? decodeURIComponent(m[1]) : ''; } catch (e) {}
      open(t);
      return null;
    }
    return realOpen.apply(window, arguments);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a && WA_RE.test(a.getAttribute('href') || '')) {
      e.preventDefault();
      e.stopPropagation();
      var m = a.getAttribute('href').match(/[?&]text=([^&]*)/);
      var t = ''; try { t = m ? decodeURIComponent(m[1]) : ''; } catch (err) {}
      open(t);
    }
  }, true);

  window.UP_LEAD_FORM = { open: open, close: close, config: CONFIG };
})();
