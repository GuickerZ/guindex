<p align="center">
  <img src="https://raw.githubusercontent.com/GuickerZ/guindex/main/public/guindex-logo.png" width="180" alt="GuIndex Logo">
</p>

<p align="center">
  <strong>GuIndex</strong><br>
  <em>Addon Stremio para conteudo brasileiro via Real-Debrid / TorBox</em>
</p>

<p align="center">
  <a href="https://github.com/GuickerZ/guindex/stargazers"><img src="https://img.shields.io/github/stars/GuickerZ/guindex?style=for-the-badge&color=10b981&labelColor=111118" alt="Stars"></a>
  <a href="https://github.com/GuickerZ/guindex/issues"><img src="https://img.shields.io/github/issues/GuickerZ/guindex?style=for-the-badge&color=6366f1&labelColor=111118" alt="Issues"></a>
  <a href="https://github.com/GuickerZ/guindex/blob/main/LICENSE"><img src="https://img.shields.io/github/license/GuickerZ/guindex?style=for-the-badge&color=10b981&labelColor=111118" alt="License"></a>
</p>

<p align="center">
  <a href="https://guindex-stremio.vercel.app">Instancia Publica</a> &bull;
  <a href="#instalacao">Instalacao</a> &bull;
  <a href="#torrent-indexer">Torrent Indexer</a> &bull;
  <a href="https://github.com/GuickerZ/guindex/issues">Reportar Bug</a>
</p>

---

## O que e?

O **GuIndex** e um addon para o [Stremio](https://www.stremio.com/) que funciona como uma ponte entre o indexador de torrents brasileiros e servicos de debrid (Real-Debrid / TorBox).

Diferente de outras solucoes que exigem Prowlarr, Jackett ou configuracoes complexas, o GuIndex funciona direto: instala no Stremio e assiste.

```
Stremio -> GuIndex -> torrent-indexer -> sites brasileiros de torrent
                  |
            Real-Debrid / TorBox -> Stream direto (sem P2P)
```

### Como funciona

1. O Stremio pede streams para um filme ou serie
2. O GuIndex consulta o [torrent-indexer](https://github.com/felipemarinho97/torrent-indexer) que indexa sites brasileiros
3. Os resultados sao processados com matching inteligente de temporada/episodio
4. Os magnets sao resolvidos pelo seu debrid (RD ou TB) em links diretos
5. Voce assiste com qualidade, sem depender de seeders, sem P2P

### Funcionalidades

- **Filmes e Series** - suporte completo a ambos os tipos
- **Otimizado para BR** - regex especifico para padroes de releases brasileiros
- **Real-Debrid + TorBox** - suporte a ambos os provedores
- **Season Packs** - selecao inteligente do episodio correto dentro de packs
- **Filtro de lixo** - remove amostras, propagandas, arquivos pequenos automaticamente
- **Addons externos** - agrega streams de outros addons que nao suportam debrid
- **AIOStreams** - compativel com [AIOStreams](https://github.com/Viren070/AIOStreams)
- **Docker** - pronto para self-host

---

## Torrent Indexer

> **Creditos importantes**: Este projeto depende inteiramente do [torrent-indexer](https://github.com/felipemarinho97/torrent-indexer), um projeto open source criado por [@felipemarinho97](https://github.com/felipemarinho97). Ele indexa os principais sites brasileiros de torrents e inclusive hospeda a instancia publica que o GuIndex usa por padrao. Sem o trabalho dele, este addon nao existiria.

<p align="center">
  <a href="https://github.com/felipemarinho97/torrent-indexer"><img src="https://img.shields.io/github/stars/felipemarinho97/torrent-indexer?style=for-the-badge&color=f59e0b&labelColor=111118&label=torrent-indexer%20stars" alt="torrent-indexer stars"></a>
</p>

O GuIndex ja vem configurado com uma instancia propria do torrent-indexer. Se voce quiser hospedar a sua:

```bash
# Docker (porta interna: 7006)
docker run -d -p 8090:7006 --restart unless-stopped ghcr.io/felipemarinho97/torrent-indexer:latest

# Configure no .env do GuIndex:
TORRENT_INDEXER_URL=http://localhost:8090
```

Opcoes de hosting: **Render** (free tier), **Railway**, **Fly.io**, ou qualquer VPS com Docker.

Consulte o [README do torrent-indexer](https://github.com/felipemarinho97/torrent-indexer) para mais detalhes sobre os sites suportados e como configurar.

---

## Instalacao

### Opcao 1: Instancia publica

Acesse **[guindex-stremio.vercel.app](https://guindex-stremio.vercel.app)**, configure seu token e instale no Stremio.

### Opcao 2: Docker (recomendado para self-host)

```bash
git clone https://github.com/GuickerZ/guindex.git
cd guindex
cp .env.example .env
# Edite .env: defina BASE_URL com seu dominio
docker compose up -d
```

### Opcao 3: Node.js manual

```bash
git clone https://github.com/GuickerZ/guindex.git
cd guindex
npm install
cp .env.example .env
# Edite .env: defina BASE_URL
npm run build
npm start
```

### Opcao 4: Cloud

| Plataforma | Arquivo | Deploy |
|-----------|---------|--------|
| **Vercel** | `vercel.json` | Fork + import no Vercel |
| **Render** | `render.yaml` | Fork + new Web Service |
| **Docker** | `Dockerfile` | Qualquer host com Docker |

> **Importante:** Em producao, defina `BASE_URL` com o dominio publico da sua instancia.

---

## Configuracao

### Variaveis de Ambiente

| Variavel | Obrigatoria | Descricao |
|----------|:-----------:|-----------|
| `PORT` | Nao | Porta do servidor (padrao: `7000`) |
| `BASE_URL` | **Sim** (prod) | URL publica da sua instancia |
| `LOG_LEVEL` | Nao | `debug`, `info`, `warn`, `error` |
| `TORRENT_INDEXER_URL` | Nao | URL do torrent-indexer (padrao: instancia publica) |
| `TORRENT_INDEXER_ENABLE_FALLBACK` | Nao | Ativa fallback para `/indexers/{nome}` quando `/search` vier vazio (`true`/`false`) |
| `TORRENT_INDEXER_SEARCH_CACHE_TTL_MS` | Nao | TTL do cache de busca em memoria (padrao: `120000`) |
| `TORRENT_INDEXER_INDEXERS_CACHE_TTL_MS` | Nao | TTL do cache da lista de indexers de `/sources` (padrao: `600000`) |
| `TORRENT_INDEXER_LOCALIZED_TITLE_CACHE_TTL_MS` | Nao | TTL do cache de titulos localizados (IMDb -> TMDB) (padrao: `604800000`) |
| `TORRENT_INDEXER_TMDB_TIMEOUT_MS` | Nao | Timeout de consulta ao TMDB para titulos localizados (padrao: `5000`) |
| `TMDB_API_READ_ACCESS_TOKEN` | Nao | Token de leitura do TMDB (Bearer). Informe este ou `TMDB_API_KEY` |
| `TMDB_API_KEY` | Nao | Chave da API TMDB. Informe esta ou `TMDB_API_READ_ACCESS_TOKEN` |
| `TORRENT_INDEXER_FALLBACK_MAX_INDEXERS` | Nao | Maximo de indexers usados no fallback; `0` usa todos (padrao: `0`) |
| `TORRENT_INDEXER_FALLBACK_PER_INDEXER_LIMIT` | Nao | Limite de resultados por indexer no fallback; `0` ou vazio omite o limite por completo (padrao: `0`) |
| `TORRENT_INDEXER_FALLBACK_CONCURRENCY` | Nao | Concurrency de consultas de fallback (padrao: `3`) |
| `TORRENT_INDEXER_FALLBACK_TIMEOUT_MS` | Nao | Timeout por request no fallback e `/search` (padrao: `4500`) |
| `TORRENT_INDEXER_MAX_QUERY_TIME_MS` | Nao | Orcamento maximo de tempo por busca de stream antes de parar novas tentativas (padrao: `15000`) |
| `TORRENT_INDEXER_TARGET_STREAMS` | Nao | Quantidade alvo de streams para encerrar cedo quando ja houver diversidade (padrao: `12`) |
| `TORRENT_INDEXER_MAX_DYNAMIC_QUERIES` | Nao | Limite de queries dinamicas geradas a partir de titulos retornados para melhorar recall (padrao: `10`) |
| `TORRENT_INDEXER_HYBRID_MIN_RESULTS` | Nao | Abaixo disso, complementa `/search` com fallback (padrao: `10`) |
| `TORRENT_INDEXER_HYBRID_MIN_INDEXERS` | Nao | Numero minimo de fontes distintas antes de acionar boost (padrao: `2`) |
| `TORRENT_INDEXER_HYBRID_TARGET_RESULTS` | Nao | Meta de resultados agregados na busca hibrida (padrao: `24`) |
| `TORRENT_INDEXER_MAX_STREAMS_PER_SOURCE` | Nao | Limita quantidade de streams por source para evitar monopolio (padrao: `18`) |
| `TORRENT_INDEXER_DISABLED_INDEXERS` | Nao | Lista CSV de indexers desativados (padrao: `comando_torrents`) |
| `TORRENT_INDEXER_FAILURE_THRESHOLD` | Nao | Falhas consecutivas antes de colocar a source em cooldown temporario (padrao: `2`) |
| `TORRENT_INDEXER_FAILURE_COOLDOWN_MS` | Nao | Tempo de cooldown de uma source apos atingir o limite de falhas (padrao: `900000`) |
| `TORBOX_WAIT_VIDEO_URL` | Nao | Video de espera enquanto TorBox processa |
| `TORBOX_STREAM_LIMIT` | Nao | Limite de streams TorBox (padrao: `15`) |

> Compatibilidade: `TORRENT_INDEXER_INDEXER_FAILURE_THRESHOLD` e `TORRENT_INDEXER_INDEXER_FAILURE_COOLDOWN_MS` continuam aceitos como aliases legados.

### Perfil recomendado para VPS (baixa latencia)

Baseado na bateria completa de fontes (analise de todos os itens retornados), este perfil reduz timeout/ruido sem perder cobertura dos cenarios principais.

```bash
# Busca e fallback
TORRENT_INDEXER_ENABLE_FALLBACK=true
TORRENT_INDEXER_FALLBACK_MAX_INDEXERS=0
TORRENT_INDEXER_FALLBACK_PER_INDEXER_LIMIT=0
TORRENT_INDEXER_FALLBACK_CONCURRENCY=5
TORRENT_INDEXER_FALLBACK_TIMEOUT_MS=12000

# Orcamento e expansao de query
TORRENT_INDEXER_MAX_QUERY_TIME_MS=18000
TORRENT_INDEXER_TARGET_STREAMS=12
TORRENT_INDEXER_MAX_DYNAMIC_QUERIES=10
TORRENT_INDEXER_HYBRID_MIN_RESULTS=10
TORRENT_INDEXER_HYBRID_MIN_INDEXERS=2
TORRENT_INDEXER_HYBRID_TARGET_RESULTS=24
TORRENT_INDEXER_MAX_STREAMS_PER_SOURCE=50

# Saude das fontes (somente desativar indexers que nao funcionam)
TORRENT_INDEXER_DISABLED_INDEXERS=comando_torrents,bludv,filme_torrent
TORRENT_INDEXER_FAILURE_THRESHOLD=2
TORRENT_INDEXER_FAILURE_COOLDOWN_MS=900000

# Cache
TORRENT_INDEXER_SEARCH_CACHE_TTL_MS=120000
TORRENT_INDEXER_INDEXERS_CACHE_TTL_MS=600000
TORRENT_INDEXER_LOCALIZED_TITLE_CACHE_TTL_MS=604800000

# Localizacao via TMDB (imdbId -> titulo pt-BR)
TMDB_API_READ_ACCESS_TOKEN=SEU_TOKEN_TMDB
# ou
# TMDB_API_KEY=SUA_CHAVE_TMDB
```

Se quiser priorizar cobertura maxima de long tail em troca de mais latencia, remova uma source da lista em `TORRENT_INDEXER_DISABLED_INDEXERS`.

### Uso com Stremio

Acesse a pagina de configuracao da sua instancia e siga as instrucoes. A URL do manifest segue o formato:

```
https://seu-dominio.com/manifest.json?debridProvider=torbox&torboxToken=SEU_TOKEN
```

### Uso com AIOStreams

O GuIndex e compativel com o [AIOStreams](https://github.com/Viren070/AIOStreams). Adicione como addon customizado usando a URL do manifest.

O arquivo `aiostreams-config-exemplo.json` contem uma configuracao de referencia praticamente pronta para usuarios brasileiros do Stremio com TorBox. Inclui addons BR populares, formatacao customizada com emojis, filtros de qualidade e ordenacao otimizada. Adapte os tokens e use como ponto de partida.

---

## Addons Externos

O GuIndex tambem agrega streams de **outros addons Stremio** que nao possuem suporte nativo a debrid. Configure em `src/config/sources.ts`:

```typescript
export const SOURCES: BaseSourceProvider[] = [
  new TorrentIndexerProvider('GuIndex', TORRENT_INDEXER_BASE_URL),
  new StremioAddonProvider('MeuAddon', 'https://url-do-addon.com'),
  // Adicione quantos quiser
];
```

Magnets de qualquer addon passam pelo seu debrid automaticamente.

---

## Stack Tecnica

| Tecnologia | Uso |
|-----------|-----|
| **TypeScript** | Linguagem principal |
| **Fastify** | Servidor HTTP |
| **Node.js 18+** | Runtime |
| **Undici** | Cliente HTTP para APIs debrid |
| **Pino** | Logger estruturado |
| **Zod** | Validacao de schemas |
| **Docker** | Containerizacao |

### Estrutura do Projeto

```
src/
├── server.ts                       # Ponto de entrada
├── config/
│   └── sources.ts                  # Fontes de streams
├── controllers/
│   ├── config-controller.ts        # Manifest + pagina de config
│   └── stream-controller.ts        # Streams + resolucao debrid
├── models/                         # Tipos TypeScript
├── routes/
│   └── routes.ts                   # Rotas HTTP
└── services/
    ├── realdebrid-service.ts       # Real-Debrid API + file selection
    ├── torbox-service.ts           # TorBox API + file selection
    ├── torbox-client.ts            # Cliente TorBox
    ├── torrent-indexer-provider.ts  # Provider principal
    ├── stremio-addon-provider.ts    # Provider para addons externos
    ├── stream-service.ts           # Processamento de streams
    ├── source-service.ts           # Orquestrador
    ├── config-service.ts           # Config
    └── base-source-provider.ts     # Interface base
```

---

## Contribuindo

Este projeto foi feito por uma pessoa e precisa da comunidade. Contribuicoes sao muito bem-vindas!

1. Fork o repositorio
2. Crie uma branch: `git checkout -b minha-melhoria`
3. Commit: `git commit -m 'Melhoria X'`
4. Push: `git push origin minha-melhoria`
5. Abra um Pull Request

### Ideias

- Mais padroes de nomes de releases BR
- Suporte a AllDebrid, Premiumize, etc.
- Testes automatizados
- Catalogos nativos
- Interface de admin

---

## Apoie o Projeto

Se o GuIndex te ajuda, considere:

- **Dar uma estrela** neste repositorio e no [torrent-indexer](https://github.com/felipemarinho97/torrent-indexer)
- **Reportar bugs** e sugerir melhorias nas [issues](https://github.com/GuickerZ/guindex/issues)
- **Contribuir com codigo** via Pull Requests
- **Compartilhar** com outros usuarios brasileiros do Stremio
- **Self-hospedar** o torrent-indexer para aliviar a carga da instancia publica

<p align="center">
  <a href="https://github.com/GuickerZ/guindex/stargazers"><img src="https://img.shields.io/github/stars/GuickerZ/guindex?style=for-the-badge&color=10b981&labelColor=111118&label=GuIndex" alt="Star GuIndex"></a>
  <a href="https://github.com/felipemarinho97/torrent-indexer/stargazers"><img src="https://img.shields.io/github/stars/felipemarinho97/torrent-indexer?style=for-the-badge&color=f59e0b&labelColor=111118&label=torrent-indexer" alt="Star torrent-indexer"></a>
</p>

---

## Agradecimentos

- [@felipemarinho97](https://github.com/felipemarinho97) pelo [torrent-indexer](https://github.com/felipemarinho97/torrent-indexer) - a base de tudo
- [AIOStreams](https://github.com/Viren070/AIOStreams) pela engine de agregacao
- Comunidade Stremio brasileira

---

## Licenca

MIT - use como quiser.

<p align="center">
  <sub>Feito por <a href="https://github.com/GuickerZ">@GuickerZ</a></sub>
</p>
