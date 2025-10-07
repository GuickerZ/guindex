# Deployment Guide

This guide covers various deployment options for the Brazuca RD Stremio Addon.

## 🚀 Quick Deploy Options

### 1. Railway (Recommended)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/your-template)

1. **Connect Repository**: Link your GitHub repository
2. **Set Environment Variables**:
   - `BASE_URL`: Your Railway app URL (auto-generated)
   - `PORT`: 7000 (auto-set)
3. **Deploy**: Railway automatically builds and deploys

### 2. Vercel

1. **Install Vercel CLI**: `npm i -g vercel`
2. **Deploy**: `vercel --prod`
3. **Set Environment Variables** in Vercel dashboard:
   - `BASE_URL`: Your Vercel domain

### 3. DigitalOcean App Platform

1. **Create App**: Connect GitHub repository
2. **Configure Build**:
   - Build Command: `npm run build`
   - Run Command: `npm start`
3. **Set Environment Variables**:
   - `BASE_URL`: Your app domain

## 🐳 Docker Deployment

### Local Docker

```bash
# Build and run
docker build -t brazuca-rd .
docker run -p 7000:7000 -e BASE_URL=http://localhost:7000 brazuca-rd

# Or use docker-compose
docker-compose up -d
```

### Docker Hub

```bash
# Build and push
docker build -t yourusername/brazuca-rd .
docker push yourusername/brazuca-rd

# Deploy anywhere
docker run -p 7000:7000 -e BASE_URL=https://your-domain.com yourusername/brazuca-rd
```

## ☁️ Cloud Platform Specific

### AWS Lambda (Serverless)

1. **Install Serverless Framework**: `npm i -g serverless`
2. **Create `serverless.yml`**:
   ```yaml
   service: brazuca-rd
   provider:
     name: aws
     runtime: nodejs18.x
     region: us-east-1
   functions:
     app:
       handler: dist/server.handler
       events:
         - http:
             path: /{proxy+}
             method: ANY
   ```
3. **Deploy**: `serverless deploy`

### Google Cloud Run

1. **Build**: `gcloud builds submit --tag gcr.io/PROJECT-ID/brazuca-rd`
2. **Deploy**: `gcloud run deploy --image gcr.io/PROJECT-ID/brazuca-rd --platform managed`

### Azure Container Instances

```bash
# Build and push to Azure Container Registry
az acr build --registry myregistry --image brazuca-rd .

# Deploy
az container create --resource-group myResourceGroup --name brazuca-rd --image myregistry.azurecr.io/brazuca-rd:latest --ports 7000
```

## 🔧 Environment Configuration

### Required Variables

```bash
# Server Configuration
PORT=7000
LOG_LEVEL=info

# Production URL (set by platform or manually)
BASE_URL=https://your-domain.com
```

### Optional Variables

```bash
# Advanced Configuration
NODE_ENV=production
```

## 📊 Monitoring & Health Checks

### Health Check Endpoint

The addon includes a health check at `/manifest.json`:

```bash
curl -f http://your-domain.com/manifest.json || exit 1
```

### Logging

- **Development**: Console output with colors
- **Production**: Structured JSON logs
- **Levels**: `error`, `warn`, `info`, `debug`

### Monitoring

Recommended monitoring tools:
- **Uptime Robot**: HTTP monitoring
- **DataDog**: Application monitoring
- **New Relic**: Performance monitoring
- **Sentry**: Error tracking

## 🔒 Security Considerations

### HTTPS Only

Always use HTTPS in production:

```bash
# Set BASE_URL with HTTPS
export BASE_URL=https://your-domain.com
```

### CORS Configuration

The addon includes CORS headers for cross-origin requests.

### Rate Limiting

Consider adding rate limiting for production:

```javascript
// Example with @fastify/rate-limit
fastify.register(import('@fastify/rate-limit'), {
  max: 100,
  timeWindow: '1 minute'
});
```

## 🚨 Troubleshooting

### Common Issues

1. **Port Already in Use**:
   ```bash
   # Change port
   export PORT=8000
   ```

2. **Build Failures**:
   ```bash
   # Clear cache and rebuild
   rm -rf node_modules dist
   npm install
   npm run build
   ```

3. **Environment Variables**:
   ```bash
   # Check variables
   env | grep -E "(PORT|LOG_LEVEL|BASE_URL)"
   ```

### Logs

```bash
# View logs
docker logs container-name

# Follow logs
docker logs -f container-name
```

## 📈 Performance Optimization

### Production Optimizations

1. **Enable Compression**:
   ```javascript
   fastify.register(import('@fastify/compress'));
   ```

2. **Cache Headers**:
   ```javascript
   reply.header('Cache-Control', 'public, max-age=3600');
   ```

3. **Connection Pooling**: Already using `undici` for HTTP requests

## 🔄 CI/CD Pipeline

### GitHub Actions Example

```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - name: Deploy to Railway
        uses: railway-app/railway-deploy@v1
        with:
          railway-token: ${{ secrets.RAILWAY_TOKEN }}
```

### Repository

- **GitHub**: [https://github.com/andremoreirasmo/brazuca-rd](https://github.com/andremoreirasmo/brazuca-rd)
- **Issues**: [https://github.com/andremoreirasmo/brazuca-rd/issues](https://github.com/andremoreirasmo/brazuca-rd/issues)

---

**Need Help?** Check the main README.md or create an issue in the repository.
