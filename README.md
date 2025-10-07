# Brazuca RD - Stremio Addon

A Stremio addon that acts as a proxy for torrent-based addons, processing magnet links through Real-Debrid for direct streaming.

## 🎯 Features

- **Real-Debrid Integration**: Automatically processes magnet links through Real-Debrid
- **Multiple Sources**: Supports multiple Stremio addon sources (starting with Brazuca Torrents)
- **Deferred Processing**: Only processes torrents when user actually plays the stream
- **Placeholder Video**: Shows downloading status while Real-Debrid processes torrents
- **Clean Architecture**: Well-organized codebase with models, services, controllers, and routes
- **Hot Reload**: Development server with automatic reloading
- **Production Ready**: Configurable base URL for cloud deployment

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (recommended)
- Real-Debrid account and API token
- Stremio client

### Installation

1. **Clone and setup**:
   ```bash
   git clone https://github.com/andremoreirasmo/brazuca-rd.git
   cd brazuca-rd
   npm install
   ```

2. **Configure environment**:
   ```bash
   # Copy example configuration
   cp .envrc.example .envrc
   
   # Edit with your settings
   nano .envrc
   
   # Load environment (if using direnv)
   direnv allow
   ```

3. **Environment Variables**:
   ```bash
   # Server Configuration
   export PORT=7000
   export LOG_LEVEL=info
   
   # Production URL (optional)
   export BASE_URL=https://your-domain.com
   ```

### Development

```bash
# Start development server with hot reload
npm run dev

# Build and start production
npm run build && npm start
```

### Usage in Stremio

1. **Install addon**: `http://localhost:7000/manifest.json`
2. **Configure**: Pass Real-Debrid token via:
   - Query parameter: `?realdebridToken=YOUR_TOKEN`
   - Header: `x-rd-token: YOUR_TOKEN`

## 🏗️ Architecture

### Project Structure

```
src/
├── models/           # Data models and interfaces
├── services/         # Business logic services
├── controllers/      # Request handling controllers
├── routes/          # API route definitions
├── config/          # Configuration files
└── server.ts        # Application entry point
```

### Key Components

- **ConfigService**: Manages application configuration
- **SourceService**: Orchestrates multiple source providers
- **RealDebridService**: Handles Real-Debrid API interactions
- **StreamController**: Processes stream requests
- **ConfigController**: Manages addon manifest and configuration

### Source Providers

The addon uses a flexible provider system:

- **StremioAddonProvider**: Fetches streams from other Stremio addons
- **BaseSourceProvider**: Abstract base class for all providers
- **Configurable Sources**: Easy to add new sources in `config/sources.ts`

## 🔧 Configuration

### Adding New Sources

Edit `src/config/sources.ts`:

```typescript
import { StremioAddonProvider } from '../services/stremio-addon-provider.js';

export const SOURCES = [
  new StremioAddonProvider('Brazuca', 'https://94c8cb9f702d-brazuca-torrents.baby-beamup.club'),
  new StremioAddonProvider('NewSource', 'https://new-source-url.com'),
];
```

### Real-Debrid Token

The addon requires Real-Debrid tokens per request. Users can provide tokens via:

1. **Query Parameter**: `?realdebridToken=TOKEN`
2. **Header**: `x-rd-token: TOKEN`
3. **Stremio Configuration**: Token is passed through Stremio's addon system

## 🌐 Deployment

### Cloud Deployment Ready ✅

The addon is production-ready with:

- **Environment Configuration**: Uses `.envrc` for environment variables
- **Dynamic Base URL**: Configurable `BASE_URL` for production
- **Static File Serving**: Serves placeholder videos and assets
- **Error Handling**: Comprehensive error handling and logging
- **CORS Support**: Cross-origin resource sharing enabled

### Deployment Steps

1. **Set Production URL**:
   ```bash
   export BASE_URL=https://your-domain.com
   ```

2. **Build Application**:
   ```bash
   npm run build
   ```

3. **Deploy**:
   - Upload `dist/` folder to your server
   - Install dependencies: `npm install --production`
   - Start: `npm start`

### Recommended Platforms

- **Vercel**: Easy deployment with automatic builds
- **Railway**: Simple Node.js deployment
- **DigitalOcean App Platform**: Managed hosting
- **AWS Lambda**: Serverless deployment
- **Docker**: Containerized deployment

### Docker Support

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
COPY public/ ./public/
EXPOSE 7000
CMD ["npm", "start"]
```

## 📝 API Endpoints

- `GET /manifest.json` - Addon manifest
- `GET /configure` - Configuration page
- `GET /stream/:type/:id.json` - Stream discovery
- `GET /resolve/:token/:magnet` - Real-Debrid processing
- `GET /placeholder/downloading.mp4` - Placeholder video

## 🔍 Development

### Scripts

- `npm run dev` - Development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint

### Hot Reload

The development server automatically reloads when files change, making development efficient.

### Adding Features

1. **New Source Provider**: Extend `BaseSourceProvider`
2. **New Service**: Add to `services/` directory
3. **New Route**: Add to `routes/routes.ts`
4. **New Model**: Add to `models/` directory

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🙏 Credits

- **Brazuca Torrents**: Original Stremio addon that inspired this project
- **Real-Debrid**: Premium debrid service for torrent processing
- **Stremio**: Media center platform

## 🆘 Support

For issues and questions:

1. Check the [Issues](https://github.com/andremoreirasmo/brazuca-rd/issues) page
2. Create a new issue with detailed information
3. Include logs and configuration details

---

**Note**: This addon requires a Real-Debrid subscription to function. Users must provide their own Real-Debrid API tokens.