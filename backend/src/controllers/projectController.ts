import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import pool from '../config/db';

export const getProjects = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const result = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching projects', error });
    }
};

export const createProject = async (req: AuthRequest, res: Response): Promise<void> => {
     try {
         const { name, description, expect_end_date } = req.body;
         const result = await pool.query(
             `INSERT INTO projects (name, description, expect_end_date) 
              VALUES ($1, $2, $3) RETURNING *`,
             [name, description, expect_end_date]
         );
         res.status(201).json(result.rows[0]);
     } catch (error) {
         res.status(500).json({ message: 'Error creating project', error });
     }
};
