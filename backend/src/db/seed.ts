import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/production_db',
});

const seed = async () => {
    try {
        console.log('Seeding initial users...');

        const adminPw = await bcrypt.hash('admin123', 10);
        const empPw = await bcrypt.hash('emp123', 10);

        await pool.query(`
            INSERT INTO users (username, password_hash, full_name, role, employee_id)
            VALUES 
            ('admin', $1, 'System Administrator', 'Admin', 'ADMIN-001'),
            ('worker1', $2, 'Somchai Factory', 'Employee', 'EMP-001')
            ON CONFLICT (username) DO NOTHING;
        `, [adminPw, empPw]);

        console.log('✅ Seeding completed successfully!');
        
        console.log('---------------------------------');
        console.log('Login Credentials created:');
        console.log('1. Admin Account:');
        console.log('   Username: admin');
        console.log('   Password: admin123');
        console.log('');
        console.log('2. Employee/Worker Account:');
        console.log('   Username: worker1');
        console.log('   Password: emp123');
        console.log('---------------------------------');

        process.exit(0);
    } catch (err) {
        console.error('Error seeding database. Make sure PostgreSQL is running and DATABASE_URL in .env is correct.', err);
        process.exit(1);
    }
};

seed();
