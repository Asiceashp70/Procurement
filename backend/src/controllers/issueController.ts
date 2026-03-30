import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import pool from '../config/db';
import { getIO } from '../config/socket';
import { sendMessage } from '../config/telegram';

export const getIssues = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM issues ORDER BY reported_at DESC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching issues', error });
    }
};

export const reportIssue = async (req: AuthRequest, res: Response): Promise<void> => {
     try {
         const { task_id, description, image_url } = req.body;
         const reported_by = req.user?.id;
         const result = await pool.query(
             `INSERT INTO issues (task_id, reported_by, description, image_url) 
              VALUES ($1, $2, $3, $4) RETURNING *`,
             [task_id, reported_by, description, image_url]
         );
         
         const newIssue = result.rows[0];
         getIO().to('dashboard').emit('issue_reported', newIssue);
         await sendMessage(`🚨 New Issue Reported for Task ID: ${task_id}\nDescription: ${description}`);
         
         res.status(201).json(newIssue);
     } catch (error) {
         res.status(500).json({ message: 'Error reporting issue', error });
     }
};
