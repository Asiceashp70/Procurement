import { Router } from 'express';
import { getProjects, createProject } from '../controllers/projectController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/', getProjects);
router.post('/', requireRole(['Admin', 'Manager']), createProject);

export default router;
