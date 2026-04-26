/**
 * Config Controller
 * Gera o manifest Stremio e a pÃ¡gina de configuraÃ§Ã£o do addon.
 */

import type { AddonManifest } from '../models/config-model.js';
import { ConfigService } from '../services/config-service.js';

export class ConfigController {
  private config = ConfigService.loadConfig();

  createAddonManifest(isConfigured: boolean = false): AddonManifest {
    return {
      id: 'org.guindex.addon',
      version: '1.1.0',
      name: 'GuIndex',
      description:
        'Addon brasileiro para Stremio â€” busca torrents nacionais via torrent-indexer e resolve via Real-Debrid ou TorBox.',
      catalogs: [],
      resources: ['stream'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      behaviorHints: {
        adult: false,
        p2p: false,
        configurable: !isConfigured,
        configurationRequired: !isConfigured
      },
      config: [
        {
          key: 'debridProvider',
          type: 'select',
          title: 'Provedor Debrid',
          description: 'Escolha qual provedor premium serÃ¡ usado para reproduÃ§Ã£o.',
          options: [
            { value: 'realdebrid', label: 'Real-Debrid' },
            { value: 'torbox', label: 'TorBox' }
          ],
          default: 'realdebrid'
        },
        {
          key: 'realdebridToken',
          type: 'text',
          title: 'Token API Real-Debrid',
          description: 'Seu token da API Real-Debrid para acessar links premium'
        },
        {
          key: 'torboxToken',
          type: 'text',
          title: 'Token API TorBox',
          description: 'Seu token da API TorBox para acessar links premium'
        }
      ]
    };
  }

  generateConfigHTML(
    config?: { realdebridToken?: string; torboxToken?: string; debridProvider?: string },
    isConfigured: boolean = false
  ): string {
    const buttonText = isConfigured ? 'Salvar ConfiguraÃ§Ã£o' : 'Instalar Addon';
    const provider = config?.debridProvider ?? 'realdebrid';
    const baseUrl = this.config.baseUrl;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GuIndex â€” ConfiguraÃ§Ã£o</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0a0a0f;
      --surface: #13131a;
      --surface-hover: #1a1a24;
      --border: #2a2a3a;
      --accent: #22c55e;
      --accent-hover: #16a34a;
      --accent-glow: rgba(34, 197, 94, 0.15);
      --text: #e4e4e7;
      --text-dim: #71717a;
      --danger: #ef4444;
      --info-bg: rgba(34, 197, 94, 0.08);
      --info-border: rgba(34, 197, 94, 0.2);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background-image:
        radial-gradient(ellipse at 20% 50%, rgba(34, 197, 94, 0.04) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 50%, rgba(99, 102, 241, 0.03) 0%, transparent 50%);
    }

    .card {
      width: 100%;
      max-width: 480px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }

    .header {
      text-align: center;
      margin-bottom: 28px;
    }

    .logo {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin-bottom: 4px;
    }

    .logo span { color: var(--accent); }

    .subtitle {
      font-size: 13px;
      color: var(--text-dim);
      line-height: 1.5;
    }

    .info-box {
      background: var(--info-bg);
      border: 1px solid var(--info-border);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 24px;
      font-size: 13px;
      line-height: 1.6;
      color: var(--text-dim);
    }

    .info-box strong { color: var(--accent); }
    .info-box a { color: var(--accent); text-decoration: none; }
    .info-box a:hover { text-decoration: underline; }

    .form-group {
      margin-bottom: 18px;
    }

    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
      color: var(--text);
    }

    .helper {
      font-size: 12px;
      color: var(--text-dim);
      margin-top: 4px;
    }

    select, input[type="text"] {
      width: 100%;
      padding: 10px 14px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
      font-family: inherit;
      transition: border-color 0.2s, box-shadow 0.2s;
      outline: none;
    }

    select:focus, input[type="text"]:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-glow);
    }

    input::placeholder { color: var(--text-dim); }

    .btn {
      width: 100%;
      padding: 12px;
      background: var(--accent);
      color: #000;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
      margin-top: 6px;
    }

    .btn:hover { background: var(--accent-hover); }
    .btn:active { transform: scale(0.98); }

    .links {
      margin-top: 20px;
      text-align: center;
      font-size: 12px;
      color: var(--text-dim);
      line-height: 1.8;
    }

    .links a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
    }

    .links a:hover { text-decoration: underline; }

    .aio-box {
      margin-top: 20px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      font-size: 12px;
    }

    .aio-box strong {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      color: var(--text);
    }

    .aio-box code {
      display: block;
      background: var(--surface-hover);
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 11px;
      word-break: break-all;
      color: var(--accent);
      margin-top: 6px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .aio-box code:hover {
      background: var(--border);
    }

    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: var(--accent);
      color: #000;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      opacity: 0;
      transition: transform 0.3s, opacity 0.3s;
      z-index: 999;
    }

    .toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }

    .divider {
      height: 1px;
      background: var(--border);
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">ðŸ‡§ðŸ‡· <span>GuIndex</span></div>
      <div class="subtitle">
        Addon Stremio para conteÃºdo brasileiro<br>
        Torrents nacionais via Real-Debrid ou TorBox
      </div>
    </div>

    <div class="info-box">
      Powered by <a href="https://github.com/felipemarinho97/torrent-indexer" target="_blank"><strong>torrent-indexer</strong></a>
      â€” indexador open source de sites de torrents brasileiros.
    </div>

    <form id="configForm">
      <div class="form-group">
        <label for="provider">Provedor Debrid</label>
        <select id="provider">
          <option value="realdebrid" ${provider === 'realdebrid' ? 'selected' : ''}>Real-Debrid</option>
          <option value="torbox" ${provider === 'torbox' ? 'selected' : ''}>TorBox</option>
        </select>
        <div class="helper">ServiÃ§o que vai resolver os magnets em links diretos.</div>
      </div>

      <div class="form-group" id="rdGroup">
        <label for="rdToken">Token API Real-Debrid</label>
        <input type="text" id="rdToken" placeholder="Cole seu token aqui" value="${config?.realdebridToken || ''}">
      </div>

      <div class="form-group" id="tbGroup">
        <label for="tbToken">Token API TorBox</label>
        <input type="text" id="tbToken" placeholder="Cole seu token aqui" value="${config?.torboxToken || ''}">
      </div>

      <button type="submit" class="btn">${buttonText}</button>
    </form>

    <div class="links">
      <a href="https://real-debrid.com/apitoken" target="_blank">Obter token Real-Debrid â†’</a><br>
      <a href="https://torbox.app/settings" target="_blank">Obter token TorBox â†’</a>
    </div>

    <div class="divider"></div>

    <div class="aio-box">
      <strong>ðŸ“¡ URL para AIOStreams</strong>
      <div class="helper">Clique para copiar. Substitua TOKEN pelo seu token.</div>
      <code id="aioUrl" onclick="copyAio()">${baseUrl}/manifest.json?debridProvider=torbox&torboxToken=TOKEN</code>
    </div>
  </div>

  <div class="toast" id="toast">Copiado! âœ“</div>

  <script>
    (function() {
      var baseUrl = '${baseUrl}';
      var provEl = document.getElementById('provider');
      var rdGroup = document.getElementById('rdGroup');
      var tbGroup = document.getElementById('tbGroup');

      function toggleFields() {
        var isTb = provEl.value === 'torbox';
        rdGroup.style.display = isTb ? 'none' : 'block';
        tbGroup.style.display = isTb ? 'block' : 'none';
        updateAioUrl();
      }

      function updateAioUrl() {
        var p = provEl.value;
        var key = p === 'torbox' ? 'torboxToken' : 'realdebridToken';
        document.getElementById('aioUrl').textContent =
          baseUrl + '/manifest.json?debridProvider=' + p + '&' + key + '=TOKEN';
      }

      provEl.addEventListener('change', toggleFields);
      toggleFields();

      document.getElementById('configForm').addEventListener('submit', function(e) {
        e.preventDefault();
        var provider = provEl.value;
        var rdToken = document.getElementById('rdToken').value.trim();
        var tbToken = document.getElementById('tbToken').value.trim();
        var token = provider === 'torbox' ? tbToken : rdToken;
        if (!token) { alert('Preencha o token do provedor selecionado.'); return; }

        var params = new URLSearchParams();
        params.set('debridProvider', provider);
        if (rdToken) params.set('realdebridToken', rdToken);
        if (tbToken) params.set('torboxToken', tbToken);
        var installUrl = baseUrl + '/manifest.json?' + params.toString();

        navigator.clipboard.writeText(installUrl).then(function() {
          showToast('URL copiada! Cole no Stremio para instalar.');
        }).catch(function() {
          prompt('Copie esta URL e cole no Stremio:', installUrl);
        });
      });
    })();

    function copyAio() {
      var text = document.getElementById('aioUrl').textContent;
      navigator.clipboard.writeText(text).then(function() {
        showToast('URL AIOStreams copiada!');
      });
    }

    function showToast(msg) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(function() { t.classList.remove('show'); }, 2500);
    }
  </script>
</body>
</html>`;
  }
}
