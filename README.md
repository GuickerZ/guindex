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
  <a href="#arquitetura">Arquitetura</a> &bull;
  <a href="#infraestrutura-self-hosted">Infra Self-Hosted</a> &bull;
  <a href="https://github.com/GuickerZ/guindex/issues">Reportar Bug</a>
</p>

---

## O que e?

O **GuIndex** e um addon para o [Stremio](https://www.stremio.com/) focado em conteudo brasileiro. Ele conecta um indexador de torrents BR a servicos de debrid (Real-Debrid / TorBox), entregando streams em qualidade sem depender de seeders nem P2P.

Diferente de outras solucoes que exigem Prowlarr, Jackett ou configuracoes complexas, o GuIndex funciona direto: instala no Stremio e assiste.

### Funcionalidades

- **Filmes e Series** — suporte completo, incluindo season packs com selecao inteligente de episodio
- **Otimizado para BR** — regex especifico para padroes de releases brasileiros (`1ª Temporada`, `DUAL 5.1`, etc.)
- **Real-Debrid + TorBox** — suporte a ambos os provedores com verificacao de cache
- **Busca em 2 fases** — cache Meilisearch instantaneo + scraping live quando necessario
- **Resolucao de titulos PT-BR** — converte IMDb ID em titulo localizado via TMDB para melhorar hits em indexers que nao suportam IMDB
- **Filtro de lixo** — remove amostras, propagandas, arquivos pequenos e resultados de titulos errados automaticamente
- **Addons externos** — agrega streams de outros addons Stremio que nao suportam debrid
- **AIOStreams** — compativel com [AIOStreams](https://github.com/Viren070/AIOStreams)
- **Docker** — pronto para self-host

---

## Arquitetura

### Fluxo completo de uma requisicao

```
Stremio/AIOStreams
       │
       ▼
   GuIndex (Vercel/VPS)
       │
       ├──── Fase 1: /search (Meilisearch cache, <10ms)
       │         │
       │         ├── Resultados suficientes? (≥10 de ≥2 fontes)
       │         │     SIM → retorna IMEDIATO + warm cache em background
       │         │     NAO → vai para Fase 2
       │         │
       ├──── Fase 2: /indexers/{nome} (scraping live, 2-12s)
       │         │
       │         ├── torrent-dos-filmes  (suporta IMDB, 2-3s)
       │         ├── starck-filmes       (so titulo, 1-2s)
       │         ├── vaca_torrent        (so titulo, 2-5s)
       │         └── rede_torrent        (so titulo, 1-3s)
       │
       ├──── Filtro de relevancia
       │         ├── Title matching (normalizado, sem acentos)
       │         ├── IMDB matching (quando disponivel)
       │         ├── Season/Episode filtering
       │         ├── Year validation (filmes)
       │         └── Deduplicacao por info_hash
       │
       ├──── Debrid cache check
       │         ├── TorBox: /api/torrents/checkcached
       │         └── Real-Debrid: /torrents/instantAvailability
       │
       └──── Retorna streams formatados para Stremio
```

### Pipeline de busca em detalhe

1. **Parse do ID** — Extrai `imdbId`, `season`, `episode` do ID Stremio (ex: `tt1190634:4:1`)
2. **Resolucao de metadados** — Consulta Cinemeta para titulo EN + TMDB para titulo PT-BR
3. **Geracao de queries** — Monta ate 12 variantes de busca:
   - Titulo puro (mais universal, vem primeiro)
   - `{titulo} S{xx}E{yy}` (notacao padrao)
   - `{titulo} temporada {n}`
   - `{titulo_pt} S{xx}E{yy}` (titulo localizado)
   - IMDB ID (so para indexers que suportam)
4. **Busca em 2 fases**:
   - **Fase 1**: `/search` no Meilisearch (cache) — responde em <10ms se o titulo ja foi buscado antes
   - **Fase 2**: `/indexers/{nome}` (scraping live) — so acionado se a Fase 1 retornou poucos resultados
   - **Background warming**: Mesmo quando a Fase 1 retorna rapido, os `/indexers` sao consultados em background (fire-and-forget) para manter o cache atualizado
5. **Filtro de relevancia** — `isRelevantTorrent()` descarta resultados com titulo errado, temporada/episodio divergente, ou ano incompativel
6. **Ranking** — Ordena por qualidade (1080p > 720p), idioma (Dual > PT > EN), e seeds
7. **Debrid check** — Verifica cache no TorBox/RD para indicar ⚡ ou ⏳
8. **Resposta** — Retorna `SourceStream[]` formatados com titulo, qualidade, idioma e badges

### Mapa de indexers

| Indexer | Status | Velocidade (Pós-Cache) | Notas |
|---------|:----:|:----------:|-------|
| `torrent-dos-filmes` | 🟢 Ativo | < 10ms | Excelente para dual-áudio |
| `starck-filmes` | 🟢 Ativo | < 10ms | Resultados precisos e lançamentos |
| `vaca_torrent` | 🟢 Ativo | < 10ms | Forte em conteúdo exclusivo |
| `rede_torrent` | 🟢 Ativo | < 10ms | Bom equilíbrio geral |
| `bludv` | 🟢 Ativo | < 10ms | Mestre em qualidade 4K / x265 |
| `comando_torrents` | 🟢 Ativo | < 10ms | O clássico brasileiro |

> Os indexers que nao suportam IMDB recebem queries com titulo textual (EN e PT-BR) em vez de `ttXXXXXXX`. A resolucao PT-BR via TMDB e essencial para maximizar hits nesses indexers.

> Fontes extras de addon podem ser adicionadas via `STREMIO_ADDON_SOURCES` em JSON, sem alterar o código. Se `STREMIO_ISSUER` e `STREMIO_SIGNATURE` forem definidos, o manifesto expõe essa assinatura; caso contrario, o addon continua funcionando sem esse bloco.

---

## Como funciona hoje (resumo atualizado)

- O servidor expõe endpoints Stremio compatíveis: `/manifest.json` e `/stream/:type/:id.json`.
- O fluxo prioriza um fast-path de cache (`/search` no torrent-indexer) e recorre ao slow-path (`/indexers/{name}`) apenas quando necessário.
- Metadados são resolvidos via Cinemeta e enriquecidos com títulos localizados do TMDB (quando disponível) para melhorar recall em indexers BR.
- A inferência de idioma combina campos estruturados (`stream.context`), `description`, `fileName` e `title` para detectar corretamente `Dual Audio` e marcar `Portuguese + English` quando apropriado.
- Restrições e timeouts são configuráveis via variaveis de ambiente (ver seção Configuracao). O comportamento padrão tenta retornar resultados rápidos mas continua warming em background para popular o cache.

## Testes de tempo (midpatch)

Inclui um utilitário `tests/midpatch-timings.mjs` que:

- Verifica se o servidor local está ativo (`/health`) e inicia `dist/server.js` se necessario.
- Faz requisições ao endpoint `/stream/:type/:id.json` para uma lista de filmes e series (configuravel) com query param `?_nocache=timestamp` para evitar respostas em cache.
- Mede tempo total da requisição, tempo até headers, numero de streams retornados e tamanho do payload.
- Salva um JSON agregando resultados em `test-artifacts/midpatch-timings-<timestamp>.json`.

- Nota: quando executado com `fresh=1` o midfetch aplica heurísticas de desempenho (ex.: pode excluir temporariamente indexers pesados como `bludv` e remover anos dos títulos) para reduzir latência do cold-path. Essas otimizações são aplicadas apenas em `fresh=1` e não alteram o comportamento padrão do slow-path.

Como rodar (local):

```bash
# construa o projeto
npm run build

# execute o script de timing (vai iniciar o servidor se necessario)
npm run test:midpatch
```

Ao terminar, confira `test-artifacts/` para o arquivo de resultados. Use a variavel de ambiente `MIDPATCH_IDS` para passar uma lista CSV de IDs (ex: `MIDPATCH_IDS="tt0111161:movie,tt0903747:series" npm run test:midpatch`).
O teste chama o endpoint com `fresh=1` para ignorar caches locais e usa `MIDPATCH_MAX_MS` para falhar quando o retorno frio demora mais que o budget esperado (padrao: `15000`).

## Torrent Indexer

> **Creditos**: Este projeto depende do [torrent-indexer](https://github.com/felipemarinho97/torrent-indexer), um projeto open source criado por [@felipemarinho97](https://github.com/felipemarinho97). Ele indexa os principais sites brasileiros de torrents.

<p align="center">
  <a href="https://github.com/felipemarinho97/torrent-indexer"><img src="https://img.shields.io/github/stars/felipemarinho97/torrent-indexer?style=for-the-badge&color=f59e0b&labelColor=111118&label=torrent-indexer%20stars" alt="torrent-indexer stars"></a>
</p>

O GuIndex usa uma **instancia self-hosted** do torrent-indexer rodando em VPS propria com Docker, junto com Meilisearch (cache de busca), Redis (cache de sessoes), e FlareSolverr (bypass Cloudflare).

---

## Scripts de Automação (Novo!)

O GuIndex v2.2.0 introduziu scripts para popular e manter o banco de dados do Meilisearch "quente" automaticamente:

- `npm run populate:latest` — Varre os lançamentos recentes da página principal de todos os trackers. (Recomendado rodar a cada 8h).
- `npm run populate:tmdb` — Varre as tendências atuais de séries e filmes no TMDB e pré-busca tudo. (Recomendado rodar a cada 24h).
- `npm run populate:tmdb:all` — Faz uma varredura extrema de até 500 páginas do TMDB. Ideal para o primeiro deploy.

---

---

## Infraestrutura Self-Hosted

### Componentes

```
VPS (DigitalOcean 4vCPU / 8GB)
├── torrent-indexer     (porta 8090 → 7006)  — scraper principal
├── Meilisearch         (interno)            — cache de busca fulltext
├── Redis               (interno)            — cache de sessoes/resultados
└── FlareSolverr        (interno)            — bypass Cloudflare via Chrome headless
```

### Docker Compose de referencia

```yaml
services:
  torrent-indexer:
    image: ghcr.io/felipemarinho97/torrent-indexer:latest
    container_name: torrent-indexer
    restart: unless-stopped
    ports:
      - '8090:7006'
    environment:
      - REQUEST_TIMEOUT_MILLISECONDS=8000
      - FLARESOLVERR_ADDRESS=http://indexer-flaresolverr:8191
      - FLARESOLVERR_TIMEOUT_SECONDS=30
      - FLARESOLVERR_POOL_SIZE=4
      - MEILISEARCH_ADDRESS=http://indexer-meilisearch:7700
      - MEILISEARCH_KEY=SUA_CHAVE_MEILI
      - REDIS_HOST=indexer-redis
      - LOG_LEVEL=1
      - LOG_FORMAT=json
      - LONG_LIVED_CACHE_EXPIRATION=14d
      - SHORT_LIVED_CACHE_EXPIRATION=2h
      - FALLBACK_TITLE_ENABLED=true
    deploy:
      resources:
        limits:
          memory: 256M
    networks:
      - indexer-net

  indexer-flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    container_name: indexer-flaresolverr
    restart: unless-stopped
    environment:
      - LOG_LEVEL=warn
      - CAPTCHA_SOLVER=none
      - TZ=America/Sao_Paulo
    deploy:
      resources:
        limits:
          memory: 1G
    networks:
      - indexer-net

  indexer-meilisearch:
    image: getmeili/meilisearch:latest
    container_name: indexer-meilisearch
    restart: unless-stopped
    environment:
      - MEILI_MASTER_KEY=SUA_CHAVE_MEILI
      - MEILI_ENV=production
    volumes:
      - meili_data:/meili_data
    deploy:
      resources:
        limits:
          memory: 512M
    networks:
      - indexer-net

  indexer-redis:
    image: redis:7-alpine
    container_name: indexer-redis
    restart: unless-stopped
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    deploy:
      resources:
        limits:
          memory: 384M
    networks:
      - indexer-net

volumes:
  meili_data:
  redis_data:

networks:
  indexer-net:
    name: indexer-net
```

### Otimizacoes aplicadas

| Parametro | Valor | Motivo |
|-----------|-------|--------|
| `REQUEST_TIMEOUT_MILLISECONDS` | `8000` | Backend aborta scraping apos 8s e retorna o que ja tem |
| `FLARESOLVERR_POOL_SIZE` | `4` | 4 sessoes Chrome em vez de 12 (economiza ~1.5GB RAM) |
| `FLARESOLVERR_TIMEOUT_SECONDS` | `30` | Nao trava em sites lentos |
| Redis `maxmemory` | `256mb` | LRU eviction impede crescimento indefinido |
| Memory limits | Por container | Impede que um servico derrube os outros |

Consulte o [README do torrent-indexer](https://github.com/felipemarinho97/torrent-indexer) para mais detalhes sobre os sites suportados.

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

> Em producao, defina `BASE_URL` com o dominio publico da sua instancia.

---

## Configuracao

### Variaveis de Ambiente

#### Servidor

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `PORT` | `7000` | Porta do servidor |
| `BASE_URL` | — | **(obrigatoria em prod)** URL publica da instancia |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

#### Torrent Indexer — conexao

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `TORRENT_INDEXER_URL` | `http://127.0.0.1:8090` | URL do torrent-indexer local (sobrescreva em deploy) |
| `TORRENT_INDEXER_ENABLE_FALLBACK` | `true` | Ativa scraping live nos `/indexers/{nome}` alem do cache `/search` |

#### Fontes de addon (opcional)

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `STREMIO_ADDON_SOURCES` | `[]` | Lista JSON de addons extras no formato `[{"name":"Name","url":"https://example.com/manifest.json"}]` (opcional) |

#### Torrent Indexer — busca

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `TORRENT_INDEXER_MAX_QUERY_TIME_MS` | `18000` | Orcamento maximo de tempo total por busca de streams (ms) |
| `TORRENT_INDEXER_FALLBACK_TIMEOUT_MS` | `12000` | Timeout por request individual ao indexer (ms) |
| `TORRENT_INDEXER_FALLBACK_CONCURRENCY` | `5` | Quantos indexers consultar em paralelo |
| `TORRENT_INDEXER_FALLBACK_MAX_INDEXERS` | `0` | Maximo de indexers (0 = todos ativos) |
| `TORRENT_INDEXER_FALLBACK_PER_INDEXER_LIMIT` | `0` | Limite de resultados por indexer quando consultando `/indexers/{name}` (0 = sem limite). **OBS**: o endpoint `/indexers/all` não deve receber `limit`; o controle por-indexer é aplicado nas chamadas individuais do slow-path. |
| `TORRENT_INDEXER_TARGET_STREAMS` | `12` | Quantidade alvo para encerrar cedo com diversidade |
| `TORRENT_INDEXER_MAX_DYNAMIC_QUERIES` | `10` | Limite de queries dinamicas para melhorar recall |
| `TORRENT_INDEXER_MAX_STREAMS_PER_SOURCE` | `50` | Maximo de streams por fonte (evita monopolio) |

#### Torrent Indexer — busca hibrida (2 fases)

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `TORRENT_INDEXER_HYBRID_MIN_RESULTS` | `2` | Minimo de resultados do `/search` para pular a Fase 2 |
| `TORRENT_INDEXER_HYBRID_MIN_INDEXERS` | `2` | Minimo de fontes distintas no `/search` para pular a Fase 2 |

#### Torrent Indexer — saude de fontes

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `TORRENT_INDEXER_DISABLED_INDEXERS` | — | Lista CSV de indexers desativados |
| `TORRENT_INDEXER_FAILURE_THRESHOLD` | `2` | Falhas consecutivas antes de cooldown |
| `TORRENT_INDEXER_FAILURE_COOLDOWN_MS` | `900000` | Tempo de cooldown apos falhas (15min) |

### 🌍 Fila Global de Raspagem (Global Queue)

| Variavel | Padrao | Descricao |
|---|---|---|
| `TORRENT_INDEXER_GLOBAL_QUEUE_CONCURRENCY` | `1` | Quantidade de raspagens em segundo plano simultaneas |
| `TORRENT_INDEXER_GLOBAL_QUEUE_DELAY_MS` | `1500` | Tempo de descanso entre raspagens (ms) |

#### Torrent Indexer — cache

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `TORRENT_INDEXER_SEARCH_CACHE_TTL_MS` | `120000` | TTL do cache de busca em memoria (2min) |
| `TORRENT_INDEXER_INDEXERS_CACHE_TTL_MS` | `600000` | TTL do cache da lista de indexers (10min) |
| `TORRENT_INDEXER_LOCALIZED_TITLE_CACHE_TTL_MS` | `604800000` | TTL do cache TMDB (7 dias) |

#### TMDB (resolucao de titulos PT-BR)

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `TMDB_API_KEY` | — | Chave da API TMDB (v3) |
| `TMDB_PAGES` | `5` | Quantidade de páginas para rodar no `npm run populate:tmdb` |
| `TORRENT_INDEXER_TMDB_TIMEOUT_MS` | `5000` | Timeout de consulta ao TMDB |

> A chave TMDB e **altamente recomendada**. Sem ela, indexers como `starck-filmes` e `vaca_torrent` (que nao suportam IMDB) terao cobertura muito menor para titulos que diferem entre EN e PT-BR (ex: "Wednesday" → "Wandinha", "Inside Out 2" → "Divertida Mente 2").

#### Debrid

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `TORBOX_WAIT_VIDEO_URL` | — | Video de espera enquanto TorBox processa |
| `TORBOX_STREAM_LIMIT` | `15` | Limite de streams TorBox |

### Perfil recomendado para VPS

```bash
# Conexao (aponte para sua instancia self-hosted)
TORRENT_INDEXER_URL=http://127.0.0.1:8090

# Exemplo para sua VPS/DigitalOcean
# TORRENT_INDEXER_URL=http://guindex.duckdns.org:8090

# Busca e fallback
TORRENT_INDEXER_ENABLE_FALLBACK=true
TORRENT_INDEXER_FALLBACK_MAX_INDEXERS=0
TORRENT_INDEXER_FALLBACK_PER_INDEXER_LIMIT=0
TORRENT_INDEXER_FALLBACK_CONCURRENCY=5
TORRENT_INDEXER_FALLBACK_TIMEOUT_MS=12000
TORRENT_INDEXER_MAX_QUERY_TIME_MS=18000

# Resultados
TORRENT_INDEXER_TARGET_STREAMS=12
TORRENT_INDEXER_MAX_DYNAMIC_QUERIES=10
TORRENT_INDEXER_MAX_STREAMS_PER_SOURCE=50

# Busca hibrida (Meilisearch fast-path)
TORRENT_INDEXER_HYBRID_MIN_RESULTS=2
TORRENT_INDEXER_HYBRID_MIN_INDEXERS=2

# Estabilidade e Resiliência
TORRENT_INDEXER_DISABLED_INDEXERS=
TORRENT_INDEXER_FAILURE_THRESHOLD=2
TORRENT_INDEXER_FAILURE_COOLDOWN_MS=900000

# Fila Global de Fundo
TORRENT_INDEXER_GLOBAL_QUEUE_CONCURRENCY=1
TORRENT_INDEXER_GLOBAL_QUEUE_DELAY_MS=1500

# Cache
TORRENT_INDEXER_SEARCH_CACHE_TTL_MS=120000
TORRENT_INDEXER_INDEXERS_CACHE_TTL_MS=600000
TORRENT_INDEXER_LOCALIZED_TITLE_CACHE_TTL_MS=604800000

# TMDB (essencial para indexers que nao suportam IMDB)
TMDB_API_KEY=SUA_CHAVE_TMDB
```

### Uso com Stremio

Acesse a pagina de configuracao da sua instancia e siga as instrucoes. A URL do manifest segue o formato:

```
https://seu-dominio.com/torbox/SEU_TOKEN/manifest.json
```

### Uso com AIOStreams

O GuIndex e compativel com o [AIOStreams](https://github.com/Viren070/AIOStreams). Adicione como addon customizado usando a URL do manifest.

O arquivo `aiostreams-config-exemplo.json` contem uma configuracao de referencia para usuarios brasileiros com TorBox, incluindo addons BR populares, formatacao customizada com emojis, filtros de qualidade e ordenacao otimizada.

---

## Addons Externos

O GuIndex agrega streams de **outros addons Stremio** que nao possuem suporte nativo a debrid. As fontes extras sao configuradas via `STREMIO_ADDON_SOURCES` em JSON. Se a variavel nao estiver definida, o addon usa o default `Mico-Leão Dublado`.

```bash
STREMIO_ADDON_SOURCES='[{"name":"Addon BR 1","url":"https://addon1.com"},{"name":"Addon BR 2","url":"https://addon2.com"}]'
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
│   └── sources.ts                  # Fontes de streams (indexer + addons)
├── controllers/
│   ├── config-controller.ts        # Manifest + pagina de configuracao
│   └── stream-controller.ts        # Streams + resolucao debrid
├── models/                         # Tipos TypeScript
├── routes/
│   └── routes.ts                   # Rotas HTTP
└── services/
    ├── torrent-indexer-provider.ts  # Provider principal (busca 2-fases, filtro, ranking)
    ├── realdebrid-service.ts       # Real-Debrid API + file selection
    ├── torbox-service.ts           # TorBox API + file selection
    ├── torbox-client.ts            # Cliente TorBox
    ├── stremio-addon-provider.ts   # Provider para addons externos
    ├── stream-service.ts           # Processamento de streams
    ├── source-service.ts           # Orquestrador de fontes
    ├── config-service.ts           # Config
    └── base-source-provider.ts     # Interface base
```

---

## Contribuindo

Contribuicoes sao muito bem-vindas!

1. Fork o repositorio
2. Crie uma branch: `git checkout -b minha-melhoria`
3. Commit: `git commit -m 'Melhoria X'`
4. Push: `git push origin minha-melhoria`
5. Abra um Pull Request

### Ideias

- Suporte a AllDebrid, Premiumize
- Catalogos nativos
- Interface de admin
- Testes automatizados
- Mais padroes de nomes de releases BR

---

## Apoie o Projeto

- **Dar uma estrela** neste repositorio e no [torrent-indexer](https://github.com/felipemarinho97/torrent-indexer)
- **Reportar bugs** nas [issues](https://github.com/GuickerZ/guindex/issues)
- **Contribuir com codigo** via Pull Requests
- **Compartilhar** com outros usuarios brasileiros do Stremio

<p align="center">
  <a href="https://github.com/GuickerZ/guindex/stargazers"><img src="https://img.shields.io/github/stars/GuickerZ/guindex?style=for-the-badge&color=10b981&labelColor=111118&label=GuIndex" alt="Star GuIndex"></a>
  <a href="https://github.com/felipemarinho97/torrent-indexer/stargazers"><img src="https://img.shields.io/github/stars/felipemarinho97/torrent-indexer?style=for-the-badge&color=f59e0b&labelColor=111118&label=torrent-indexer" alt="Star torrent-indexer"></a>
</p>

---

## Agradecimentos

- [@felipemarinho97](https://github.com/felipemarinho97) pelo [torrent-indexer](https://github.com/felipemarinho97/torrent-indexer) — a base de tudo
- [AIOStreams](https://github.com/Viren070/AIOStreams) pela engine de agregacao
- Comunidade Stremio brasileira

---

## Licenca

MIT — use como quiser.

<p align="center">
  <sub>Feito por <a href="https://github.com/GuickerZ">@GuickerZ</a></sub>
</p>
