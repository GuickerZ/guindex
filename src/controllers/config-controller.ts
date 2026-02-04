/**
 * Config Controller
 */

import type { AddonManifest } from '../models/config-model.js';
import { ConfigService } from '../services/config-service.js';
export class ConfigController {
  private config = ConfigService.loadConfig();

  createAddonManifest(isConfigured: boolean = false): AddonManifest {
    return {
      id: 'org.andre.brazuca-rd',
      version: '1.0.0',
      name: 'Brazuca RD',
      description:
        'Proxies Brazuca Torrents addon magnets through Real-Debrid or Torbox into direct streams. Credits: Brazuca Torrents addon author.',
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
          title: 'Debrid Provider',
          description: 'Choose which premium provider will be used for playback.',
          options: [
            { value: 'realdebrid', label: 'Real-Debrid' },
            { value: 'torbox', label: 'Torbox' }
          ],
          default: 'realdebrid'
        },
        {
          key: 'realdebridToken',
          type: 'text',
          title: 'Real-Debrid API Token',
          description: 'Your Real-Debrid API token for accessing premium links'
        },
        {
          key: 'torboxToken',
          type: 'text',
          title: 'Torbox API Token',
          description: 'Your Torbox API token for accessing premium links'
        }
      ]
    };
  }

  generateConfigHTML(
    config?: { realdebridToken?: string; torboxToken?: string; debridProvider?: string },
    isConfigured: boolean = false
  ): string {
    const buttonText = isConfigured ? 'Save Configuration' : 'Install Addon';
    const provider = config?.debridProvider ?? 'realdebrid';
    const baseUrl = this.config.baseUrl;

    return `
<!DOCTYPE html>
<html>
<head>
  <title>Brazuca RD Configuration</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
    .container { max-width: 520px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #333; margin-bottom: 20px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 5px; font-weight: bold; }
    input[type="text"] { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
    select { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
    .btn { background: #6c5ce7; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
    .btn:hover { background: #5a4fcf; }
    .info { background: #e8f4fd; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
    .link { color: #6c5ce7; text-decoration: none; }
    .helper { font-size: 13px; color: #666; margin-top: 6px; }
    code { background: #f0f0f0; padding: 2px 4px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Brazuca RD Configuration</h1>
    <div class="info">
      <strong>Brazuca RD</strong> - Proxies Brazuca Torrents through Real-Debrid or Torbox for direct streaming.<br>
      <strong>Credits:</strong> <a href="https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/" class="link" target="_blank">Brazuca Torrents addon</a>
    </div>
    <form id="configForm">
      <div class="form-group">
        <label for="provider">Debrid Provider:</label>
        <select id="provider">
          <option value="realdebrid" ${provider === 'realdebrid' ? 'selected' : ''}>Real-Debrid</option>
          <option value="torbox" ${provider === 'torbox' ? 'selected' : ''}>Torbox</option>
        </select>
        <div class="helper">Choose the provider that will process your magnets.</div>
      </div>
      <div class="form-group">
        <label for="rdToken">Real-Debrid API Token:</label>
        <input type="text" id="rdToken" placeholder="Enter your Real-Debrid API token" value="${config?.realdebridToken || ''}">
      </div>
      <div class="form-group">
        <label for="tbToken">Torbox API Token:</label>
        <input type="text" id="tbToken" placeholder="Enter your Torbox API token" value="${config?.torboxToken || ''}">
      </div>
      <button type="submit" class="btn">${buttonText}</button>
    </form>
    <div style="margin-top: 20px; font-size: 14px; color: #666;">
      <strong>Get your Real-Debrid API token:</strong><br>
      <a href="https://real-debrid.com/apitoken" class="link" target="_blank">Real-Debrid API Token</a>
      <br><br>
      <strong>Get your Torbox API token:</strong><br>
      <a href="https://torbox.app/" class="link" target="_blank">Torbox Account</a>
    </div>
    <div class="info" style="margin-top: 20px;">
      <strong>AIOStreams onboarding</strong><br>
      Copy this URL into AIOStreams (replace TOKEN):<br>
      <code>${baseUrl}/manifest.json?debridProvider=torbox&torboxToken=TOKEN</code><br>
      Or Real-Debrid:<br>
      <code>${baseUrl}/manifest.json?debridProvider=realdebrid&realdebridToken=TOKEN</code>
    </div>
  </div>
  <script>
    (function() {
      const baseUrl = '${baseUrl}';
      document.getElementById('configForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const provider = document.getElementById('provider').value;
        const rdToken = document.getElementById('rdToken').value.trim();
        const tbToken = document.getElementById('tbToken').value.trim();
        const token = provider === 'torbox' ? tbToken : rdToken;
        if (!token) return;
        
        const params = new URLSearchParams();
        params.set('debridProvider', provider);
        if (rdToken) params.set('realdebridToken', rdToken);
        if (tbToken) params.set('torboxToken', tbToken);
        const installUrl = baseUrl + '/manifest.json?' + params.toString();
        
        ${isConfigured ? `
        window.location.href = installUrl;
        ` : `
        navigator.clipboard.writeText(installUrl).then(() => {
          alert('Install URL copied to clipboard!\\n\\nPaste it in Stremio to install the addon.');
        }).catch(() => {
          prompt('Copy this URL to install in Stremio:', installUrl);
        });
        `}
      });
    })();
  </script>
</body>
</html>
    `;
  }
}
