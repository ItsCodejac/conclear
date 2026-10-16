import { Router, type Request, type Response, type NextFunction } from 'express';
import { enroll, health, updateProject, snapshots, pin, restorePoint, isDemo } from '../../recovery/projects.mjs';
import { manageService, serviceStatus } from '../../recovery/service.mjs';

export const recoveryRoutes = Router();

// This surface manages local files and a user service. Accept only requests to
// the loopback host, and reject cross-origin browser calls / DNS rebinding.
recoveryRoutes.use((req: Request, res: Response, next: NextFunction) => {
  const host = req.get('host') || '';
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) return res.status(403).json({ error: 'Recovery API requires a loopback host' });
  const origin = req.get('origin');
  const dev = process.env.NODE_ENV !== 'production' && (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173');
  if ((origin && origin !== `http://${host}` && !dev) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Cross-origin recovery requests are not allowed' });
  next();
});
const param = (req: Request, name: string) => String(req.params[name] || '');
const endpoint = (work: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try { res.json(await work(req)); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
};
recoveryRoutes.get('/status', endpoint(async () => ({ ...(await health()), service: isDemo() ? null : await serviceStatus() })));
recoveryRoutes.post('/projects', endpoint(async req => {
  const project = await enroll(req.body.path, { policy: req.body.policy, exclusions: req.body.exclusions });
  if (req.body.startService !== false) {
    try { await manageService('install'); }
    catch (error) { throw new Error(`Project ${project.id} enrolled, but background startup failed: ${error instanceof Error ? error.message : String(error)}. Capture is not confirmed; check status.`); }
  }
  return project;
}));
recoveryRoutes.patch('/projects/:id', endpoint(req => updateProject(param(req, 'id'), req.body)));
recoveryRoutes.get('/projects/:id/snapshots', endpoint(req => snapshots(param(req, 'id'), { limit: Number(req.query.limit || 50), offset: Number(req.query.offset || 0) })));
recoveryRoutes.post('/projects/:id/pin', endpoint(req => pin(param(req, 'id'), req.body.point, { reason: req.body.reason, actor: 'user', sourceRef: req.body.sourceRef }, req.body.remove === true)));
recoveryRoutes.post('/projects/:id/restore', endpoint(req => restorePoint(param(req, 'id'), req.body.point, req.body.destination)));
recoveryRoutes.post('/service/:action', endpoint(req => manageService(param(req, 'action'))));
