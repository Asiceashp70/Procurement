import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import pool from '../config/db';
import { getIO } from '../config/socket';
import { sendMessage } from '../config/telegram';

export const getTasks = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { project_id, status } = req.query;
        let query = 'SELECT * FROM tasks WHERE 1=1';
        const params: any[] = [];
        
        if (project_id) {
            params.push(project_id);
            query += ` AND project_id = $${params.length}`;
        }
        if (status) {
            params.push(status);
            query += ` AND status = $${params.length}`;
        }
        
        query += ' ORDER BY created_at DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching tasks', error });
    }
};

export const createTask = async (req: AuthRequest, res: Response): Promise<void> => {
     try {
         const { project_id, title, description, assigned_to, job_code, priority } = req.body;
         const result = await pool.query(
             `INSERT INTO tasks (project_id, title, description, assigned_to, job_code, priority) 
              VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
             [project_id, title, description, assigned_to, job_code, priority || 'Medium']
         );
         
         const newTask = result.rows[0];
         getIO().to('dashboard').emit('task_created', newTask);
         res.status(201).json(newTask);
     } catch (error) {
         res.status(500).json({ message: 'Error creating task', error });
     }
};

export const scanJobCode = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { code } = req.params;
        const result = await pool.query('SELECT * FROM tasks WHERE job_code = $1', [code]);
        if (result.rows.length === 0) {
            res.status(404).json({ message: 'Task not found' });
            return;
        }
        res.json(result.rows[0]);
    } catch(error) {
        res.status(500).json({ message: 'Error scanning job code' });
    }
};

export const updateTaskStatus = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { id } = req.params;
        const { status, note } = req.body;
        const userId = req.user?.id;

        // Get current status
        const taskRes = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (taskRes.rows.length === 0) {
            res.status(404).json({ message: 'Task not found' });
            return;
        }
        const task = taskRes.rows[0];

        const prevStatus = task.status;

        const updateFields: string[] = ['status = $1'];
        const updateParams: any[] = [status, id];
        let paramIdx = 3;

        if (status === 'In Progress' && prevStatus !== 'In Progress' && prevStatus !== 'Paused') {
             updateFields.push(`started_at = $${paramIdx++}`);
             updateParams.push(new Date());
        }
        if (status === 'Completed') {
             updateFields.push(`completed_at = $${paramIdx++}`);
             updateParams.push(new Date());
        }

        const result = await pool.query(
             `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = $2 RETURNING *`,
             updateParams
        );
        const updatedTask = result.rows[0];

        // Log to task_logs
        await pool.query(
            'INSERT INTO task_logs (task_id, user_id, previous_status, new_status, note) VALUES ($1, $2, $3, $4, $5)',
            [id, userId, prevStatus, status, note]
        );

        // Emit WS Event
        getIO().to('dashboard').emit('task_status_changed', { taskId: id, previous_status: prevStatus, new_status: status, task: updatedTask, user_id: userId });

        // If completed, send telegram
        if (status === 'Completed') {
             await sendMessage(`Task Completed: ${updatedTask.title} (Job Code: ${updatedTask.job_code})`);
        } else if (status === 'In Progress') {
             await sendMessage(`Task Started: ${updatedTask.title} (Job Code: ${updatedTask.job_code})`);
        }

        res.json(updatedTask);
    } catch(error) {
        console.error(error);
        res.status(500).json({ message: 'Error updating task status' });
    }
};
