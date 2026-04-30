(function () {
  function getEls() {
    return {
      body: document.body,
      provEl: document.getElementById('provider'),
      rdGroup: document.getElementById('rdGroup'),
      tbGroup: document.getElementById('tbGroup'),
      rdToken: document.getElementById('rdToken'),
      tbToken: document.getElementById('tbToken'),
      installBtn: document.getElementById('installBtn'),
      installModal: document.getElementById('installModal'),
      closeModalBtn: document.getElementById('closeModal'),
      modalUrlEl: document.getElementById('modalUrl'),
      installWebLink: document.getElementById('installWebLink'),
      installQr: document.getElementById('installQr'),
      modalHint: document.getElementById('modalHint'),
      openInStremioBtn: document.getElementById('openInStremioBtn'),
      copyFromModalBtn: document.getElementById('copyFromModalBtn'),
      aioUrl: document.getElementById('aioUrl'),
      toast: document.getElementById('toast'),
      providerChip: document.getElementById('providerChip'),
      tokenChip: document.getElementById('tokenChip')
    };
  }

  function getBaseUrl(els) {
    return (els.body && els.body.getAttribute('data-base-url')) || '';
  }

  function showToast(msg) {
    var els = getEls();
    if (!els.toast) {
      return;
    }
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    setTimeout(function () {
      els.toast.classList.remove('show');
    }, 2500);
  }

  function buildInstallUrl() {
    var els = getEls();
    if (!els.provEl || !els.rdToken || !els.tbToken) {
      return null;
    }

    var baseUrl = getBaseUrl(els);
    var provider = els.provEl.value;
    var rd = els.rdToken.value.trim();
    var tb = els.tbToken.value.trim();
    var token = provider === 'torbox' ? tb : rd;
    if (!token) {
      return null;
    }

    // Novo formato: /provider/token/manifest.json
    return baseUrl + '/' + provider + '/' + token + '/manifest.json';
  }

  function updateAioUrl() {
    var els = getEls();
    if (!els.provEl || !els.aioUrl) {
      return;
    }

    var baseUrl = getBaseUrl(els);
    var provider = els.provEl.value;
    var tokenKey = provider === 'torbox' ? 'torboxToken' : 'realdebridToken';
    els.aioUrl.textContent = baseUrl + '/' + provider + '/TOKEN/manifest.json';
  }

  function applyProviderUi() {
    var els = getEls();
    if (!els.provEl || !els.rdGroup || !els.tbGroup) {
      return;
    }

    var isTorBox = els.provEl.value === 'torbox';
    els.rdGroup.style.display = isTorBox ? 'none' : 'block';
    els.tbGroup.style.display = isTorBox ? 'block' : 'none';
    updateAioUrl();
    updateStatusChips();
  }

  function maskToken(value) {
    if (!value) {
      return 'Pendente';
    }
    if (value.length <= 8) {
      return 'Definido';
    }
    return value.slice(0, 4) + '...' + value.slice(-4);
  }

  function updateStatusChips() {
    var els = getEls();
    if (!els.provEl || !els.providerChip || !els.tokenChip || !els.rdToken || !els.tbToken) {
      return;
    }

    var provider = els.provEl.value;
    var isTorBox = provider === 'torbox';
    var providerLabel = isTorBox ? 'TorBox' : 'Real-Debrid';
    var tokenValue = isTorBox ? els.tbToken.value.trim() : els.rdToken.value.trim();

    els.providerChip.innerHTML = '<strong>PROVEDOR</strong>' + providerLabel;
    els.tokenChip.innerHTML = '<strong>TOKEN</strong>' + maskToken(tokenValue);

    if (tokenValue) {
      els.tokenChip.classList.add('ok');
    } else {
      els.tokenChip.classList.remove('ok');
    }
  }

  function openInstallModal() {
    var els = getEls();
    if (!els.installModal || !els.modalUrlEl || !els.installWebLink || !els.installQr || !els.modalHint || !els.provEl) {
      return;
    }

    var url = buildInstallUrl();
    if (url) {
      els.modalUrlEl.textContent = url;
      els.installWebLink.href = 'https://web.stremio.com/#/addons?addon=' + encodeURIComponent(url);
      els.installWebLink.style.pointerEvents = 'auto';
      els.installWebLink.style.opacity = '1';
      els.installQr.style.display = 'block';
      els.installQr.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(url);
      els.modalHint.textContent = '';
    } else {
      var tokenLabel = els.provEl.value === 'torbox' ? 'TorBox' : 'Real-Debrid';
      els.modalUrlEl.textContent = 'Preencha o token de ' + tokenLabel + ' para gerar o link de instalacao.';
      els.installWebLink.href = '#';
      els.installWebLink.style.pointerEvents = 'none';
      els.installWebLink.style.opacity = '0.55';
      els.installQr.style.display = 'none';
      els.installQr.removeAttribute('src');
      els.modalHint.textContent = 'Defina o token e clique novamente em "Abrir no Stremio" ou "Copiar URL de instalacao".';
    }

    els.installModal.classList.add('show');
    els.installModal.setAttribute('aria-hidden', 'false');
  }

  function closeInstallModal() {
    var els = getEls();
    if (!els.installModal) {
      return;
    }
    els.installModal.classList.remove('show');
    els.installModal.setAttribute('aria-hidden', 'true');
  }

  function openInStremio() {
    var url = buildInstallUrl();
    if (!url) {
      alert('Preencha o token do provedor selecionado antes de instalar.');
      return;
    }

    if (!confirm('Deseja abrir no app Stremio agora?')) {
      return;
    }

    // Com o novo formato /provider/TOKEN/manifest.json, nao precisamos mais de conversao complexa
    // para o protocolo stremio://, pois o Windows/Browsers nao cortam paths como cortam query strings.
    window.location.href = 'stremio://' + url.replace(/^https?:\/\//i, '');
    
    setTimeout(function () {
      showToast('Se o app nao abriu, use "Copiar URL de instalacao" no modal.');
    }, 1200);
  }

  function copyInstallUrlFromModal() {
    var url = buildInstallUrl();
    if (!url) {
      alert('Preencha o token do provedor selecionado antes de copiar a URL.');
      return;
    }

    navigator.clipboard.writeText(url).then(function () {
      showToast('URL de instalacao copiada!');
    }).catch(function () {
      prompt('Copie esta URL e cole no Stremio:', url);
    });
  }

  function copyAioUrl() {
    var els = getEls();
    if (!els.aioUrl) {
      return;
    }

    var text = els.aioUrl.textContent || '';
    navigator.clipboard.writeText(text).then(function () {
      showToast('URL copiada!');
    }).catch(function () {
      prompt('Copie esta URL:', text);
    });
  }

  function init() {
    var els = getEls();
    if (!els.provEl || !els.rdToken || !els.tbToken || !els.installBtn || !els.closeModalBtn || !els.openInStremioBtn || !els.copyFromModalBtn || !els.aioUrl) {
      return;
    }

    applyProviderUi();

    els.provEl.addEventListener('change', applyProviderUi);
    els.rdToken.addEventListener('input', function () {
      updateAioUrl();
      updateStatusChips();
    });
    els.tbToken.addEventListener('input', function () {
      updateAioUrl();
      updateStatusChips();
    });

    els.installBtn.addEventListener('click', openInstallModal);
    els.closeModalBtn.addEventListener('click', closeInstallModal);
    els.openInStremioBtn.addEventListener('click', openInStremio);
    els.copyFromModalBtn.addEventListener('click', copyInstallUrlFromModal);
    els.aioUrl.addEventListener('click', copyAioUrl);

    if (els.installModal) {
      els.installModal.addEventListener('click', function (e) {
        if (e.target === els.installModal) {
          closeInstallModal();
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeInstallModal();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
