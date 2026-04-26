/**
 * Config Controller
 * Gera o manifest Stremio e a pagina de configuracao do addon.
 */

import type { AddonManifest } from '../models/config-model.js';
import { ConfigService } from '../services/config-service.js';

export class ConfigController {
  private config = ConfigService.loadConfig();

  createAddonManifest(isConfigured: boolean = false): AddonManifest {
    return {
      id: 'org.guindex.addon',
      version: '1.2.0',
      name: 'GuIndex',
      description:
        'Addon brasileiro para Stremio. Busca torrents nacionais via torrent-indexer e resolve via Real-Debrid ou TorBox.',
      catalogs: [],
      resources: ['stream'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      logo: 'https://raw.githubusercontent.com/GuickerZ/guindex/main/public/logo.png',
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
          description: 'Escolha qual provedor premium sera usado para reproducao.',
          options: ['torbox', 'realdebrid'],
          default: 'torbox'
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
      ],
      stremioAddonsConfig: {
        issuer: 'https://stremio-addons.net',
        signature: 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..9Gt-l6yAe0hT6TNuH1hTJQ.o6CoZLJ1l5t_Mg-gC-kb-UjmANxYSmNxKelV6LRowL-nBGiC343s6Hbu1hw-uYE1_TAeHbwtZysKds9luRbyJ1PB7gMvsQOxZuLNFe9v0IGuxB-kn4WLW6euGLbAP1s9.mlZU3aeRU4kLvLztuVscWA'
      }
    };
  }

  generateConfigHTML(
    config?: { realdebridToken?: string; torboxToken?: string; debridProvider?: string },
    isConfigured: boolean = false
  ): string {
    const buttonText = isConfigured ? 'Salvar' : 'Instalar Addon';
    const provider = config?.debridProvider ?? 'torbox';
    const baseUrl = this.config.baseUrl;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GuIndex - Addon Stremio BR</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #08080d;
      --surface: #111118;
      --surface-2: #191920;
      --border: #25252f;
      --accent: #10b981;
      --accent-hover: #059669;
      --accent-glow: rgba(16, 185, 129, 0.12);
      --accent-2: #6366f1;
      --text: #e4e4e7;
      --text-dim: #71717a;
      --text-xdim: #52525b;
      --danger: #ef4444;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background-image:
        radial-gradient(ellipse at 30% 20%, rgba(16, 185, 129, 0.06) 0%, transparent 50%),
        radial-gradient(ellipse at 70% 80%, rgba(99, 102, 241, 0.04) 0%, transparent 50%);
    }
    .card {
      width: 100%; max-width: 460px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .header { text-align: center; margin-bottom: 24px; }
    .logo { font-size: 32px; font-weight: 800; letter-spacing: -1px; }
    .logo span { color: var(--accent); }
    .badge {
      display: inline-block;
      background: var(--accent-glow);
      color: var(--accent);
      font-size: 11px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 20px;
      margin-top: 6px;
      border: 1px solid rgba(16,185,129,0.15);
    }
    .subtitle { font-size: 13px; color: var(--text-dim); margin-top: 8px; line-height: 1.5; }
    .info-box {
      background: rgba(16,185,129,0.06);
      border: 1px solid rgba(16,185,129,0.15);
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 20px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--text-dim);
    }
    .info-box a { color: var(--accent); text-decoration: none; font-weight: 600; }
    .info-box a:hover { text-decoration: underline; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 5px; color: var(--text); letter-spacing: 0.3px; }
    .helper { font-size: 11px; color: var(--text-xdim); margin-top: 3px; }
    select, input[type="text"] {
      width: 100%; padding: 10px 12px;
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 8px; color: var(--text);
      font-size: 13px; font-family: inherit;
      transition: border-color 0.2s, box-shadow 0.2s;
      outline: none;
    }
    select:focus, input[type="text"]:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
    input::placeholder { color: var(--text-xdim); }
    .btn {
      width: 100%; padding: 11px;
      background: var(--accent); color: #000;
      border: none; border-radius: 8px;
      font-size: 14px; font-weight: 700;
      font-family: inherit; cursor: pointer;
      transition: background 0.2s, transform 0.1s;
      margin-top: 4px; letter-spacing: 0.3px;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn:active { transform: scale(0.98); }
    .btn[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
    }
    .links { margin-top: 16px; text-align: center; font-size: 11px; color: var(--text-xdim); line-height: 2; }
    .links a { color: var(--accent); text-decoration: none; font-weight: 500; }
    .links a:hover { text-decoration: underline; }
    .divider { height: 1px; background: var(--border); margin: 18px 0; }
    .aio-box {
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 10px; padding: 12px 14px; font-size: 11px;
    }
    .aio-box strong { display: block; margin-bottom: 4px; font-size: 12px; color: var(--text); }
    .aio-box code {
      display: block; background: var(--surface-2);
      padding: 8px 10px; border-radius: 6px;
      font-size: 10px; word-break: break-all;
      color: var(--accent); margin-top: 5px;
      cursor: pointer; transition: background 0.2s;
      border: 1px solid var(--border);
    }
    .aio-box code:hover { background: var(--border); }
    .footer {
      margin-top: 20px; text-align: center;
      font-size: 10px; color: var(--text-xdim); line-height: 1.8;
    }
    .footer a { color: var(--accent-2); text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    .star-btn {
      display: inline-flex; align-items: center; gap: 4px;
      background: var(--surface-2); color: var(--text-dim);
      border: 1px solid var(--border);
      padding: 4px 10px; border-radius: 6px;
      font-size: 11px; font-weight: 500; text-decoration: none;
      transition: border-color 0.2s, color 0.2s;
      margin: 2px;
    }
    .star-btn:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; }
    .toast {
      position: fixed; bottom: 24px; left: 50%;
      transform: translateX(-50%) translateY(80px);
      background: var(--accent); color: #000;
      padding: 10px 20px; border-radius: 8px;
      font-size: 13px; font-weight: 600;
      opacity: 0; transition: transform 0.3s, opacity 0.3s;
      z-index: 999;
    }
    .toast.show { transform: translateX(-50%) translateY(0); opacity: 1; }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.72);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 1000;
    }
    .modal-backdrop.show { display: flex; }
    .modal {
      width: 100%;
      max-width: 540px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 12px 44px rgba(0, 0, 0, 0.6);
      overflow: hidden;
    }
    .modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
    }
    .modal-title {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    .modal-close {
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      border-radius: 6px;
      width: 30px;
      height: 30px;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
    }
    .modal-body {
      padding: 16px;
      display: grid;
      gap: 14px;
    }
    .modal-grid {
      display: grid;
      gap: 14px;
      grid-template-columns: 1.15fr 0.85fr;
    }
    .modal-panel {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
    }
    .modal-panel h3 {
      font-size: 12px;
      margin-bottom: 8px;
      color: var(--text);
      letter-spacing: 0.2px;
    }
    .modal-panel p {
      font-size: 11px;
      color: var(--text-dim);
      line-height: 1.5;
      margin-bottom: 10px;
    }
    .modal-url {
      font-size: 10px;
      color: var(--accent);
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 8px;
      word-break: break-all;
      margin-top: 8px;
    }
    .modal-actions {
      display: grid;
      gap: 8px;
    }
    .modal-btn {
      width: 100%;
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text);
      border-radius: 8px;
      padding: 10px;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      text-align: center;
      cursor: pointer;
      font-family: inherit;
    }
    .modal-btn:hover { border-color: var(--accent); color: var(--accent); }
    .modal-btn.primary {
      background: var(--accent);
      color: #000;
      border-color: transparent;
    }
    .modal-btn.primary:hover { background: var(--accent-hover); color: #000; }
    .qr {
      width: 100%;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #fff;
      display: block;
    }
    .hint-mini {
      margin-top: 8px;
      font-size: 10px;
      color: var(--text-xdim);
      text-align: center;
      line-height: 1.5;
    }
    @media (max-width: 640px) {
      .card { padding: 22px; }
      .modal-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body data-base-url="${baseUrl}">
  <div class="card">
    <div class="header">
      <div class="logo">Gu<span>Index</span></div>
      <div class="badge">v1.2.0 &bull; Open Source</div>
      <div class="subtitle">
        Addon Stremio para torrents brasileiros<br>
        via Real-Debrid ou TorBox
      </div>
    </div>

    <div class="info-box">
      &#9889; Powered by <a href="https://github.com/felipemarinho97/torrent-indexer" target="_blank">torrent-indexer</a>
      &mdash; indexador open source de sites de torrents BR por
      <a href="https://github.com/felipemarinho97" target="_blank">@felipemarinho97</a>.
      <br>&#11088; <a href="https://github.com/felipemarinho97/torrent-indexer" target="_blank">De uma estrela no projeto dele!</a>
    </div>

    <form id="configForm">
      <div class="form-group">
        <label for="provider">PROVEDOR DEBRID</label>
        <select id="provider">
          <option value="torbox" ${provider === 'torbox' ? 'selected' : ''}>TorBox</option>
          <option value="realdebrid" ${provider === 'realdebrid' ? 'selected' : ''}>Real-Debrid</option>
        </select>
        <div class="helper">Servico que vai resolver os magnets em links diretos.</div>
      </div>

      <div class="form-group" id="rdGroup" style="display:${provider === 'torbox' ? 'none' : 'block'}">
        <label for="rdToken">TOKEN REAL-DEBRID</label>
        <input type="text" id="rdToken" placeholder="Cole seu token aqui" value="${config?.realdebridToken || ''}">
        <div class="helper"><a href="https://real-debrid.com/apitoken" target="_blank" style="color:var(--accent)">Obter token &rarr;</a></div>
      </div>

      <div class="form-group" id="tbGroup" style="display:${provider === 'torbox' ? 'block' : 'none'}">
        <label for="tbToken">TOKEN TORBOX</label>
        <input type="text" id="tbToken" placeholder="Cole seu token aqui" value="${config?.torboxToken || ''}">
        <div class="helper"><a href="https://torbox.app/settings" target="_blank" style="color:var(--accent)">Obter token &rarr;</a></div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px;">
        <button type="button" id="installBtn" class="btn">Instalar Addon</button>
        <div class="helper" style="text-align:center">As opcoes de instalacao aparecem no modal.</div>
      </div>
    </form>

    <div class="divider"></div>

    <div class="aio-box">
      <strong>&#128225; URL para AIOStreams</strong>
      <div class="helper">Clique para copiar. Substitua TOKEN pelo seu token real.</div>
      <code id="aioUrl">${baseUrl}/manifest.json?debridProvider=torbox&amp;torboxToken=TOKEN</code>
    </div>

    <div class="divider"></div>

    <div style="text-align:center">
      <a class="star-btn" href="https://github.com/GuickerZ/guindex" target="_blank">&#11088; Dar estrela no GuIndex</a>
      <a class="star-btn" href="https://github.com/felipemarinho97/torrent-indexer" target="_blank">&#11088; Dar estrela no torrent-indexer</a>
    </div>

    <div class="footer">
      Feito por <a href="https://github.com/GuickerZ" target="_blank">@GuickerZ</a>
      &bull; <a href="https://github.com/GuickerZ/guindex" target="_blank">Codigo fonte</a>
      &bull; <a href="https://github.com/GuickerZ/guindex/issues" target="_blank">Reportar bug</a>
    </div>
  </div>

  <div class="modal-backdrop" id="installModal" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-head">
        <div id="modalTitle" class="modal-title">Instalacao do addon</div>
        <button type="button" class="modal-close" id="closeModal" aria-label="Fechar">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-grid">
          <div class="modal-panel">
            <h3>Windows / Android (App Stremio)</h3>
            <p>Clique em abrir no app. Se o navegador bloquear, copie a URL e cole manualmente no Stremio.</p>
            <div class="modal-actions">
              <button type="button" class="modal-btn primary" id="openInStremioBtn">Abrir no Stremio</button>
              <button type="button" class="modal-btn" id="copyFromModalBtn">Copiar URL de instalacao</button>
              <a id="installWebLink" class="modal-btn" href="#" target="_blank" rel="noopener noreferrer">Instalar no Stremio Web</a>
            </div>
            <div id="modalUrl" class="modal-url"></div>
            <div id="modalHint" class="helper"></div>
          </div>

          <div class="modal-panel">
            <h3>Android rapido</h3>
            <p>Escaneie o QR code com o celular para abrir o link de instalacao.</p>
            <img id="installQr" class="qr" alt="QR code de instalacao">
            <div class="hint-mini">No Android, pode aparecer confirmacao para abrir no app Stremio.</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script src="/config-page.js"></script>
</body>
</html>`;
  }
}
