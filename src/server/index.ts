import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import sessionRoutes from './routes/sessions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
export const PORT = 3789;

app.use(express.json());
app.use('/api', sessionRoutes);

// In production, serve the built Vite frontend
if (process.env.NODE_ENV === 'production') {
  const clientDir = path.resolve(__dirname, '../client');
  app.use(express.static(clientDir));
  app.get('{*path}', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

export function startServer(): Promise<ReturnType<typeof app.listen>> {
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`ConClear running on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

// Start directly when run as main module (dev mode)
const isMain = process.argv[1] && (
  process.argv[1].endsWith('/server/index.js') ||
  process.argv[1].endsWith('/server/index.ts')
);
if (isMain) {
  startServer();
}
