import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

export const login = async (req: Request, res: Response): Promise<void> => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

        if (result.rows.length === 0) {
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            res.status(401).json({ message: 'Invalid credentials' });
            return;
        }

        const token = jwt.sign(
            { id: user.id, role: user.role, employee_id: user.employee_id },
            process.env.JWT_SECRET as string,
            { expiresIn: '24h' }
        );

        res.json({ token, user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name } });
    } catch (error) {
        console.error('Login error', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }
        const result = await pool.query('SELECT id, username, full_name, role, employee_id FROM users WHERE id = $1', [user.id]);
        
        if (result.rows.length === 0) {
            res.status(404).json({ message: 'User not found' });
            return;
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Get user error', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
