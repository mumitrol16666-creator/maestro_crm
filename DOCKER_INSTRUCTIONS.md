# Docker Instructions for Sense of Dance

This project is now set up to run with Docker.

## Prerequisites

- Docker and Docker Compose installed on your system.

## Configuration

1.  **Backend Environment:**
    The backend uses environment variables. Create a `.env` file in the `backend/` directory if it doesn't exist, or ensure your `docker-compose.yml` passes the necessary variables (like `MONGODB_URI`, `JWT_SECRET`, etc.).
    
    *Note: Currently, `docker-compose.yml` expects you to manually set these or load them. Ideally, map the `.env` file:*
    
    Open `docker-compose.yml` and uncomment/add:
    ```yaml
    services:
      backend:
        env_file:
          - ./backend/.env
    ```

## Running the Project

1.  **Build and Start:**
    Run the following command in the root of the project:
    ```bash
    docker-compose up --build -d
    ```

2.  **Verify:**
    -   **Frontend:** Open `http://localhost` (or your server IP).
    -   **Backend:** Accessible at `http://localhost:5000` (mostly for API calls from frontend).

3.  **Logs:**
    To see logs:
    ```bash
    docker-compose logs -f
    ```

4.  **Stop:**
    ```bash
    docker-compose down
    ```

## Architecture

-   **Frontend:** `nginx:alpine` serving static files from `frontend/`. Proxying `/api` requests to the backend container.
-   **Backend:** `node:18-alpine` running the Express app.

## Notes for Production

-   Ensure your `backend/.env` file contains the production MongoDB URI.
-   If you need HTTPS, you will need to map your SSL certificates to the Nginx container and update `nginx-docker.conf` to listen on 443.
