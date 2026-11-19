# Learning notes

## 2026-11-19 — Planned changes

- Configure explicit Minikube node CPU and RAM; review node disk capacity and Docker storage constraints.
- Add CPU and memory requests and limits for application containers in Kubernetes.
- Review PostgreSQL persistent storage sizing and local storage limitations.
- Replace Nginx in the frontend container with a simple Node.js server that serves the built React files and proxies `/api` requests to `backend:8080`.
- Rebuild and load the images into `practice-1`, redeploy, and verify CRUD operations and resource usage.

Status: Planned for tomorrow; no application or deployment changes made yet.

### CLI practice planned for 2026-11-19

- Scale the backend Deployment from 1 to 3 replicas and inspect the resulting pods.
- Inspect the existing ClusterIP Services and access the frontend using port forwarding.
- Delete one backend pod and observe Kubernetes self-healing as its ReplicaSet creates a replacement.

Status: Planned exercises, not yet completed. Run commands individually against the `practice-1` context and `task-board` namespace.

### Completed: frontend Node.js server

- Replaced the frontend Nginx runtime with a simple Node.js HTTP server.
- Kept port 80 and forwarding of `/api` to `backend:8080`.
- Rebuild and load the frontend image, then restart the frontend Deployment to use it in Minikube.
- Resource sizing and CLI scaling/self-healing exercises remain planned.
