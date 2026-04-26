# 🇧🇷 GuIndex

**Addon Stremio para conteúdo brasileiro** — transforma resultados do [torrent-indexer](https://github.com/felipemarinho97/torrent-indexer) em streams diretos via Real-Debrid ou TorBox.

> Este projeto é open source e foi criado por necessidade pessoal. Atualizarei enquanto eu tiver necessidade no meu próprio uso, mas peço ajuda da comunidade para contribuir e melhorar o projeto.

---

## 📋 O que é?

O **GuIndex** é um addon para o [Stremio](https://www.stremio.com/) que funciona como uma ponte entre o indexador de torrents brasileiros ([torrent-indexer](https://github.com/felipemarinho97/torrent-indexer)) e serviços de debrid (Real-Debrid / TorBox).

### Como funciona

```
Stremio → GuIndex → torrent-indexer → sites brasileiros de torrent
                 ↓
           Real-Debrid / TorBox → Stream direto (sem P2P)
```

1. O Stremio pede streams para um filme/série
2. O GuIndex consulta o [torrent-indexer](https://github.com/felipemarinho97/torrent-indexer) que indexa sites brasileiros de torrents
3. Os resultados são processados com matching inteligente de temporada/episódio
4. Os magnets são resolvidos pelo seu serviço de debrid (RD ou TB) em links diretos
5. Você assiste com qualidade e sem depender de seeders

### Funcionalidades

- 🎬 **Filmes e Séries** — suporte completo a ambos os tipos
- 🇧🇷 **Otimizado para BR** — regex específico para padrões de releases brasileiros (×, Temporada, Dublado, etc.)
- ⚡ **Real-Debrid + TorBox** — suporte a ambos os provedores de debrid
- 📦 **Season Packs** — seleção inteligente do episódio correto dentro de packs
- 🧹 **Filtro de lixo** — remove automaticamente amostras, propagandas, arquivos pequenos
- 🔌 **Addons externos** — permite agregar streams de outros addons Stremio que não suportam debrid
- 🐳 **Docker** — pronto para self-host via Docker
- 📡 **AIOStreams** — compatível com o engine [AIOStreams](https://github.com/Viren070/AIOStreams)

---

## 🚀 Instalação

### Opção 1: Usar instância pública

Se alguém estiver hospedando uma instância pública, basta acessar a URL de configuração no navegador e seguir as instruções.

### Opção 2: Self-host com Docker (recomendado)

```bash
git clone https://github.com/GuickerZ/guindex.git
cd guindex
cp .env.example .env
# Edite .env com sua BASE_URL
docker compose up -d
```

### Opção 3: Self-host manual (Node.js)

```bash
git clone https://github.com/GuickerZ/guindex.git
cd guindex
npm install
cp .env.example .env
# Edite .env com sua BASE_URL
npm run build
npm start
```

### Opção 4: Deploy na nuvem

O projeto inclui configs prontos para:

| Plataforma | Arquivo |
|-----------|---------|
| **Vercel** | `vercel.json` |
| **Render** | `render.yaml` |
| **Docker** | `Dockerfile` + `docker-compose.yml` |

> ⚠️ **Importante:** Defina a variável `BASE_URL` com o domínio público da sua instância.

---

## ⚙️ Configuração

### Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|----------|:-----------:|-----------|
| `PORT` | Não | Porta do servidor (padrão: `7000`) |
| `BASE_URL` | **Sim** (prod) | URL pública da sua instância |
| `LOG_LEVEL` | Não | Nível de log: `debug`, `info`, `warn`, `error` |
| `TORRENT_INDEXER_URL` | Não | URL do torrent-indexer (padrão: `https://torrent-indexer.darklyn.org`) |
| `REALDEBRID_TOKEN` | Não | Token fixo do Real-Debrid (alternativa à query string) |
| `TORBOX_TOKEN` | Não | Token fixo do TorBox (alternativa à query string) |
| `TORBOX_WAIT_VIDEO_URL` | Não | URL do vídeo de espera enquanto o TorBox processa |
| `TORBOX_STREAM_LIMIT` | Não | Limite de streams do TorBox (padrão: `15`) |

### Instalação no Stremio

Após o deploy, acesse a raiz da sua instância (`https://seu-dominio.com/`) e siga as instruções na página de configuração.

A URL do manifest segue o formato:
```
https://seu-dominio.com/manifest.json?debridProvider=torbox&torboxToken=SEU_TOKEN
```

### Uso com AIOStreams

O GuIndex é compatível com o [AIOStreams](https://github.com/Viren070/AIOStreams). Adicione como addon customizado usando a URL do manifest acima.

Um exemplo de configuração AIOStreams está disponível em `aiostreams-config-exemplo.json` — este é um template pessoal, adapte ao seu uso.

---

## 🔧 Torrent Indexer

Este projeto depende do **[torrent-indexer](https://github.com/felipemarinho97/torrent-indexer)**, um projeto open source de [@felipemarinho97](https://github.com/felipemarinho97) que indexa sites brasileiros de torrents.

**Recomendamos fortemente que você faça self-host do torrent-indexer** para maior controle e menor latência:

```bash
# Docker
docker run -p 8080:8080 ghcr.io/felipemarinho97/torrent-indexer:latest

# Depois configure no GuIndex:
TORRENT_INDEXER_URL=http://localhost:8080
```

A instância pública `https://torrent-indexer.darklyn.org` pode ficar indisponível ou lenta. Self-host garante estabilidade.

---

## 🔌 Addons Externos

O GuIndex também pode agregar streams de **outros addons Stremio** que não possuem suporte nativo a Real-Debrid ou TorBox. Configure na lista de sources em `src/config/sources.ts`:

```typescript
export const SOURCES: BaseSourceProvider[] = [
  new TorrentIndexerProvider('GuIndex', TORRENT_INDEXER_BASE_URL),
  new StremioAddonProvider('MeuAddon', 'https://url-do-addon.com'),
  // Adicione quantos quiser
];
```

Isso permite que magnets de qualquer addon sejam resolvidos via debrid.

---

## 🏗️ Stack Técnica

| Tecnologia | Uso |
|-----------|-----|
| **TypeScript** | Linguagem principal |
| **Fastify** | Servidor HTTP |
| **Node.js 18+** | Runtime |
| **Undici** | Cliente HTTP para APIs de debrid |
| **Pino** | Logger estruturado |
| **Zod** | Validação de schemas |
| **Docker** | Containerização |

### Estrutura do Projeto

```
src/
├── server.ts                    # Ponto de entrada
├── config/
│   └── sources.ts               # Fontes de streams configuradas
├── controllers/
│   ├── config-controller.ts     # Manifest + página de configuração
│   └── stream-controller.ts     # Lógica de streams + resolução debrid
├── models/
│   ├── config-model.ts          # Tipos de configuração
│   ├── debrid-model.ts          # Tipos debrid
│   ├── realdebrid-model.ts      # Tipos Real-Debrid
│   ├── source-model.ts          # Tipos de stream/source
│   └── stream-model.ts          # Tipos de resposta Stremio
├── routes/
│   └── routes.ts                # Rotas HTTP
└── services/
    ├── base-source-provider.ts  # Interface base para providers
    ├── config-service.ts        # Carregamento de config
    ├── realdebrid-service.ts    # Real-Debrid API + file selection
    ├── source-service.ts        # Orquestrador de sources
    ├── stream-service.ts        # Processamento e formatação de streams
    ├── stremio-addon-provider.ts# Provider para addons Stremio externos
    ├── torbox-client.ts         # Cliente TorBox API
    ├── torbox-service.ts        # TorBox resolve + file selection
    └── torrent-indexer-provider.ts  # Provider principal (torrent-indexer)
```

---

## 🤝 Contribuindo

Contribuições são muito bem-vindas! Este projeto foi feito por uma pessoa e precisa da comunidade.

1. Faça fork do repositório
2. Crie uma branch: `git checkout -b minha-melhoria`
3. Faça commit: `git commit -m 'Melhoria X'`
4. Push: `git push origin minha-melhoria`
5. Abra um Pull Request

### Ideias para contribuições

- Adicionar mais padrões de nomes de releases brasileiros
- Suporte a mais provedores de debrid (AllDebrid, Premiumize, etc.)
- Testes automatizados
- Catálogos
- Interface web de administração

---

## 📄 Licença

MIT — use como quiser.

---

## 🙏 Agradecimentos

- [@felipemarinho97](https://github.com/felipemarinho97) pelo [torrent-indexer](https://github.com/felipemarinho97/torrent-indexer)
- [AIOStreams](https://github.com/Viren070/AIOStreams) pela engine de aggregação
- Comunidade Stremio
