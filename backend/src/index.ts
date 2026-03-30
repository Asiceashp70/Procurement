import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import { initSocket } from './config/socket';
import authRoutes from './routes/authRoutes';
import taskRoutes from './routes/taskRoutes';
import projectRoutes from './routes/projectRoutes';
import issueRoutes from './routes/issueRoutes';

dotenv.config();

const app = express();
const server = http.createServer(app);

initSocket(server);

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/issues', issueRoutes);

const PORT = process.env.PORT || 3004;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
