# Task Board

A very simple CRUD app with two folders:

- `frontend/` — React + Vite.
- `backend/` — Rust + Axum + SQLx, with a PostgreSQL migration.

Add, list, edit, complete, and delete tasks. Data is stored in one PostgreSQL database. Includes an optional local Minikube setup with separate frontend and backend pods using your external PostgreSQL database.

## Run locally

Prerequisites: Node.js 22.12+, Rust, and a running PostgreSQL instance.

Add `backend/.env` with your connection details and desired database name:

```dotenv
DATABASE_URL=postgres://YOUR_USER:YOUR_PASSWORD@localhost:5432/YOUR_DATABASE
```

The backend automatically loads `.env` from its working directory. Existing environment variables take precedence.

Start the backend:

```sh
cd backend
cargo run
```

The API listens on port 8080. It creates the configured database if missing, then applies migrations automatically. PostgreSQL and the login role must already exist. To create a database, that role needs `CREATEDB` permission and access to the `postgres` maintenance database. A PostgreSQL administrator can grant this once with `ALTER ROLE "YOUR_USER" CREATEDB;`. Existing databases still require appropriate table and migration permissions.

In another terminal, start the frontend:

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` requests to http://localhost:8080.

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Database readiness |
| GET | `/api/tasks` | List tasks |
| POST | `/api/tasks` | Create: `{ "title": "First task" }` |
| PUT | `/api/tasks/:id` | Update: `{ "title": "First task", "completed": true }` |
| DELETE | `/api/tasks/:id` | Delete a task |

Titles must contain 1–200 characters after trimming. Missing tasks return 404. This practice app has no authentication.

## Build checks

```sh
cd frontend
npm run build
```

```sh
cd backend
cargo check
```

## Local Minikube

Run from the project root. Docker must be running and accessible to your user.

Run everything with:

```sh
./scripts/run-local.sh
```

The script builds both images with Docker, loads and verifies them inside Minikube, deploys to the explicit `minikube` context, waits for readiness, and forwards the frontend to http://localhost:8081. Rerun it after code changes to rebuild and restart the app. Ctrl+C ends forwarding; pods keep running. Use `minikube stop` to stop the cluster.

Your existing frontend on 5173 and backend on 8080 can keep running. The Kubernetes app uses local port 8081 and the database configured in your environment file. You may stop the existing processes with Ctrl+C to save resources. If port 8081 already has a port-forward running, stop that first.

Equivalent manual commands:

```sh
minikube start --driver=docker
minikube image build -t tasks-backend:local ./backend
minikube image build -t tasks-frontend:local ./frontend
kubectl --context=minikube create namespace task-board --dry-run=client -o yaml | kubectl --context=minikube apply -f -
kubectl --context=minikube -n task-board create secret generic database --from-env-file=backend/.env --dry-run=client -o yaml | kubectl --context=minikube apply -f -
kubectl --context=minikube -n task-board delete deployment/postgres service/postgres --ignore-not-found
kubectl --context=minikube apply -f k8s/local.yaml
kubectl --context=minikube -n task-board rollout status deployment/backend --timeout=180s
kubectl --context=minikube -n task-board rollout status deployment/frontend --timeout=180s
kubectl --context=minikube -n task-board port-forward --address=127.0.0.1 service/frontend 8081:80
```

Open http://localhost:8081 and keep port-forward running. All Services are ClusterIP; only the frontend is forwarded to your local machine. A Node.js server serves the built React files and forwards `/api` to the backend Service. The backend connects directly to the external PostgreSQL URL supplied through the database Secret. Backend migrations run automatically.

The script imports `backend/.env` into the Kubernetes `database` Secret at runtime. The file is not copied into images or committed in the manifest. Use plain `KEY=value` entries without `export`, shell expansion, or surrounding quotes; preserve any SSL parameters required by your database provider. Only `DATABASE_URL` is passed to the backend container. After changing it, repeat the Secret import and restart the backend Deployment.

The local PostgreSQL Deployment and Service are removed when running the updated commands. Any old `postgres-data` PVC is retained to preserve its data; the app no longer uses it. Removing resources from a YAML file alone does not delete existing cluster resources.

Inspect the app:

```sh
kubectl --context=minikube -n task-board get pods,services,pvc
kubectl --context=minikube -n task-board logs deployment/backend
```

After code changes, rebuild the relevant image with the commands above, then restart its Deployment:

```sh
kubectl --context=minikube -n task-board rollout restart deployment/backend deployment/frontend
```

Stop the cluster with `minikube stop`. To delete the namespace and any retained local PVC (your external database is unaffected):

```sh
kubectl --context=minikube delete namespace task-board
```

## Kubernetes architecture reference

![Kubernetes control plane and worker node architecture](docs/images/kubernetes-architecture.png)

The reference diagram above shows a general Kubernetes cluster with a control plane and multiple worker nodes. Our local Minikube setup uses one node for both control-plane duties and application workloads, unless extra nodes are added.

- **Control plane:** The API server accepts Kubernetes commands, etcd stores cluster state, the scheduler selects nodes for pods, and controllers maintain the desired state.
- **Node components:** Kubelet manages pod execution through a container runtime; kube-proxy implements Service networking in this setup. CRI is the interface between kubelet and the runtime.
- **Our app:** The `task-board` namespace contains separate frontend and backend pods using your external PostgreSQL database. Services provide stable addresses for reaching them.

```text
Browser (localhost:8081)
    | port-forward
    v
Frontend Service :80 -> Frontend pod (Node.js serves React)
    | /api requests
    v
Backend Service :8080 -> Backend pod (Rust API)
    | database queries
    v
External PostgreSQL (DATABASE_URL from Kubernetes Secret)
```

The cloud-controller-manager shown in the reference is for cloud-provider integration; it is not needed for this local Docker-based Minikube setup.

### Frontend Node.js server

The frontend image runs `node server.js` on port 80. It serves the built React files and proxies `/api` requests to `http://backend:8080`. No extra runtime npm dependencies are needed. `PORT` and `BACKEND_URL` can override these defaults through environment variables.

To run the production frontend directly after `npm run build`, use `PORT=8081 BACKEND_URL=http://localhost:8080 npm start` from the frontend directory. 
