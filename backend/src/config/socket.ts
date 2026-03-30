import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: SocketIOServer;

export const initSocket = (server: HttpServer) => {
    io = new SocketIOServer(server, {
        cors: {
            origin: '*',
        }
    });

    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);
        
        socket.on('join_dashboard', () => {
             socket.join('dashboard');
             console.log(`Socket ${socket.id} joined dashboard`);
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io is not initialized');
    }
    return io;
};
