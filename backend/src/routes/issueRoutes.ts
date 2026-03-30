import { Router } from 'express';
import { getIssues, reportIssue } from '../controllers/issueController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/', getIssues);
router.post('/', reportIssue);

export default router;
