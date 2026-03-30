import { Router } from 'express';
import { getTasks, createTask, updateTaskStatus, scanJobCode } from '../controllers/taskController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/', getTasks);
router.post('/', requireRole(['Admin', 'Manager']), createTask);
router.get('/job_code/:code', scanJobCode);
router.patch('/:id/status', updateTaskStatus);

export default router;
