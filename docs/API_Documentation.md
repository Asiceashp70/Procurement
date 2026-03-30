# API Documentation (Swagger/OpenAPI Draft)

## Base URL: `/api/v1`

### 1. Authentication
- **POST `/auth/login`**: Login user and return JWT token.
- **GET `/auth/me`**: Get current logged-in user info based on token.

### 2. Users
- **GET `/users`**: List all users (Admin only).
- **POST `/users`**: Create a new user (Admin only).

### 3. Projects
- **GET `/projects`**: List all projects.
- **POST `/projects`**: Create a new project.
- **GET `/projects/{id}`**: Get project details including its tasks.
- **PUT `/projects/{id}`**: Update project details.
- **DELETE `/projects/{id}`**: Delete project.

### 4. Tasks
- **GET `/tasks`**: List tasks with optional query filters (e.g. `?status=Todo`, `?project_id=123`).
- **POST `/tasks`**: Create a new task under a project.
- **GET `/tasks/{id}`**: Get task details.
- **PUT `/tasks/{id}`**: Update task details.
- **PATCH `/tasks/{id}/status`**: Update task status. Requires payload `{ "status": "In Progress" }`.
- **GET `/tasks/job_code/{code}`**: Get task details by scanning job code (QR/Barcode).

### 5. Issues
- **POST `/issues`**: Report an issue for a task. Requires `task_id`, `description`, and optional `image_url`.
- **GET `/issues`**: List all reported issues.
- **PATCH `/issues/{id}/status`**: Update the status of an issue (Open -> Investigating -> Resolved).

### 6. Real-time Events (WebSocket)
- **Namespace:** `/ws/dashboard`
- **Events Sent by Client:**
  - `join_dashboard`: Subscribes to dashboard updates.
- **Events Received by Client:**
  - `task_status_changed`: Fired when an employee updates a task status via Mobile App.
  - `issue_reported`: Fired when an issue is reported.
